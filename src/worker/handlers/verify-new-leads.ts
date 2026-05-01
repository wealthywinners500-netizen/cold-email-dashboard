// V8 fix (2026-04-30): rewritten — closes V7 punch #24 (verification_result
// persistence), #26 (orphan handler — pre-rewrite this file referenced a
// non-existent verification_status column and a stale local Reoon mapper), and
// #27 (real-email Reoon smoke through the worker path).
//
// Consumes the canonical exports from src/lib/leads/verification-service.ts
// (PR #31 sha 7753a79) — `verifyEmail` + `mapReoonStatus`. Uses verifyEmail
// per-row (not verifyBatch) because verifyBatch only returns email_status
// while we need the raw Reoon response to populate lead_contacts.verification_result
// JSONB (mig 024).
//
// Schema column writes are mirrored from src/app/api/lead-contacts/verify/route.ts:
//   email_status, verified_at, verification_source='reoon', verification_result.
// The pre-rewrite handler wrote `verification_status` which has never existed on
// lead_contacts (audit confirmed via REST: HTTP 42703 column does not exist).

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyEmail } from '@/lib/leads/verification-service';

interface VerifyNewLeadsPayload {
  orgId: string;
  lead_list_id?: string;
}

interface LeadContactRow {
  id: string;
  email: string;
}

// DI hook (test-only). Default uses real createClient. Tests can override
// via __setSupabaseFactoryForTests to inject a stub. NOT exported through
// any public surface — only consumed by __tests__/verify-new-leads.test.ts.
let supabaseFactory: () => SupabaseClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

export function __setSupabaseFactoryForTests(factory: () => SupabaseClient): void {
  supabaseFactory = factory;
}

export function __resetSupabaseFactoryForTests(): void {
  supabaseFactory = () =>
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
}

const FETCH_LIMIT = 5000;
const VERIFY_CONCURRENCY = 10;
const UPDATE_BATCH_SIZE = 50;

export async function handleVerifyNewLeads(payload: VerifyNewLeadsPayload) {
  const supabase = supabaseFactory();
  const reoonApiKey = process.env.REOON_API_KEY;

  if (!reoonApiKey) {
    throw new Error('REOON_API_KEY environment variable not set');
  }

  const scopeLabel = payload.lead_list_id ?? '<all-pending>';

  let query = supabase
    .from('lead_contacts')
    .select('id, email')
    .eq('org_id', payload.orgId)
    .eq('email_status', 'pending')
    .not('email', 'is', null);

  if (payload.lead_list_id) {
    query = query.eq('lead_list_id', payload.lead_list_id);
  }

  const { data: leads, error: fetchError } = await query.limit(FETCH_LIMIT);

  if (fetchError) {
    throw new Error(`Failed to fetch pending leads: ${fetchError.message}`);
  }

  if (!leads || leads.length === 0) {
    console.log(
      `[verify-new-leads] org=${payload.orgId} list=${scopeLabel} — no pending leads`
    );
    return;
  }

  const rows = leads as LeadContactRow[];
  console.log(
    `[verify-new-leads] org=${payload.orgId} list=${scopeLabel} verifying=${rows.length}`
  );

  const now = new Date().toISOString();
  type PerRowResult = {
    id: string;
    email: string;
    email_status: 'valid' | 'invalid' | 'risky' | 'unknown';
    raw_result: unknown;
  };
  const verified: PerRowResult[] = [];
  const skipped: { id: string; email: string; error: string }[] = [];

  // Concurrent verification via per-email verifyEmail (returns raw_result we
  // need for verification_result JSONB). Concurrency 10 mirrors verifyBatch's
  // small-batch path.
  for (let i = 0; i < rows.length; i += VERIFY_CONCURRENCY) {
    const chunk = rows.slice(i, i + VERIFY_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(async (row) => {
        const result = await verifyEmail(reoonApiKey, row.email);
        return { id: row.id, email: row.email, ...result };
      })
    );
    settled.forEach((r, idx) => {
      const row = chunk[idx];
      if (r.status === 'fulfilled') {
        verified.push(r.value);
      } else {
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        skipped.push({ id: row.id, email: row.email, error: errMsg });
        console.error(
          `[verify-new-leads] Reoon failed for ${row.email}: ${errMsg}`
        );
      }
    });
  }

  // Update lead_contacts in chunks of 50 with Promise.all (mirrors
  // src/app/api/lead-contacts/verify/route.ts:147-163).
  let validCount = 0;
  let invalidCount = 0;
  let riskyCount = 0;
  let unknownCount = 0;
  for (const r of verified) {
    if (r.email_status === 'valid') validCount++;
    else if (r.email_status === 'invalid') invalidCount++;
    else if (r.email_status === 'risky') riskyCount++;
    else unknownCount++;
  }

  for (let i = 0; i < verified.length; i += UPDATE_BATCH_SIZE) {
    const batch = verified.slice(i, i + UPDATE_BATCH_SIZE);
    await Promise.all(
      batch.map((r) =>
        supabase
          .from('lead_contacts')
          .update({
            email_status: r.email_status,
            verified_at: now,
            verification_source: 'reoon',
            verification_result: r.raw_result as Record<string, unknown>,
          })
          .eq('id', r.id)
      )
    );
  }

  console.log(
    `[verify-new-leads] org=${payload.orgId} list=${scopeLabel} verified=${verified.length} valid=${validCount} invalid=${invalidCount} risky=${riskyCount} unknown=${unknownCount} skipped=${skipped.length}`
  );
}
