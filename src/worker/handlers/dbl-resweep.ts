// ============================================
// dbl_resweep_warmup handler
//
// Re-screens every active saga-generated pair's sending_domains against the
// Spamhaus DQS DBL once a week. Surfaces any newly-listed domains as
// system_alerts, flips sending_domains.blacklist_status='burnt', and writes
// an audit row to dbl_sweep_runs.
//
// Background:
//   * Pair A's krogerengage.info (2026-04-26) and Wave-2-to-Wave-3's
//     krogerlocalmedia.info both went DBL-listed within hours-to-days of
//     passing VG1. Manual review is too slow — weekly cadence catches new
//     burns before warmup-day-1 lands.
//
// Default scope:
//   * status='active' AND provisioning_job_id IS NOT NULL
//   * Excludes Clouding-imported pairs (P1/P2/P3/P12 — provisioning_job_id
//     IS NULL). Their sending_domains rows are stale from the P1–P8 +
//     Salvage-Ionos migration; sweeping them produces false alarms.
//   * Override: pass `pair_ids: [...]` explicitly to scan any pair regardless
//     of provisioning_job_id (covers ad-hoc audit needs).
//
// What this handler does NOT do:
//   * Auto-remediate. We surface the alert and flip blacklist_status='burnt'.
//     Drop / delist / wait is Dean's call per-incident.
// ============================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  checkDomainBlacklist,
  type BlacklistResult,
} from '@/lib/provisioning/domain-blacklist';

// ============================================
// Types
// ============================================

export interface DblResweepJobData {
  /**
   * Internal organization id (text — the Supabase organizations.id, e.g.
   * 'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q'). Omit to sweep every org with at
   * least one in-scope pair.
   */
  org_id?: string;

  /**
   * Explicit pair ids to scan. When provided, the
   * `provisioning_job_id IS NOT NULL` exclusion is bypassed (callers know
   * what they're doing). Omit to scan every active saga-generated pair in
   * the targeted org(s).
   */
  pair_ids?: string[];

  triggered_by: 'cron' | 'manual' | 'test';
}

export interface DblResweepDeps {
  supabase: SupabaseClient;
  checkDomain: (domain: string) => Promise<BlacklistResult>;
  now: () => string;
}

interface BurnDetail {
  pair_id: string;
  pair_number: number | null;
  ns_domain: string | null;
  domain: string;
  lists: string[];
  method: string;
}

interface RunSummary {
  runId: string;
  orgId: string;
  pairsScanned: number;
  domainsScanned: number;
  newBurns: number;
}

// ============================================
// Default deps (real DB + real DNS)
// ============================================

function defaultDeps(): DblResweepDeps {
  return {
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    ),
    checkDomain: checkDomainBlacklist,
    now: () => new Date().toISOString(),
  };
}

// ============================================
// Per-org sweep
// ============================================

async function sweepOrg(
  orgId: string,
  data: DblResweepJobData,
  deps: DblResweepDeps
): Promise<RunSummary | null> {
  const { supabase, checkDomain, now } = deps;

  // 1. Discover in-scope pairs FIRST. Skip the org entirely if there are none —
  //    no point creating an empty sweep_run row that just clutters the audit log.
  let pairsQ = supabase
    .from('server_pairs')
    .select('id, pair_number, ns_domain, status, provisioning_job_id')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (data.pair_ids?.length) {
    // Explicit override — scan exactly these pairs regardless of
    // provisioning_job_id. (Clouding-imported pairs reachable this way
    // when an admin needs to ad-hoc audit them.)
    pairsQ = pairsQ.in('id', data.pair_ids);
  } else {
    // Default cron scope — saga-generated Linode pairs only.
    //
    // INVARIANT (do not relax without rolling-out new pair_id-based
    // sending_domains population for the imported pairs first):
    // pairs with provisioning_job_id IS NULL are the four Clouding-
    // imported pairs (P1, P2, P3, P12). Their sending_domains rows are
    // stale leftovers from the P1–P8 + Salvage-Ionos migration that
    // completed before Pair A/B; pairs 1, 3 have 0 rows and pair 2's
    // table doesn't reflect current sending state (Pair B Wave 4 halt
    // finding). Sweeping them produces false-positive alarms.
    //
    // Test pin: src/worker/handlers/__tests__/dbl-resweep.test.ts
    // case 5a (default scope skips) and 5b (explicit pair_ids overrides).
    pairsQ = pairsQ.not('provisioning_job_id', 'is', null);
  }

  const { data: pairs, error: pErr } = await pairsQ;
  if (pErr) throw new Error(`Failed to load pairs for org ${orgId}: ${pErr.message}`);
  if (!pairs || pairs.length === 0) return null;

  // 2. Insert running sweep_run row (only after we know we have something to do).
  const { data: runRow, error: runErr } = await supabase
    .from('dbl_sweep_runs')
    .insert({
      org_id: orgId,
      status: 'running',
      trigger_source: data.triggered_by,
    })
    .select('id')
    .single();
  if (runErr || !runRow) {
    throw new Error(`Failed to create sweep_run for org ${orgId}: ${runErr?.message}`);
  }

  let domainsScanned = 0;
  const newBurns: BurnDetail[] = [];

  try {
    for (const pair of pairs) {
      const { data: sds, error: sdErr } = await supabase
        .from('sending_domains')
        .select('id, domain, blacklist_status, dbl_check_history')
        .eq('pair_id', pair.id);
      if (sdErr) {
        throw new Error(
          `Failed to load sending_domains for pair ${pair.id}: ${sdErr.message}`
        );
      }

      for (const sd of sds || []) {
        domainsScanned++;
        const checkedAt = now();

        let result: BlacklistResult;
        try {
          result = await checkDomain(sd.domain);
        } catch (err) {
          // Per-domain DNS failure shouldn't take down the sweep — record
          // the attempt and move on. Treat as "unknown" for history purposes.
          console.error(
            `[dbl-resweep] check failed for ${sd.domain} (pair ${pair.pair_number}):`,
            err instanceof Error ? err.message : err
          );
          const errorEntry = {
            checked_at: checkedAt,
            listed: false,
            status: 'unknown' as const,
            error: err instanceof Error ? err.message : String(err),
          };
          const history = appendHistory(sd.dbl_check_history, errorEntry);
          await supabase
            .from('sending_domains')
            .update({ last_dbl_check_at: checkedAt, dbl_check_history: history })
            .eq('id', sd.id);
          continue;
        }

        const historyEntry = {
          checked_at: checkedAt,
          listed: result.status === 'listed',
          status: result.status,
          lists: result.lists,
          method: result.method,
        };
        const updatedHistory = appendHistory(sd.dbl_check_history, historyEntry);

        const updates: Record<string, unknown> = {
          last_dbl_check_at: checkedAt,
          dbl_check_history: updatedHistory,
        };

        const isNewBurn =
          result.status === 'listed' && sd.blacklist_status !== 'burnt';

        if (isNewBurn) {
          updates.blacklist_status = 'burnt';
          updates.dbl_first_burn_at = checkedAt;

          // Insert system_alert. Schema (008_system_health.sql):
          // alert_type / severity / title / details (jsonb) / account_id /
          // acknowledged. There is NO subject/subject_type/message column.
          const { error: alertErr } = await supabase.from('system_alerts').insert({
            org_id: orgId,
            alert_type: 'dbl_burn',
            severity: 'critical',
            title: `DBL burn: ${sd.domain} (pair ${pair.pair_number})`,
            details: {
              domain: sd.domain,
              pair_id: pair.id,
              pair_number: pair.pair_number,
              ns_domain: pair.ns_domain,
              lists: result.lists,
              method: result.method,
              raw: result.raw,
              detected_at: checkedAt,
              trigger_source: data.triggered_by,
              message: `Sending domain ${sd.domain} on pair ${pair.pair_number} (${pair.ns_domain}) is newly DBL-listed (${result.lists.join(', ')}). Drop or delist before warmup-day-1.`,
            },
          });
          if (alertErr) {
            console.error(
              `[dbl-resweep] failed to insert system_alert for ${sd.domain}:`,
              alertErr.message
            );
            // Don't abort — still record the flip and continue.
          }

          newBurns.push({
            pair_id: pair.id,
            pair_number: pair.pair_number,
            ns_domain: pair.ns_domain,
            domain: sd.domain,
            lists: result.lists,
            method: result.method,
          });
        }

        const { error: updErr } = await supabase
          .from('sending_domains')
          .update(updates)
          .eq('id', sd.id);
        if (updErr) {
          console.error(
            `[dbl-resweep] failed to update sending_domain ${sd.id}:`,
            updErr.message
          );
        }
      }
    }

    // 3. Close the sweep_run row as completed.
    await supabase
      .from('dbl_sweep_runs')
      .update({
        completed_at: now(),
        status: 'completed',
        pairs_scanned: pairs.length,
        domains_scanned: domainsScanned,
        new_burns_found: newBurns.length,
        burns_detail: newBurns,
      })
      .eq('id', runRow.id);

    return {
      runId: runRow.id,
      orgId,
      pairsScanned: pairs.length,
      domainsScanned,
      newBurns: newBurns.length,
    };
  } catch (err) {
    // Mark the run failed so the dashboard shows an honest result.
    await supabase
      .from('dbl_sweep_runs')
      .update({
        completed_at: now(),
        status: 'failed',
        pairs_scanned: pairs.length,
        domains_scanned: domainsScanned,
        new_burns_found: newBurns.length,
        burns_detail: newBurns,
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', runRow.id);
    throw err;
  }
}

function appendHistory(
  prior: unknown,
  entry: Record<string, unknown>
): Record<string, unknown>[] {
  const arr = Array.isArray(prior) ? (prior as Record<string, unknown>[]) : [];
  return [...arr, entry].slice(-50);
}

// ============================================
// Public handler
// ============================================

/**
 * Sweep entry point. When `org_id` is set, scans only that org. Otherwise
 * iterates every org that has at least one in-scope pair.
 *
 * Inject `deps` from tests; production passes nothing and gets the real
 * DB + Spamhaus DQS resolver.
 */
export async function dblResweepHandler(
  data: DblResweepJobData,
  deps: DblResweepDeps = defaultDeps()
): Promise<{ runs: RunSummary[] }> {
  const orgIds: string[] = [];

  if (data.org_id) {
    orgIds.push(data.org_id);
  } else {
    const { data: orgs, error: orgErr } = await deps.supabase
      .from('organizations')
      .select('id');
    if (orgErr) {
      throw new Error(`Failed to load organizations: ${orgErr.message}`);
    }
    for (const o of orgs || []) orgIds.push(o.id as string);
  }

  const runs: RunSummary[] = [];
  for (const orgId of orgIds) {
    const summary = await sweepOrg(orgId, data, deps);
    if (summary) runs.push(summary);
  }

  console.log(
    `[dbl-resweep] Completed sweep — orgs=${orgIds.length} runs=${runs.length} ` +
      `pairs=${runs.reduce((a, r) => a + r.pairsScanned, 0)} ` +
      `domains=${runs.reduce((a, r) => a + r.domainsScanned, 0)} ` +
      `newBurns=${runs.reduce((a, r) => a + r.newBurns, 0)}`
  );
  return { runs };
}
