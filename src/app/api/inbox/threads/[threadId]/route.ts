import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { threadId } = await params;

    // Get all non-deleted messages in thread
    const { data: messages, error } = await supabase
      .from('inbox_messages')
      .select('*')
      .eq('thread_id', parseInt(threadId))
      .eq('org_id', orgId)
      .is('deleted_at', null) // V1+b: hide soft-deleted
      .order('received_date', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get thread info (404 if soft-deleted)
    const { data: thread } = await supabase
      .from('inbox_threads')
      .select('*')
      .eq('id', parseInt(threadId))
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .single();

    return NextResponse.json({ thread, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { threadId } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (typeof body.is_read === 'boolean') updates.has_unread = !body.is_read;
    if (typeof body.is_starred === 'boolean') updates.is_starred = body.is_starred;
    if (typeof body.is_archived === 'boolean') updates.is_archived = body.is_archived;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('inbox_threads')
      .update(updates)
      .eq('id', parseInt(threadId))
      .eq('org_id', orgId)
      .is('deleted_at', null) // V1+b: cannot patch a deleted thread
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If marking as read, also mark all messages in thread as read
    if (typeof body.is_read === 'boolean' && body.is_read) {
      await supabase
        .from('inbox_messages')
        .update({ is_read: true })
        .eq('thread_id', parseInt(threadId))
        .eq('org_id', orgId)
        .eq('is_read', false);
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

// V1+b: soft-delete a thread + all its messages.
// Per spec: deleted_at is set on inbox_threads + every inbox_messages row in
// the thread. Rows stay in DB; UI excludes; IMAP sync respects.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { threadId } = await params;

    const id = parseInt(threadId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { data: thread, error: threadErr } = await supabase
      .from('inbox_threads')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null) // idempotent — re-delete is no-op
      .select('id, deleted_at')
      .maybeSingle();

    if (threadErr) {
      return NextResponse.json({ error: threadErr.message }, { status: 500 });
    }

    // Even if the thread was already deleted, fan out to messages — covers
    // the rare case where a previous bulk-delete partial-failed.
    await supabase
      .from('inbox_messages')
      .update({ deleted_at: now })
      .eq('thread_id', id)
      .eq('org_id', orgId)
      .is('deleted_at', null);

    return NextResponse.json({
      ok: true,
      thread_id: id,
      deleted_at: thread?.deleted_at ?? now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('organization') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
