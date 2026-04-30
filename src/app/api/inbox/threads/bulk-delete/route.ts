import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const MAX_BULK_DELETE = 500;

async function getInternalOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) throw new Error('No organization selected');

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();

  if (error || !data) throw new Error('Organization not found');
  return data.id;
}

// V1+b bulk soft-delete. Body shape: { thread_ids: number[] }. Hard cap at
// MAX_BULK_DELETE to keep a single request bounded.
export async function POST(request: NextRequest) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const body = await request.json().catch(() => null);

    const raw = (body && Array.isArray(body.thread_ids)) ? body.thread_ids : null;
    if (!raw) {
      return NextResponse.json(
        { error: 'thread_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    const ids = raw
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isFinite(n) && n > 0);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'thread_ids must contain at least one valid id' },
        { status: 400 }
      );
    }
    if (ids.length > MAX_BULK_DELETE) {
      return NextResponse.json(
        { error: `thread_ids exceeds max of ${MAX_BULK_DELETE}` },
        { status: 413 }
      );
    }

    const now = new Date().toISOString();

    // Cascade messages first so a partial-failure leaves rows tagged as
    // deleted at message-level even if the thread row update later errors.
    const { error: msgErr } = await supabase
      .from('inbox_messages')
      .update({ deleted_at: now })
      .in('thread_id', ids)
      .eq('org_id', orgId)
      .is('deleted_at', null);

    if (msgErr) {
      // Surface failure as system_alert so it doesn't disappear silently.
      await supabase.from('system_alerts').insert({
        org_id: orgId,
        alert_type: 'bulk_delete_error',
        severity: 'warning',
        title: 'Bulk inbox delete: message update failed',
        details: { error: msgErr.message?.substring(0, 500), thread_ids_len: ids.length },
      });
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    const { data: updated, error: threadErr } = await supabase
      .from('inbox_threads')
      .update({ deleted_at: now, updated_at: now })
      .in('id', ids)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .select('id');

    if (threadErr) {
      await supabase.from('system_alerts').insert({
        org_id: orgId,
        alert_type: 'bulk_delete_error',
        severity: 'warning',
        title: 'Bulk inbox delete: thread update failed',
        details: { error: threadErr.message?.substring(0, 500), thread_ids_len: ids.length },
      });
      return NextResponse.json({ error: threadErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      deleted: updated?.length ?? 0,
      requested: ids.length,
      deleted_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('organization') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
