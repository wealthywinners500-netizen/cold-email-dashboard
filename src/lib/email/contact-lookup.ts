// V1+b: shared helper for resolving an inbox_message back to its lead_contact
// row. Used by:
//   * sync-inbox.ts auto-unsub on STOP (looks up the contact by from_email)
//   * lead-contacts/[id]/unsubscribe API route (verifies ownership)
//
// Resolution: case-insensitive email match within the same org.
// `lead_contacts` has UNIQUE(org_id, email) (migration 007), so at most one
// row matches per org — no ambiguity possible.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LeadContactRef {
  id: string;
  unsubscribed_at: string | null;
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export async function resolveLeadContactForEmail(
  supabase: SupabaseClient,
  orgId: string,
  rawEmail: string | null | undefined
): Promise<LeadContactRef | null> {
  const normalized = normalizeEmail(rawEmail);
  if (!normalized) return null;
  const { data } = await supabase
    .from('lead_contacts')
    .select('id, unsubscribed_at')
    .eq('org_id', orgId)
    .ilike('email', normalized)
    .maybeSingle();
  return (data as LeadContactRef | null) ?? null;
}
