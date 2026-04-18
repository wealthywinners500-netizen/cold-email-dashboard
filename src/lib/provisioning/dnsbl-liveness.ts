// ============================================
// DB-backed DNSBL zone liveness cache with 24h fail-safe.
//
// Why this exists: the create_vps DNSBL check in ip-blacklist-check.ts
// today calls pickResolverWithLiveZone() for EVERY zone on EVERY IP check.
// If all 3 resolvers in RESOLVER_CHAIN (['8.8.8.8', '1.1.1.1', '9.9.9.9'])
// happen to glitch at the same moment on a given zone's canary lookup,
// that zone is marked UNREACHABLE and the fresh IP gets rejected. We've
// seen this hit spam.spamrats.com under load even though the zone was
// perfectly healthy 30s later.
//
// The fix: cache each zone's liveness in the DB. If any resolver observed
// the canary (127.0.0.2) as listed within cacheTtlMs (default 6h), the
// zone is LIVE without a fresh query. When all 3 resolvers NXDOMAIN,
// don't flip to dead immediately — record first_seen_dead and keep
// trusting "live" for failSafeMs (default 24h). That gives the ops team
// time to notice and gives transient registry outages a chance to heal
// before IPs start failing provisioning.
//
// Usage shape:
//   const { live, cached, evidence } = await isDnsblZoneLive(zone);
//   if (!live) { /* zone genuinely dead, treat not-listed as trusted */ }
//
// Design notes:
// - resolveFn and dbAdapter are injectable so the test harness doesn't
//   need to stub node:dns or spin up a real Supabase.
// - If the DB call throws (no SUPABASE_URL in test env, network blip,
//   etc.) we fall back to the in-memory path: run the 3 resolvers, return
//   the result, don't persist. The caller still gets a correct answer.
// - We deliberately do NOT clear first_seen_dead on mixed error/timeout
//   outcomes — only a clean "any resolver said listed" resets the clock.
//   Transient noise shouldn't reset the 24h fail-safe window.
// ============================================

import { Resolver } from 'node:dns';
import { createAdminClient } from '@/lib/supabase/server';

// ---------- Public types ----------

/** Resolvers tried in order — matches ip-blacklist-check.ts RESOLVER_CHAIN. */
export const RESOLVER_CHAIN = ['8.8.8.8', '1.1.1.1', '9.9.9.9'] as const;

/**
 * Probe IPs per zone. Every well-behaved DNSBL publishes a listing for
 * 127.0.0.2 so we default to that. If we ever discover a zone that uses
 * a different canary (some zones use 127.0.0.3 for specific categories),
 * record the override here.
 */
export const ZONE_PROBE_IPS: Record<string, string> = {
  // Default for every zone is 127.0.0.2; explicit overrides go here.
};

export function getProbeIp(zone: string): string {
  return ZONE_PROBE_IPS[zone] ?? '127.0.0.2';
}

/** Per-resolver outcome for a single zone probe. */
export type ZoneQueryOutcome =
  | 'listed'    // got 127.0.0.x back — zone is live and canary is listed
  | 'nxdomain'  // clean NXDOMAIN / ENOTFOUND / ENODATA — zone reachable but "not listed"
  | 'error'     // other DNS error (SERVFAIL, REFUSED, etc.)
  | 'timeout'   // query exceeded our timeout
  | 'empty';    // resolver returned an empty answer section

export interface DnsblLivenessResult {
  live: boolean;
  cached: boolean;
  evidence: Record<string, ZoneQueryOutcome>;
}

export interface DnsblLivenessRow {
  zone: string;
  last_checked: string;
  live: boolean;
  sample_ip: string | null;
  evidence: Record<string, ZoneQueryOutcome>;
  first_seen_dead: string | null;
  updated_at: string;
}

export interface DnsblLivenessDbAdapter {
  get(zone: string): Promise<DnsblLivenessRow | null>;
  upsert(row: DnsblLivenessRow): Promise<void>;
}

export type DnsblResolveFn = (
  resolverIP: string,
  reversedProbe: string,
  zone: string
) => Promise<ZoneQueryOutcome>;

export interface IsDnsblZoneLiveOptions {
  /** How long a LIVE cache entry stays valid before we re-probe. Default 6h. */
  cacheTtlMs?: number;
  /** Grace window before a consistently-dead zone flips live=false. Default 24h. */
  failSafeMs?: number;
  /** Per-query DNS timeout. Default 5000ms. */
  timeoutMs?: number;
  /** Skip all DB reads/writes — useful for tests or degraded runs. */
  skipDb?: boolean;
  /** Inject a fake resolver (tests). */
  resolveFn?: DnsblResolveFn;
  /** Inject a fake DB layer (tests). */
  dbAdapter?: DnsblLivenessDbAdapter;
  /** Override "now" (tests). */
  now?: () => Date;
}

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h
const DEFAULT_FAIL_SAFE_MS = 24 * 60 * 60 * 1000;  // 24h
const DEFAULT_TIMEOUT_MS = 5000;

// ---------- Real DNS resolver ----------

function realResolve(
  resolverIP: string,
  reversedProbe: string,
  zone: string,
  timeoutMs: number
): Promise<ZoneQueryOutcome> {
  return new Promise((resolve) => {
    const resolver = new Resolver();
    resolver.setServers([resolverIP]);

    const timer = setTimeout(() => {
      resolver.cancel();
      resolve('timeout');
    }, timeoutMs);

    resolver.resolve4(`${reversedProbe}.${zone}`, (err, addresses) => {
      clearTimeout(timer);
      if (err) {
        const code = (err as NodeJS.ErrnoException).code || 'UNKNOWN';
        if (code === 'ENOTFOUND' || code === 'ENODATA') {
          resolve('nxdomain');
        } else {
          resolve('error');
        }
        return;
      }
      if (addresses && addresses.length > 0) {
        // A well-behaved DNSBL reply is always in 127.0.0.0/8.
        if (addresses[0].startsWith('127.0.0.')) {
          resolve('listed');
        } else {
          resolve('error');
        }
      } else {
        resolve('empty');
      }
    });
  });
}

// ---------- Real DB adapter ----------

function createRealDbAdapter(): DnsblLivenessDbAdapter {
  return {
    async get(zone) {
      const supabase = await createAdminClient();
      const { data, error } = await supabase
        .from('dnsbl_zone_liveness')
        .select('*')
        .eq('zone', zone)
        .maybeSingle();
      if (error) throw error;
      return (data as DnsblLivenessRow | null) ?? null;
    },
    async upsert(row) {
      const supabase = await createAdminClient();
      const { error } = await supabase
        .from('dnsbl_zone_liveness')
        .upsert(row, { onConflict: 'zone' });
      if (error) throw error;
    },
  };
}

// ---------- Helpers ----------

function reverseIp(ip: string): string {
  return ip.split('.').reverse().join('.');
}

function summarize(
  evidence: Record<string, ZoneQueryOutcome>
): { anyListed: boolean; allNxdomain: boolean } {
  const values = Object.values(evidence);
  const anyListed = values.some((v) => v === 'listed');
  const allNxdomain = values.length > 0 && values.every((v) => v === 'nxdomain');
  return { anyListed, allNxdomain };
}

// ---------- Main entrypoint ----------

export async function isDnsblZoneLive(
  zone: string,
  opts: IsDnsblZoneLiveOptions = {}
): Promise<DnsblLivenessResult> {
  const cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const failSafeMs = opts.failSafeMs ?? DEFAULT_FAIL_SAFE_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? (() => new Date());

  const resolveFn: DnsblResolveFn =
    opts.resolveFn ??
    ((resolverIP, reversedProbe, z) => realResolve(resolverIP, reversedProbe, z, timeoutMs));

  // DB adapter — either injected, disabled via skipDb, or the real one.
  // If the real one fails later (e.g. missing env), we fall back to no-DB mode.
  let db: DnsblLivenessDbAdapter | null = null;
  if (!opts.skipDb) {
    db = opts.dbAdapter ?? null;
    if (!db) {
      try {
        db = createRealDbAdapter();
      } catch {
        db = null;
      }
    }
  }

  // 1) Try to serve from cache.
  let existing: DnsblLivenessRow | null = null;
  if (db) {
    try {
      existing = await db.get(zone);
    } catch {
      // DB unreachable — degrade to no-cache mode.
      db = null;
      existing = null;
    }
    if (existing) {
      const age = now().getTime() - new Date(existing.last_checked).getTime();
      if (age < cacheTtlMs) {
        return { live: existing.live, cached: true, evidence: existing.evidence ?? {} };
      }
    }
  }

  // 2) Probe all 3 resolvers.
  const probeIp = getProbeIp(zone);
  const reversed = reverseIp(probeIp);
  const evidence: Record<string, ZoneQueryOutcome> = {};
  await Promise.all(
    RESOLVER_CHAIN.map(async (resolverIP) => {
      try {
        evidence[resolverIP] = await resolveFn(resolverIP, reversed, zone);
      } catch {
        evidence[resolverIP] = 'error';
      }
    })
  );

  // 3) Decide liveness.
  const { anyListed, allNxdomain } = summarize(evidence);
  const nowIso = now().toISOString();

  let live: boolean;
  let firstSeenDead: string | null;

  if (anyListed) {
    // Canary observed by at least one resolver — zone is definitively live.
    live = true;
    firstSeenDead = null;
  } else if (allNxdomain) {
    // Clean NXDOMAIN consensus across all 3 resolvers. Start (or continue)
    // the 24h fail-safe clock.
    if (!existing || !existing.first_seen_dead) {
      firstSeenDead = nowIso;
      live = true; // still within grace window — first observation of death
    } else {
      const deadFor = now().getTime() - new Date(existing.first_seen_dead).getTime();
      firstSeenDead = existing.first_seen_dead;
      live = deadFor < failSafeMs; // flip to false only once fail-safe elapses
    }
  } else {
    // Mixed errors/timeouts with no clean NXDOMAIN consensus — treat as
    // live so transient network junk doesn't penalize the zone. Crucially
    // we do NOT clear first_seen_dead here: if we were previously in the
    // dead-grace window, stay there.
    live = true;
    firstSeenDead = existing?.first_seen_dead ?? null;
  }

  // 4) Persist (best-effort).
  if (db) {
    const row: DnsblLivenessRow = {
      zone,
      last_checked: nowIso,
      live,
      sample_ip: probeIp,
      evidence,
      first_seen_dead: firstSeenDead,
      updated_at: nowIso,
    };
    try {
      await db.upsert(row);
    } catch {
      // Swallow — this is a cache, not a source of truth.
    }
  }

  return { live, cached: false, evidence };
}
