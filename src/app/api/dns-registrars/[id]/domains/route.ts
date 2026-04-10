import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { DNSRegistrarRow } from "@/lib/provisioning/types";
import {
  type DomainCacheEntry,
  type DomainInfoWithBlacklist,
  evaluateCache,
  filterUsedDomains,
  sortDomainsCleanFirst,
  writeDomainCache,
  buildFetchingEntry,
} from "@/lib/provisioning/domain-listing";

// Hard lesson #49 (2026-04-10): Vercel Hobby caps serverless functions at 10s
// by default. Even though this route no longer waits for the slow Ionos
// listing (it dispatches to a pg-boss worker), we keep a 60s ceiling to
// accommodate rare cold starts and DB writes.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Hard lesson (2026-04-10): Ionos throttles at 25 req/min, so a full
// listDomains() for 110 domains takes ~9 minutes. That cannot run inside a
// Vercel serverless function. The entire pipeline has been moved to the
// worker VPS via pg-boss queue `list-registrar-domains`; this route is now
// a thin orchestrator that:
//
//   1. Returns the cached result if it's < 1h old
//   2. Returns HTTP 202 {status:'fetching'} if a worker fetch is in-flight
//   3. Otherwise marks the cache 'fetching', dispatches a pg-boss job, and
//      returns HTTP 202 {status:'fetching'} so the wizard can start polling
//
// The wizard polls this same endpoint every few seconds until the status
// flips to 'ready' (HTTP 200 with domains) or 'failed' (HTTP 502 with
// error + retry button).

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
 *
 * Query params:
 *   - refresh=true — bypass cache and force re-fetch
 *
 * Response envelope (same for cached + worker-completed):
 *   200 { status: 'ready', domains, fetchedAt, cached, registrarName, registrarType }
 *   202 { status: 'fetching', requestedAt }
 *   502 { status: 'failed', error, fetchedAt }
 *   401/404/500 — standard error envelopes
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

    // 1. Fetch registrar row (multi-tenant filter via org_id).
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
    const config = (reg.config || {}) as Record<string, unknown>;
    const cache = config.domainCache as DomainCacheEntry | undefined;
    const cacheState = evaluateCache(cache, { forceRefresh });

    // 2. Fresh cache — return immediately (HTTP 200).
    if (cacheState === "fresh" && cache?.status === "ready") {
      // Re-filter "in-use" at response time so newly-provisioned pairs take
      // effect even inside the 1h cache window.
      const reFiltered = await filterUsedDomains(
        supabase,
        orgId,
        cache.domains
      );
      return NextResponse.json({
        status: "ready",
        domains: sortDomainsCleanFirst(reFiltered),
        fetchedAt: cache.fetchedAt,
        cached: true,
        registrarName: reg.name,
        registrarType: reg.registrar_type,
      });
    }

    // 3. Fetch in-flight — client should keep polling (HTTP 202).
    if (cacheState === "fetching" && cache?.status === "fetching") {
      return NextResponse.json(
        {
          status: "fetching",
          requestedAt: cache.requestedAt,
          registrarName: reg.name,
          registrarType: reg.registrar_type,
        },
        { status: 202 }
      );
    }

    // 4. Failed cache AND not refreshing — return the error (HTTP 502) so
    //    the wizard can show a retry button. Refresh=true falls through to
    //    the dispatch branch below.
    if (cacheState === "failed" && cache?.status === "failed" && !forceRefresh) {
      return NextResponse.json(
        {
          status: "failed",
          error: cache.error || "Domain listing failed",
          fetchedAt: cache.requestedAt,
          registrarName: reg.name,
          registrarType: reg.registrar_type,
        },
        { status: 502 }
      );
    }

    // 5. Everything else (missing / stale / failed-with-refresh) — mark the
    //    cache as 'fetching' and return 202. The worker has a poller cron
    //    (see src/worker/index.ts pollRegistrarDomainListings) that picks up
    //    any dns_registrars row with config.domainCache.status='fetching'
    //    AND dispatchedAt=null, sets dispatchedAt atomically, and kicks off
    //    the list-registrar-domains pg-boss job. This matches the existing
    //    Vercel→worker handoff pattern used by the provisioning step bridge
    //    (provisioning_steps.metadata.dispatched_to_worker).
    const fetchingEntry = buildFetchingEntry();
    await writeDomainCache(supabase, registrarId, orgId, fetchingEntry);

    return NextResponse.json(
      {
        status: "fetching",
        requestedAt: fetchingEntry.requestedAt,
        registrarName: reg.name,
        registrarType: reg.registrar_type,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[dns-registrars/domains] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Explicit unused-import guard — keeps tree-shakers happy if the build
// complains about unused type imports.
export type _Types = DomainInfoWithBlacklist;
