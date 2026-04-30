import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveLeadContactForEmail } from '@/lib/email/contact-lookup';

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

// V1+b: thread-scoped unsubscribe. Resolves the contact behind the most
// recent inbound message and sets `lead_contacts.unsubscribed_at`.
//
// Idempotent: calling twice returns `already_unsubscribed: true` on the
// second call. Returns 404 if no inbound message has a matching lead_contact.
export async function POST(
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

    // Most recent inbound message — its from_email is the contact behind the
    // thread. Sent messages would surface our OWN account email, so we filter
    // direction='received'.
    const { data: msg } = await supabase
      .from('inbox_messages')
      .select('from_email')
      .eq('thread_id', id)
      .eq('org_id', orgId)
      .eq('direction', 'received')
      .order('received_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!msg?.from_email) {
      return NextResponse.json(
        { error: 'No inbound message found for thread' },
        { status: 404 }
      );
    }

    const contact = await resolveLeadContactForEmail(supabase, orgId, msg.from_email);
    if (!contact) {
      return NextResponse.json(
        { error: 'No lead contact found for this email', from_email: msg.from_email },
        { status: 404 }
      );
    }

    if (contact.unsubscribed_at) {
      return NextResponse.json({
        ok: true,
        contact_id: contact.id,
        unsubscribed_at: contact.unsubscribed_at,
        already_unsubscribed: true,
      });
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('lead_contacts')
      .update({ unsubscribed_at: now, updated_at: now })
      .eq('id', contact.id)
      .eq('org_id', orgId)
      .is('unsubscribed_at', null);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      contact_id: contact.id,
      unsubscribed_at: now,
      already_unsubscribed: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('organization') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
