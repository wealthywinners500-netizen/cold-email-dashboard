/**
 * Phase 2 — real fallback account selector.
 *
 * Called on two occasions:
 *   1. Inactive original account + preserved thread (eager fallback).
 *   2. Original account at daily cap (lazy reassignment — pg-boss retry).
 *
 * Both paths share the same selection algorithm:
 *
 *   1. org_id match, status = 'active', id != excludeAccountId
 *   2. exclude accounts tagged 'snov-warmup' (reserved for Snov warmup pool)
 *   3. exclude accounts that have already sent to this recipient
 *      (avoid cross-contamination — a recipient seeing mail from multiple
 *      addresses in the same org looks like spam to mailbox providers)
 *   4. exclude accounts at or above their base daily_send_limit
 *   5. prefer same server_pair_id when supplied — warmed-up reputation
 *      locality. If no same-pair candidate, drop the preference.
 *   6. tie-break: most remaining headroom (daily_send_limit - sends_today)
 *      wins. Deterministic under equal headroom: sort by id as a secondary
 *      key so retries of the same input pick the same account.
 *
 * Returns the full candidate row (caller needs id for reassignment,
 * email/server_pair_id for logging and subsequent send).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface SelectFallbackAccountArgs {
  orgId: string;
  recipientId: string;
  excludeAccountId: string;
  preferServerPairId?: string;
  supabase?: SupabaseClient;
}

export interface FallbackCandidate {
  id: string;
  email: string;
  server_pair_id: string | null;
  daily_send_limit: number;
  sends_today: number;
  status: string;
  tags: string[] | null;
}

export async function selectFallbackAccount(
  args: SelectFallbackAccountArgs
): Promise<FallbackCandidate | null> {
  const supabase = args.supabase ?? getSupabase();

  // Step 1: active, non-excluded accounts in the org.
  const { data: rows, error: rowsErr } = await supabase
    .from('email_accounts')
    .select('id, email, server_pair_id, daily_send_limit, sends_today, status, tags')
    .eq('org_id', args.orgId)
    .eq('status', 'active')
    .neq('id', args.excludeAccountId);

  if (rowsErr) {
    console.error('[fallback-account] email_accounts query failed:', rowsErr.message);
    return null;
  }
  if (!rows || rows.length === 0) return null;

  const accounts = rows as FallbackCandidate[];

  // Step 2: drop snov-warmup-tagged accounts.
  const nonWarmup = accounts.filter((a) => {
    const tags = Array.isArray(a.tags) ? a.tags : [];
    return !tags.includes('snov-warmup');
  });
  if (nonWarmup.length === 0) return null;

  // Step 3: drop accounts that already sent to this recipient (cross-contamination).
  const candidateIds = nonWarmup.map((a) => a.id);
  const { data: prevSends, error: sendsErr } = await supabase
    .from('email_send_log')
    .select('account_id')
    .eq('recipient_id', args.recipientId)
    .eq('status', 'sent')
    .in('account_id', candidateIds);

  if (sendsErr) {
    console.error('[fallback-account] email_send_log query failed:', sendsErr.message);
    return null;
  }
  const contaminated = new Set<string>();
  for (const row of prevSends ?? []) {
    const id = (row as { account_id: string | null }).account_id;
    if (id) contaminated.add(id);
  }
  const uncontaminated = nonWarmup.filter((a) => !contaminated.has(a.id));
  if (uncontaminated.length === 0) return null;

  // Step 4: drop accounts at or above their base daily cap.
  const underCap = uncontaminated.filter(
    (a) => (a.sends_today ?? 0) < (a.daily_send_limit ?? 0)
  );
  if (underCap.length === 0) return null;

  // Step 5: same-pair preference (if supplied and any candidate matches).
  let pool = underCap;
  if (args.preferServerPairId) {
    const samePair = underCap.filter((a) => a.server_pair_id === args.preferServerPairId);
    if (samePair.length > 0) pool = samePair;
  }

  // Step 6: most-headroom wins, deterministic id tie-break.
  pool.sort((a, b) => {
    const headroomA = (a.daily_send_limit ?? 0) - (a.sends_today ?? 0);
    const headroomB = (b.daily_send_limit ?? 0) - (b.sends_today ?? 0);
    if (headroomA !== headroomB) return headroomB - headroomA;
    return a.id.localeCompare(b.id);
  });

  return pool[0] ?? null;
}
