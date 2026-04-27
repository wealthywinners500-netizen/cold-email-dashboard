// ============================================
// POST /api/admin/dbl-monitor/run
//
// Admin-only. Manually triggers a DBL re-sweep for the caller's org.
// Enqueues the same pg-boss queue (dbl-resweep) the weekly cron uses, so
// the handler code path is identical.
//
// Body (optional): { pair_ids?: string[] }
//   * Pass pair_ids to scope the manual sweep to specific pairs
//     (override — bypasses the saga-only filter; covers Clouding-imported
//     pairs for ad-hoc audits).
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getBoss, initBoss } from '@/lib/email/campaign-queue';
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

export async function POST(req: Request) {
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

  let pairIds: string[] | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      pair_ids?: unknown;
    };
    if (Array.isArray(body.pair_ids)) {
      pairIds = body.pair_ids.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // Empty / non-JSON body is fine — sweep the whole org.
  }

  // If pair_ids was supplied, verify the pairs all belong to this org.
  // Without this check an admin in org A could trigger a sweep of org B's
  // pairs. We intentionally don't 404 — if some ids are wrong, drop them
  // silently and let the worker handle the rest.
  if (pairIds && pairIds.length > 0) {
    const supabase = await createAdminClient();
    const { data: owned } = await supabase
      .from('server_pairs')
      .select('id')
      .eq('org_id', orgId)
      .in('id', pairIds);
    pairIds = (owned || []).map((p) => p.id);
    if (pairIds.length === 0) {
      return NextResponse.json(
        { error: 'None of the requested pairs belong to your org' },
        { status: 404 }
      );
    }
  }

  try {
    await initBoss();
    const boss = getBoss();
    const jobId = await boss.send('dbl-resweep', {
      org_id: orgId,
      pair_ids: pairIds,
      triggered_by: 'manual',
    });
    return NextResponse.json({ jobId, status: 'enqueued' }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to enqueue sweep job',
      },
      { status: 500 }
    );
  }
}
