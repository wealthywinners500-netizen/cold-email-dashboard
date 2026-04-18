// ============================================
// POST /api/pairs/[id]/verify
//
// Admin-only. Inserts a new pair_verifications row with status='running',
// enqueues the pg-boss 'pair-verify' job with { verificationId }, and
// returns 202 with the verification id.
// ============================================

import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getBoss, initBoss } from '@/lib/email/campaign-queue';

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

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // TODO(session-05 b14): swap for requireAdmin()
    const { userId, orgRole } = await auth();
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

    // Insert the running row first so the job has something to update.
    const { data: inserted, error: insErr } = await supabase
      .from('pair_verifications')
      .insert({
        pair_id: pairId,
        status: 'running',
        checks: [],
        run_by: userId ?? null,
      })
      .select('id')
      .single();

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: insErr?.message ?? 'Failed to create verification row' },
        { status: 500 }
      );
    }

    // Enqueue the job. initBoss is idempotent on subsequent calls — it just
    // returns the same singleton. We prefer it over getBoss() here so the
    // first caller in a cold serverless container triggers the start handshake.
    try {
      await initBoss();
      const boss = getBoss();
      await boss.send('pair-verify', { verificationId: inserted.id });
    } catch (queueErr) {
      // Mark the row failed so the UI doesn't spin forever.
      await supabase
        .from('pair_verifications')
        .update({
          status: 'red',
          checks: [
            {
              name: 'enqueue_failed',
              result: 'fail',
              details: {
                error:
                  queueErr instanceof Error ? queueErr.message : String(queueErr),
              },
              is_sem_warning: false,
            },
          ],
          completed_at: new Date().toISOString(),
        })
        .eq('id', inserted.id);

      return NextResponse.json(
        { error: 'Failed to enqueue verification job' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { verificationId: inserted.id },
      { status: 202 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
