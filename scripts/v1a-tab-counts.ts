/**
 * V1+a tab-count verification.
 *
 * Runs the 6 tab predicates from src/lib/inbox/tab-routing.ts against a live
 * snapshot of inbox_threads (joined with email_accounts.email for the
 * known_senders set). Used by the V1+a deploy report to capture the post-
 * drain partition.
 *
 * Usage (from repo root):
 *   set -a; . /opt/dashboard-worker/.env; set +a; npx tsx scripts/v1a-tab-counts.ts
 *
 * Or locally with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';
import {
  isWarmUpThread,
  isInterestedThread,
  isHotLeadThread,
  isBouncedThread,
  isSpamThread,
  isAllThread,
  ThreadLike,
} from '../src/lib/inbox/tab-routing';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function fetchAllThreadsForOrg(orgId: string): Promise<(ThreadLike & { id: number })[]> {
  const sb = getSupabase();
  const all: (ThreadLike & { id: number })[] = [];
  // Pull in pages of 1000 to side-step PostgREST's default 1000-row cap.
  let from = 0;
  while (true) {
    const to = from + 999;
    const { data, error } = await sb
      .from('inbox_threads')
      .select('id, subject, participants, account_emails, latest_classification')
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as any));
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function buildKnownSenders(orgId: string): Promise<Set<string>> {
  const sb = getSupabase();
  const known = new Set<string>();
  const { data: accts } = await sb
    .from('email_accounts')
    .select('email')
    .eq('org_id', orgId);
  for (const a of accts || []) if (a?.email) known.add(String(a.email).toLowerCase());
  const { data: contacts } = await sb
    .from('lead_contacts')
    .select('email')
    .eq('org_id', orgId);
  for (const c of contacts || []) if (c?.email) known.add(String(c.email).toLowerCase());
  return known;
}

async function main() {
  // Single-tenant lock — Dean's org. (id is org_id text in this schema.)
  const { data: orgs } = await getSupabase().from('organizations').select('id').limit(5);
  for (const o of orgs || []) {
    const orgId = o.id as string;
    console.log(`\n=== org_id=${orgId} ===`);
    const known = await buildKnownSenders(orgId);
    const threads = await fetchAllThreadsForOrg(orgId);
    console.log(`fetched threads: ${threads.length}`);

    let all = 0,
      warmup = 0,
      interested = 0,
      hotleads = 0,
      bounced = 0,
      spam = 0;
    for (const t of threads) {
      if (isAllThread(t, known)) all++;
      if (isWarmUpThread(t)) warmup++;
      if (isInterestedThread(t, known)) interested++;
      if (isHotLeadThread(t, known)) hotleads++;
      if (isBouncedThread(t)) bounced++;
      if (isSpamThread(t, known)) spam++;
    }

    console.log('--- 6-tab counts (V1+a) ---');
    console.log(`  All        ${all}`);
    console.log(`  Warm Up    ${warmup}`);
    console.log(`  Interested ${interested}`);
    console.log(`  Hot Leads  ${hotleads}`);
    console.log(`  Bounced    ${bounced}`);
    console.log(`  Spam       ${spam}`);
    console.log('--- partition check (Warm Up + Bounced + Spam + All == total) ---');
    console.log(`  ${warmup} + ${bounced} + ${spam} + ${all} = ${warmup + bounced + spam + all}  (total ${threads.length})`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
