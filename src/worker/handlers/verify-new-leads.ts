import { createClient } from '@supabase/supabase-js';

interface LeadContact {
  id: string;
  org_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  verification_status: string;
  created_at: string;
}

interface VerificationResult {
  email: string;
  status: string;
  details?: Record<string, unknown>;
}

interface LeadContactUpdate {
  id: string;
  org_id: string;
  email: string;
  verification_status: string;
  verification_result: Record<string, unknown>;
}

interface SuppressionListEntry {
  org_id: string;
  email: string;
  reason: string;
  source: string;
}

// Reoon API response types
interface ReoonResponse {
  result?: string;
  status?: string;
  [key: string]: unknown;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyEmailWithReoon(
  email: string,
  apiKey: string
): Promise<VerificationResult> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        'https://emailverifier.reoon.com/api/v1/verify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            key: apiKey,
            mode: 'power',
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Reoon API error (${response.status}): ${errorText}`
        );
      }

      const data: ReoonResponse = await response.json();

      // Map Reoon result to verification status
      let verificationStatus = 'unknown';
      if (data.result === 'safe') {
        verificationStatus = 'valid';
      } else if (
        data.result === 'invalid' ||
        data.result === 'disabled' ||
        data.result === 'disposable'
      ) {
        verificationStatus = 'invalid';
      }

      return {
        email,
        status: verificationStatus,
        details: data,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        // Exponential backoff: 100ms, 200ms, 400ms
        const backoffMs = 100 * Math.pow(2, attempt - 1);
        await sleep(backoffMs);
        continue;
      }
    }
  }

  // If all retries failed, return unknown status
  console.error(
    `[verify-new-leads] Reoon verification failed for ${email} after ${maxRetries} retries:`,
    lastError
  );

  return {
    email,
    status: 'unknown',
    details: {
      error: lastError?.message || 'Unknown error',
      retries: maxRetries,
    },
  };
}

export async function handleVerifyNewLeads(payload: { orgId: string }) {
  const supabase = getSupabase();
  const reoonApiKey = process.env.REOON_API_KEY;

  if (!reoonApiKey) {
    throw new Error('REOON_API_KEY environment variable not set');
  }

  try {
    // Fetch unverified leads for this organization (limit 500)
    const { data: leads, error: fetchError } = await supabase
      .from('lead_contacts')
      .select(
        'id, org_id, email, first_name, last_name, company_name, verification_status, created_at'
      )
      .eq('org_id', payload.orgId)
      .eq('verification_status', 'unverified')
      .limit(500);

    if (fetchError) {
      throw new Error(`Failed to fetch unverified leads: ${fetchError.message}`);
    }

    if (!leads || leads.length === 0) {
      console.log(
        `[verify-new-leads] No unverified leads found for org ${payload.orgId}`
      );
      return;
    }

    console.log(
      `[verify-new-leads] Processing ${leads.length} unverified leads for org ${payload.orgId}`
    );

    const leadUpdates: LeadContactUpdate[] = [];
    const suppressionEntries: SuppressionListEntry[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let unknownCount = 0;

    // Process in batches of 50 with rate limiting
    const batchSize = 50;
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = (leads as LeadContact[]).slice(i, i + batchSize);
      console.log(
        `[verify-new-leads] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(leads.length / batchSize)}`
      );

      // Verify each email in the batch with rate limiting
      for (const lead of batch) {
        try {
          const result = await verifyEmailWithReoon(
            lead.email,
            reoonApiKey
          );

          const verificationStatus =
            result.status === 'valid'
              ? 'valid'
              : result.status === 'invalid'
                ? 'invalid'
                : 'unknown';

          leadUpdates.push({
            id: lead.id,
            org_id: lead.org_id,
            email: lead.email,
            verification_status: verificationStatus,
            verification_result: result.details || {},
          });

          if (verificationStatus === 'valid') {
            validCount++;
          } else if (verificationStatus === 'invalid') {
            invalidCount++;

            // Add to suppression list
            suppressionEntries.push({
              org_id: lead.org_id,
              email: lead.email,
              reason: 'reoon_invalid',
              source: 'verify-new-leads',
            });
          } else {
            unknownCount++;
          }

          // Rate limit: 100ms delay between Reoon API calls
          await sleep(100);
        } catch (emailError) {
          console.error(
            `[verify-new-leads] Error verifying email ${lead.email}:`,
            emailError
          );

          // Mark as unknown on error
          leadUpdates.push({
            id: lead.id,
            org_id: lead.org_id,
            email: lead.email,
            verification_status: 'unknown',
            verification_result: {
              error:
                emailError instanceof Error
                  ? emailError.message
                  : String(emailError),
            },
          });

          unknownCount++;

          // Still apply rate limit even on error
          await sleep(100);
        }
      }
    }

    // Batch update lead contacts
    if (leadUpdates.length > 0) {
      for (const update of leadUpdates) {
        try {
          const { error: updateError } = await supabase
            .from('lead_contacts')
            .update({
              verification_status: update.verification_status,
              verification_result: update.verification_result,
            })
            .eq('id', update.id);

          if (updateError) {
            console.error(
              `[verify-new-leads] Failed to update lead ${update.id}: ${updateError.message}`
            );
          }
        } catch (updateError) {
          console.error(
            `[verify-new-leads] Error updating lead ${update.id}:`,
            updateError
          );
        }
      }

      console.log(`[verify-new-leads] Updated ${leadUpdates.length} leads`);
    }

    // Batch insert suppression list entries for invalid emails
    if (suppressionEntries.length > 0) {
      try {
        const { error: suppressionError } = await supabase
          .from('suppression_list')
          .insert(suppressionEntries);

        if (suppressionError) {
          console.error(
            `[verify-new-leads] Failed to insert suppression list entries: ${suppressionError.message}`
          );
        } else {
          console.log(
            `[verify-new-leads] Added ${suppressionEntries.length} emails to suppression list`
          );
        }
      } catch (suppressionError) {
        console.error(
          '[verify-new-leads] Error inserting suppression list entries:',
          suppressionError
        );
      }
    }

    console.log(
      `[verify-new-leads] Verification complete for org ${payload.orgId}: ${validCount} valid, ${invalidCount} invalid, ${unknownCount} unknown`
    );
  } catch (error) {
    console.error('[verify-new-leads] Fatal error:', error);
    throw error;
  }
}
