// ============================================
// Worker handler: list-registrar-domains
//
// Async worker for the `/api/dns-registrars/[id]/domains` async-polling
// pipeline. The Vercel route writes a `{ status: 'fetching' }` cache entry
// and dispatches to this queue; the worker then performs the full slow
// listing (including Ionos per-domain MX check, which takes ~9 min for 110
// domains) and writes the result back.
//
// The Vercel function cap is 60s but Ionos throttles at 25 req/min, so the
// full listing cannot run inside a serverless function. The worker VPS has
// no timeout, which is exactly what the async-polling pattern buys us.
// ============================================

import { createClient } from "@supabase/supabase-js";
import type { DNSRegistrarRow } from "../../lib/provisioning/types";
import {
  performFullDomainListing,
  writeDomainCache,
  buildReadyEntry,
  buildFailedEntry,
} from "../../lib/provisioning/domain-listing";

export interface ListRegistrarDomainsPayload {
  registrarId: string;
  orgId: string; // internal org id (not Clerk org_id)
  requestedAt: string; // ISO8601 — for stale-entry detection
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function handleListRegistrarDomains(
  payload: ListRegistrarDomainsPayload
): Promise<void> {
  const { registrarId, orgId, requestedAt } = payload;
  const startTime = Date.now();

  console.log(
    `[list-registrar-domains] Starting fetch for registrar=${registrarId} org=${orgId} requestedAt=${requestedAt}`
  );

  const supabase = getSupabase();

  // 1. Load registrar row (service-role, multi-tenant-filtered by org_id).
  const { data: registrar, error: loadError } = await supabase
    .from("dns_registrars")
    .select("*")
    .eq("id", registrarId)
    .eq("org_id", orgId)
    .single();

  if (loadError || !registrar) {
    const errMsg = loadError?.message || "registrar not found";
    console.error(
      `[list-registrar-domains] Failed to load registrar ${registrarId}: ${errMsg}`
    );
    // Still try to write a failed cache entry so the UI can surface it.
    try {
      await writeDomainCache(
        supabase,
        registrarId,
        orgId,
        buildFailedEntry(`Registrar lookup failed: ${errMsg}`)
      );
    } catch {
      // Swallow — the row may not exist at all, nothing to update.
    }
    return;
  }

  const reg = registrar as DNSRegistrarRow;

  // 2. Run the slow pipeline. On ANY failure, write a 'failed' cache entry
  //    so the wizard can surface the error + show a retry button.
  try {
    const domains = await performFullDomainListing(supabase, reg);

    const durationMs = Date.now() - startTime;
    console.log(
      `[list-registrar-domains] Fetched ${domains.length} domains for ${reg.name} (${reg.registrar_type}) in ${durationMs}ms`
    );

    await writeDomainCache(supabase, registrarId, orgId, buildReadyEntry(domains));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    console.error(
      `[list-registrar-domains] Fetch failed after ${durationMs}ms for registrar=${registrarId}: ${errMsg}`,
      err
    );

    try {
      await writeDomainCache(
        supabase,
        registrarId,
        orgId,
        buildFailedEntry(errMsg)
      );
    } catch (writeErr) {
      console.error(
        `[list-registrar-domains] Also failed to write failure cache entry:`,
        writeErr
      );
    }

    // Re-throw so pg-boss marks the job as failed in its own tables.
    throw err;
  }
}
