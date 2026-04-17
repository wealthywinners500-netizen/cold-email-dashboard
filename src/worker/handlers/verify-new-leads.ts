import { createClient } from '@supabase/supabase-js';
import { verifyOne } from '@/lib/leads/verification-service';
import { mapReoonStatus } from '@/lib/leads/reoon-status';
import { shouldDropByPrefix } from '@/lib/leads/prefix-filter';

interface LeadContact {
  id: string;
  org_id: string;
  email: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleVerifyNewLeads(payload: { orgId: string }) {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // TODO(phase-3): wrap in getDecryptedKey (BYOK via AES-256-GCM).
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('integrations')
    .eq('id', payload.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(
      `[verify-new-leads] Failed to fetch organization ${payload.orgId}: ${orgError?.message ?? 'not found'}`
    );
  }

  const reoonApiKey = (org.integrations as { reoon_api_key?: string } | null)?.reoon_api_key;
  if (!reoonApiKey) {
    throw new Error(
      `[verify-new-leads] Org ${payload.orgId} has no reoon_api_key in integrations`
    );
  }

  const { data: leads, error: fetchError } = await supabase
    .from('lead_contacts')
    .select('id, org_id, email')
    .eq('org_id', payload.orgId)
    .eq('email_status', 'pending')
    .not('email', 'is', null)
    .limit(500);

  if (fetchError) {
    throw new Error(`Failed to fetch pending leads: ${fetchError.message}`);
  }

  if (!leads || leads.length === 0) {
    console.log(
      `[verify-new-leads] No pending leads found for org ${payload.orgId}`
    );
    return;
  }

  console.log(
    `[verify-new-leads] Processing ${leads.length} pending leads for org ${payload.orgId}`
  );

  let validCount = 0;
  let roleAccountCount = 0;
  let catchAllCount = 0;
  let invalidCount = 0;
  let unknownCount = 0;
  let suppressedCount = 0;
  let prefixDroppedCount = 0;

  for (const lead of leads as LeadContact[]) {
    // Prefix filter — don't spend Reoon credits on dead-end addresses.
    if (shouldDropByPrefix(lead.email)) {
      await supabase
        .from('lead_contacts')
        .update({
          email_status: 'invalid',
          verified_at: now,
          verification_source: 'prefix_filter',
        })
        .eq('id', lead.id);
      prefixDroppedCount++;
      continue;
    }

    try {
      const r = await verifyOne(reoonApiKey, lead.email);
      const m = mapReoonStatus(r.status);

      await supabase
        .from('lead_contacts')
        .update({
          email_status: m.email_status,
          reoon_raw_status: r.status,
          reoon_overall_score: r.overall_score ?? null,
          reoon_is_role_account: !!r.is_role_account,
          reoon_is_catch_all: !!r.is_catch_all,
          reoon_verified_at: now,
          verified_at: now,
          verification_source: 'reoon',
        })
        .eq('id', lead.id);

      if (m.email_status === 'valid') validCount++;
      else if (m.email_status === 'role_account') roleAccountCount++;
      else if (m.email_status === 'catch_all') catchAllCount++;
      else if (m.email_status === 'invalid') invalidCount++;
      else if (m.email_status === 'unknown') unknownCount++;

      if (m.auto_suppress) {
        const { error: suppressionError } = await supabase
          .from('suppression_list')
          .upsert(
            {
              org_id: lead.org_id,
              email: lead.email,
              reason: 'reoon_spamtrap',
              source: 'verify-new-leads',
            },
            { onConflict: 'org_id,email', ignoreDuplicates: true }
          );
        if (suppressionError) {
          console.error(
            `[verify-new-leads] Failed to suppress ${lead.email}: ${suppressionError.message}`
          );
        } else {
          suppressedCount++;
        }
      }
    } catch (emailError) {
      console.error(
        `[verify-new-leads] Reoon verify failed for ${lead.email}:`,
        emailError
      );
      await supabase
        .from('lead_contacts')
        .update({
          email_status: 'unknown',
          verified_at: now,
          verification_source: 'reoon',
        })
        .eq('id', lead.id);
      unknownCount++;
    }

    await sleep(100);
  }

  console.log(
    `[verify-new-leads] org=${payload.orgId} ` +
      `valid=${validCount} role_account=${roleAccountCount} ` +
      `catch_all=${catchAllCount} invalid=${invalidCount} ` +
      `unknown=${unknownCount} prefix_dropped=${prefixDroppedCount} ` +
      `suppressed=${suppressedCount}`
  );
}
