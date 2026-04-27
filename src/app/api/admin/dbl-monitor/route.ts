// ============================================
// GET /api/admin/dbl-monitor
//
// Admin-only. Returns:
//   * last 10 dbl_sweep_runs for the caller's org
//   * all active pairs for the caller's org (any provisioning_job_id state —
//     UI shows the Clouding pairs as informational, but the cron only sweeps
//     saga-generated pairs)
//   * all sending_domains for those pairs
//
// Scoped by the caller's internal org id; no cross-org leakage.
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();
  return data?.id || null;
}

export async function GET() {
  const { orgRole } = await auth();
  if (orgRole !== 'org:admin') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createAdminClient();

  const { data: runs, error: runsErr } = await supabase
    .from('dbl_sweep_runs')
    .select(
      'id, started_at, completed_at, status, pairs_scanned, domains_scanned, new_burns_found, burns_detail, error_message, trigger_source'
    )
    .eq('org_id', orgId)
    .order('started_at', { ascending: false })
    .limit(10);

  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 });
  }

  const { data: pairs, error: pairsErr } = await supabase
    .from('server_pairs')
    .select(
      'id, pair_number, ns_domain, total_accounts, warmup_day, status, provisioning_job_id'
    )
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('pair_number', { ascending: true });

  if (pairsErr) {
    return NextResponse.json({ error: pairsErr.message }, { status: 500 });
  }

  const pairIds = (pairs || []).map((p) => p.id);
  const { data: domains, error: domainsErr } = pairIds.length
    ? await supabase
        .from('sending_domains')
        .select(
          'id, pair_id, domain, blacklist_status, last_dbl_check_at, dbl_first_burn_at, dbl_check_history, primary_server_id'
        )
        .in('pair_id', pairIds)
    : { data: [], error: null };

  if (domainsErr) {
    return NextResponse.json({ error: domainsErr.message }, { status: 500 });
  }

  return NextResponse.json({
    runs: runs || [],
    pairs: pairs || [],
    domains: domains || [],
  });
}
