// ============================================
// GET /api/pairs/[id]/verifications
//
// Org-scoped list of pair_verifications for a pair, latest-first, limit 50.
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: pairId } = await params;
    const supabase = await createAdminClient();

    // Confirm the pair belongs to the caller's org (404 otherwise).
    const { data: pair, error: pairErr } = await supabase
      .from('server_pairs')
      .select('id')
      .eq('id', pairId)
      .eq('org_id', orgId)
      .single();

    if (pairErr || !pair) {
      return NextResponse.json({ error: 'Pair not found' }, { status: 404 });
    }

    const { data: rows, error } = await supabase
      .from('pair_verifications')
      .select('id, pair_id, status, checks, duration_ms, run_by, run_at, completed_at')
      .eq('pair_id', pairId)
      .order('run_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ verifications: rows ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
