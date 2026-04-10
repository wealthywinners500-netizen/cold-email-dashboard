import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getDNSRegistrar } from "@/lib/provisioning/provider-registry";
import { decrypt } from "@/lib/provisioning/encryption";
import type { DNSRegistrarRow, DomainInfo } from "@/lib/provisioning/types";
import { checkDomainsBlacklistBatch } from "@/lib/provisioning/domain-blacklist";

// Hard lesson #43 (2026-04-10): Auto-populated registrar domain lists must be
// filtered through the real DNSBL check so users can't accidentally pick a
// Spamhaus-listed domain. `blacklistStatus` is added to every DomainInfo row.
type BlacklistStatus = "clean" | "listed" | "unknown";
interface DomainInfoWithBlacklist extends DomainInfo {
  blacklistStatus: BlacklistStatus;
  blacklists?: string[];
  inUse?: boolean;
}

export const dynamic = "force-dynamic";

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();
  return data?.id || null;
}

/**
 * GET /api/dns-registrars/[id]/domains
 * Fetch all domains from the connected registrar, filtered for availability.
 * Query params:
 *   - refresh=true — bypass cache and force re-fetch
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: registrarId } = await params;
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    const supabase = await createAdminClient();

    // 1. Fetch registrar row by ID + org_id (multi-tenant isolation)
    const { data: registrar, error: regError } = await supabase
      .from("dns_registrars")
      .select("*")
      .eq("id", registrarId)
      .eq("org_id", orgId)
      .single();

    if (regError || !registrar) {
      return NextResponse.json(
        { error: "DNS registrar not found" },
        { status: 404 }
      );
    }

    const reg = registrar as DNSRegistrarRow;

    // 2. Check cache (1 hour TTL)
    const config = (reg.config || {}) as Record<string, unknown>;
    const domainCache = config.domainCache as
      | { domains: DomainInfoWithBlacklist[]; fetchedAt: string }
      | undefined;

    if (!forceRefresh && domainCache?.fetchedAt && domainCache.domains) {
      const cacheAge = Date.now() - new Date(domainCache.fetchedAt).getTime();
      const ONE_HOUR = 60 * 60 * 1000;
      if (cacheAge < ONE_HOUR) {
        const domains = await filterUsedDomains(supabase, orgId, domainCache.domains);
        return NextResponse.json({
          domains: sortDomainsCleanFirst(domains),
          cached: true,
          fetchedAt: domainCache.fetchedAt,
          registrarName: reg.name,
          registrarType: reg.registrar_type,
        });
      }
    }

    // 3. Decrypt API keys and instantiate registrar
    let apiKey = "";
    let apiSecret: string | null = null;

    if (reg.api_key_encrypted) {
      try {
        apiKey = decrypt(reg.api_key_encrypted);
      } catch {
        return NextResponse.json(
          { error: "Failed to decrypt API key. Re-enter credentials." },
          { status: 500 }
        );
      }
    }

    if (reg.api_secret_encrypted) {
      try {
        apiSecret = decrypt(reg.api_secret_encrypted);
      } catch {
        return NextResponse.json(
          { error: "Failed to decrypt API secret. Re-enter credentials." },
          { status: 500 }
        );
      }
    }

    const registrarConfig = { ...config, apiKey, apiSecret };
    const registrarInstance = await getDNSRegistrar(reg.registrar_type, registrarConfig);

    // 4. Fetch domains from registrar
    let rawDomains: DomainInfo[];
    try {
      rawDomains = await registrarInstance.listDomains();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error fetching domains";
      return NextResponse.json(
        { error: `Failed to fetch domains: ${message}` },
        { status: 502 }
      );
    }

    // 5. Blacklist-check every domain (Spamhaus DBL + SURBL + URIBL) so the
    // wizard dropdown can pre-mark listed domains. Max 10 concurrent DNS
    // lookups per batch. This is pure DNS — no registrar API quota applies.
    const blacklistResults = await checkDomainsBlacklistBatch(
      rawDomains.map((d) => d.domain),
      { concurrency: 10 }
    );
    const blacklistByDomain = new Map(
      blacklistResults.map((r) => [r.domain.toLowerCase(), r])
    );

    const enrichedDomains: DomainInfoWithBlacklist[] = rawDomains.map((d) => {
      const r = blacklistByDomain.get(d.domain.toLowerCase());
      if (!r) {
        return { ...d, blacklistStatus: "unknown" as BlacklistStatus };
      }
      return {
        ...d,
        blacklistStatus: (r.clean ? "clean" : "listed") as BlacklistStatus,
        blacklists: r.blacklists,
      };
    });

    // 6. Cache the result
    const now = new Date().toISOString();
    const updatedConfig = {
      ...config,
      domainCache: { domains: enrichedDomains, fetchedAt: now },
    };

    await supabase
      .from("dns_registrars")
      .update({ config: updatedConfig, updated_at: now })
      .eq("id", registrarId)
      .eq("org_id", orgId);

    // 7. Filter out used domains
    const domains = await filterUsedDomains(supabase, orgId, enrichedDomains);

    return NextResponse.json({
      domains: sortDomainsCleanFirst(domains),
      cached: false,
      fetchedAt: now,
      registrarName: reg.name,
      registrarType: reg.registrar_type,
    });
  } catch (err) {
    console.error("[dns-registrars/domains] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Cross-reference domains with the sending_domains table to mark
 * already-used domains. A domain is considered "in use" only if it is
 * attached to a server_pair in a LIVE status (planned / provisioning /
 * active / warming / degraded). Pairs that were decommissioned or failed
 * should free up their domains for re-use.
 *
 * Schema notes (sending_domains has no org_id column — it scopes via pair_id):
 *   sending_domains(id, pair_id -> server_pairs(id), domain, ...)
 *   server_pairs(id, org_id, status, ...)
 *
 * Hard lesson (2026-04-10): the previous version queried
 * `.select("domain_name").eq("org_id", orgId)` — both the column and the
 * filter were wrong (sending_domains has `domain`, not `domain_name`, and
 * no `org_id`). This meant the wizard NEVER flagged in-use domains and
 * would happily let the operator attach the same domain to two pairs.
 */
async function filterUsedDomains(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  orgId: string,
  domains: DomainInfoWithBlacklist[]
): Promise<DomainInfoWithBlacklist[]> {
  // Step 1: find all live (non-terminal) pairs in this org.
  const LIVE_PAIR_STATUSES = [
    "planned",
    "provisioning",
    "active",
    "warming",
    "degraded",
  ];
  const { data: livePairs, error: pairsErr } = await supabase
    .from("server_pairs")
    .select("id")
    .eq("org_id", orgId)
    .in("status", LIVE_PAIR_STATUSES);

  if (pairsErr) {
    console.warn(
      "[dns-registrars/domains] filterUsedDomains: server_pairs query failed:",
      pairsErr.message
    );
  }

  const livePairIds = (livePairs || []).map((p: { id: string }) => p.id);

  // Step 2: if there are no live pairs, nothing is in use.
  let usedSet = new Set<string>();
  if (livePairIds.length > 0) {
    const { data: usedDomains, error: sdErr } = await supabase
      .from("sending_domains")
      .select("domain")
      .in("pair_id", livePairIds);

    if (sdErr) {
      console.warn(
        "[dns-registrars/domains] filterUsedDomains: sending_domains query failed:",
        sdErr.message
      );
    }

    usedSet = new Set(
      (usedDomains || []).map((d: { domain: string }) => d.domain.toLowerCase())
    );
  }

  return domains.map((d) => {
    const inUse = usedSet.has(d.domain.toLowerCase());
    // Also mark blacklisted domains as unavailable so the wizard can't pick them.
    const blocked = d.blacklistStatus === "listed";
    return {
      ...d,
      isAvailable: d.isAvailable && !inUse && !blocked,
      ...(inUse ? { inUse: true } : {}),
    };
  });
}

/**
 * Sort clean domains first, then unknown, then listed. Keeps the wizard
 * dropdown focused on the domains that are actually pickable.
 */
function sortDomainsCleanFirst(
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
