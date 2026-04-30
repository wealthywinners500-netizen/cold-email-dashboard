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

// V1+b: manual per-contact unsubscribe. Idempotent — calling on an already-
// unsubscribed contact returns ok:true without overwriting unsubscribed_at.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing contact id' }, { status: 400 });
    }

    // Fetch existing row first to check current state (idempotency check).
    const { data: existing, error: fetchErr } = await supabase
      .from('lead_contacts')
      .select('id, unsubscribed_at')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    if (existing.unsubscribed_at) {
      return NextResponse.json({
        ok: true,
        contact_id: id,
        unsubscribed_at: existing.unsubscribed_at,
        already_unsubscribed: true,
      });
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('lead_contacts')
      .update({ unsubscribed_at: now, updated_at: now })
      .eq('id', id)
      .eq('org_id', orgId)
      .is('unsubscribed_at', null);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      contact_id: id,
      unsubscribed_at: now,
      already_unsubscribed: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const status = message.includes('organization') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
