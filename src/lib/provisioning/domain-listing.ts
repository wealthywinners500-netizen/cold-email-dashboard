// ============================================
// Shared registrar-domain listing + enrichment helper.
//
// Used by both the Vercel route `/api/dns-registrars/[id]/domains` and the
// worker handler `list-registrar-domains`. The Vercel route only reads the
// cached result; the worker handler performs the full registrar fetch + MX
// check + blacklist enrichment + "already in use" filter asynchronously and
// writes the result back into `dns_registrars.config.domainCache`.
//
// Hard lesson (2026-04-10): Ionos throttles its domainitems + DNS APIs to
// ~25 req/min. For Dean's ~110 domains, a full listDomains() with the
// per-domain MX check runs 220 sequential throttled calls and takes about
// 9 minutes. Vercel's 60-second function cap cannot accommodate this, so
// the whole pipeline was moved onto the worker VPS (which has no timeout)
// via the async-polling pattern.
// ============================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DomainInfo, DNSRegistrarRow } from "./types";
import { getDNSRegistrar } from "./provider-registry";
import { decrypt } from "./encryption";
import {
  checkDomainBlacklistBatch,
  type BlacklistStatus,
} from "./domain-blacklist";

// ============================================
// Types
// ============================================

export interface DomainInfoWithBlacklist extends DomainInfo {
  blacklistStatus: BlacklistStatus;
  blacklists?: string[];
  inUse?: boolean;
}

/**
 * Shape stored under `dns_registrars.config.domainCache`. The status field
 * drives the Vercel route's polling semantics:
 *   - 'fetching' → return HTTP 202, wizard keeps polling
 *   - 'ready'    → return HTTP 200 with the domains array
 *   - 'failed'   → return HTTP 502 with the error, wizard shows retry button
 */
export type DomainCacheStatus = "fetching" | "ready" | "failed";

export interface DomainCacheEntry {
  status: DomainCacheStatus;
  requestedAt: string; // ISO8601 — when the fetch was kicked off (by Vercel)
  dispatchedAt: string | null; // ISO8601 — when the worker poller picked it up
  fetchedAt: string | null; // ISO8601 — when the worker finished (ready only)
  error: string | null; // error message when status='failed'
  domains: DomainInfoWithBlacklist[]; // empty while fetching / on failure
}

// ============================================
// TTLs and timeouts (single source of truth)
// ============================================

/** Cache stays fresh for 1 hour. After that a refetch is triggered. */
export const DOMAIN_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Maximum time a 'fetching' entry is trusted before we consider it dead and
 * allow a new fetch to be kicked off. Worker-side listing of 110 domains
 * takes ~9 minutes; we allow 15 to give headroom for retries on rate limits.
 */
export const FETCH_IN_FLIGHT_TTL_MS = 15 * 60 * 1000;

// ============================================
// Helpers
// ============================================

/**
 * Determine the effective cache state from a raw cache entry. Handles three
 * edge cases: missing cache, stale 'ready', dead 'fetching' (stuck worker).
 */
export function evaluateCache(
  cache: DomainCacheEntry | null | undefined,
  opts: { forceRefresh?: boolean } = {}
): "missing" | "fresh" | "fetching" | "stale" | "failed" {
  if (opts.forceRefresh) return "stale";
  if (!cache || !cache.status) return "missing";

  const now = Date.now();

  if (cache.status === "ready" && cache.fetchedAt) {
    const age = now - new Date(cache.fetchedAt).getTime();
    if (age < DOMAIN_CACHE_TTL_MS) return "fresh";
    return "stale";
  }

  if (cache.status === "fetching" && cache.requestedAt) {
    const age = now - new Date(cache.requestedAt).getTime();
    if (age < FETCH_IN_FLIGHT_TTL_MS) return "fetching";
    // Worker got stuck — treat as stale so a new fetch can be kicked off.
    return "stale";
  }

  if (cache.status === "failed") return "failed";

  return "missing";
}

/**
 * Cross-reference a list of domains with the caller's own sending_domains
 * table to mark "already in use" entries. A domain is considered in-use only
 * when attached to a server_pair in a LIVE status.
 *
 * Schema notes (sending_domains has no org_id column — it scopes via pair_id):
 *   sending_domains(id, pair_id -> server_pairs(id), domain, ...)
 *   server_pairs(id, org_id, status, ...)
 */
export async function filterUsedDomains(
  supabase: SupabaseClient,
  orgId: string,
  domains: DomainInfoWithBlacklist[]
): Promise<DomainInfoWithBlacklist[]> {
  const LIVE_PAIR_STATUSES = [
    "planned",
    "provisioning",
    "active",
    "warming",
    "degraded",
    "setup", // pair 9 manual-repair state — still counts as in-use
  ];

  const { data: livePairs, error: pairsErr } = await supabase
    .from("server_pairs")
    .select("id")
    .eq("org_id", orgId)
    .in("status", LIVE_PAIR_STATUSES);

  if (pairsErr) {
    console.warn(
      "[domain-listing] filterUsedDomains: server_pairs query failed:",
      pairsErr.message
    );
  }

  const livePairIds = (livePairs || []).map((p: { id: string }) => p.id);

  let usedSet = new Set<string>();
  if (livePairIds.length > 0) {
    const { data: usedDomains, error: sdErr } = await supabase
      .from("sending_domains")
      .select("domain")
      .in("pair_id", livePairIds);

    if (sdErr) {
      console.warn(
        "[domain-listing] filterUsedDomains: sending_domains query failed:",
        sdErr.message
      );
    }

    usedSet = new Set(
      (usedDomains || []).map((d: { domain: string }) => d.domain.toLowerCase())
    );
  }

  // Spamhaus DBL listings are permanent/serious (spam, phish, malware, botnet).
  // URIBL, SURBL, and SEM Fresh are temporary reputation lists that clear
  // naturally during the 4-week warm-up period. Only hard-block on DBL.
  const HARD_BLOCK_LISTS = new Set([
    'dbl.dq.spamhaus.net',  // Spamhaus DBL via DQS
    'dbl.spamhaus.org',     // Legacy Spamhaus DBL
  ]);

  return domains.map((d) => {
    const inUse = usedSet.has(d.domain.toLowerCase());
    // Only block if listed on a permanent blacklist (Spamhaus DBL).
    // Temporary lists (URIBL, SURBL, SEM Fresh) are shown as warnings
    // but don't prevent selection — they clear during warm-up.
    const hardBlocked =
      d.blacklistStatus === "listed" &&
      (d.blacklists || []).some((list) => HARD_BLOCK_LISTS.has(list));
    return {
      ...d,
      isAvailable: d.isAvailable && !inUse && !hardBlocked,
      ...(inUse ? { inUse: true } : {}),
    };
  });
}

/**
 * Stable sort: clean → unknown → listed, alphabetical within each bucket.
 */
export function sortDomainsCleanFirst(
  domains: DomainInfoWithBlacklist[]
): DomainInfoWithBlacklist[] {
  const weight: Record<BlacklistStatus, number> = {
    clean: 0,
    unknown: 1,
    listed: 2,
  };
  return [...domains].sort((a, b) => {
    const aw = weight[a.blacklistStatus] ?? 1;
    const bw = weight[b.blacklistStatus] ?? 1;
    if (aw !== bw) return aw - bw;
    return a.domain.localeCompare(b.domain);
  });
}

// ============================================
// The actual worker-side pipeline
// ============================================

/**
 * Perform the full registrar-listing pipeline: instantiate the registrar
 * with decrypted credentials, call listDomains() (which includes the Ionos
 * per-domain MX check — SLOW), run Spamhaus blacklist enrichment on every
 * domain, cross-reference with the org's own sending_domains table, and
 * return a sorted result. This is the expensive path that runs on the
 * worker VPS.
 *
 * Throws if the registrar instantiation or listDomains() call fails. The
 * caller is responsible for catching and writing a 'failed' cache entry.
 */
export async function performFullDomainListing(
  supabase: SupabaseClient,
  registrar: DNSRegistrarRow
): Promise<DomainInfoWithBlacklist[]> {
  // 1. Decrypt API credentials
  let apiKey = "";
  let apiSecret: string | null = null;
  const config = (registrar.config || {}) as Record<string, unknown>;

  if (registrar.api_key_encrypted) {
    apiKey = decrypt(registrar.api_key_encrypted);
  }
  if (registrar.api_secret_encrypted) {
    apiSecret = decrypt(registrar.api_secret_encrypted);
  }

  const registrarConfig = { ...config, apiKey, apiSecret };

  // 2. Instantiate and call listDomains()
  const registrarInstance = await getDNSRegistrar(
    registrar.registrar_type,
    registrarConfig
  );

  const rawDomains: DomainInfo[] = await registrarInstance.listDomains();

  // 3. Enrich every domain with a real Spamhaus blacklist result (3-state).
  //    DQS is the primary — it works from any IP including cloud.
  const blacklistResults = await checkDomainBlacklistBatch(
    rawDomains.map((d) => d.domain),
    { concurrency: 10 }
  );
  const blacklistByDomain = new Map(
    blacklistResults.map((r) => [r.domain.toLowerCase(), r])
  );

  const enriched: DomainInfoWithBlacklist[] = rawDomains.map((d) => {
    const r = blacklistByDomain.get(d.domain.toLowerCase());
    if (!r) {
      return { ...d, blacklistStatus: "unknown" as BlacklistStatus };
    }
    return {
      ...d,
      blacklistStatus: r.status,
      blacklists: r.lists,
    };
  });

  // 4. Filter "already in use by our own pairs" + block listed domains.
  const filtered = await filterUsedDomains(supabase, registrar.org_id, enriched);

  // 5. Sort clean-first for a nicer wizard UX.
  return sortDomainsCleanFirst(filtered);
}

// ============================================
// Cache write helpers — used by the worker handler
// ============================================

/**
 * Write a new cache entry onto `dns_registrars.config.domainCache` and bump
 * `updated_at`. Preserves other top-level keys in `config` (e.g. provider-
 * specific settings).
 */
export async function writeDomainCache(
  supabase: SupabaseClient,
  registrarId: string,
  orgId: string,
  entry: DomainCacheEntry
): Promise<void> {
  // Re-read the latest config to avoid clobbering concurrent writes.
  const { data: current } = await supabase
    .from("dns_registrars")
    .select("config")
    .eq("id", registrarId)
    .eq("org_id", orgId)
    .single();

  const currentConfig = (current?.config || {}) as Record<string, unknown>;

  const updatedConfig = {
    ...currentConfig,
    domainCache: entry,
  };

  const { error } = await supabase
    .from("dns_registrars")
    .update({ config: updatedConfig, updated_at: new Date().toISOString() })
    .eq("id", registrarId)
    .eq("org_id", orgId);

  if (error) {
    console.error(
      `[domain-listing] writeDomainCache failed for ${registrarId}:`,
      error.message
    );
    throw error;
  }
}

/** Build a fresh 'fetching' cache entry. Worker-side dispatchedAt starts null. */
export function buildFetchingEntry(): DomainCacheEntry {
  return {
    status: "fetching",
    requestedAt: new Date().toISOString(),
    dispatchedAt: null,
    fetchedAt: null,
    error: null,
    domains: [],
  };
}

/** Build a 'ready' cache entry from a fetched domain list. */
export function buildReadyEntry(
  domains: DomainInfoWithBlacklist[]
): DomainCacheEntry {
  const now = new Date().toISOString();
  return {
    status: "ready",
    requestedAt: now,
    dispatchedAt: now,
    fetchedAt: now,
    error: null,
    domains,
  };
}

/** Build a 'failed' cache entry from an error. */
export function buildFailedEntry(error: unknown): DomainCacheEntry {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "failed",
    requestedAt: new Date().toISOString(),
    dispatchedAt: null,
    fetchedAt: null,
    error: message,
    domains: [],
  };
}
