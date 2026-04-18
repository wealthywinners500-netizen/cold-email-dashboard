// ============================================
// Server component: /dashboard/servers/[id]
//
// Loads the pair (org-scoped) + the latest 10 verifications, derives
// admin flag from Clerk's server-side auth(), and hands everything to
// the client component for interactive rendering.
// ============================================

import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import PairDetailClient from './pair-detail-client';
import type { PairSummary, VerificationRow } from './types';

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
  return (data?.id as string | undefined) ?? null;
}

export default async function PairDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgRole } = await auth();
  const isAdmin = orgRole === 'org:admin';

  const orgId = await getInternalOrgId();
  if (!orgId) notFound();

  const supabase = await createAdminClient();

  const { data: pairRow, error: pairErr } = await supabase
    .from('server_pairs')
    .select(
      'id, pair_number, ns_domain, s1_ip, s1_hostname, s2_ip, s2_hostname, status, warmup_day'
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .single();

  if (pairErr || !pairRow) notFound();

  const pair: PairSummary = {
    id: pairRow.id as string,
    pair_number: Number(pairRow.pair_number ?? 0),
    ns_domain: String(pairRow.ns_domain ?? ''),
    s1_ip: String(pairRow.s1_ip ?? ''),
    s1_hostname: String(pairRow.s1_hostname ?? ''),
    s2_ip: String(pairRow.s2_ip ?? ''),
    s2_hostname: String(pairRow.s2_hostname ?? ''),
    status: String(pairRow.status ?? ''),
    warmup_day: Number(pairRow.warmup_day ?? 0),
  };

  const { data: vrows } = await supabase
    .from('pair_verifications')
    .select(
      'id, pair_id, status, checks, duration_ms, run_by, run_at, completed_at'
    )
    .eq('pair_id', id)
    .order('run_at', { ascending: false })
    .limit(10);

  const initialVerifications: VerificationRow[] = (vrows ?? []).map(
    (r: Record<string, unknown>) => ({
      id: String(r.id),
      pair_id: String(r.pair_id),
      status: r.status as VerificationRow['status'],
      checks: Array.isArray(r.checks) ? (r.checks as VerificationRow['checks']) : [],
      duration_ms:
        r.duration_ms == null ? null : Number(r.duration_ms),
      run_by: r.run_by == null ? null : String(r.run_by),
      run_at: String(r.run_at),
      completed_at:
        r.completed_at == null ? null : String(r.completed_at),
    })
  );

  return (
    <PairDetailClient
      pair={pair}
      initialVerifications={initialVerifications}
      isAdmin={isAdmin}
    />
  );
}
