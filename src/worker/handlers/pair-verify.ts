// ============================================
// pg-boss handler for 'pair-verify' job.
//
// Loads the pre-inserted pair_verifications row, flips it to 'running',
// executes runPairVerification(), then writes the final status / checks /
// duration_ms back. All failures are captured into the row itself — the
// handler body doesn't re-throw (other than what pg-boss needs for its
// own retry semantics in withErrorHandling at the worker level).
// ============================================

import { createClient } from '@supabase/supabase-js';
import { runPairVerification } from '../../lib/provisioning/pair-verify';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface PairVerifyPayload {
  verificationId: string;
}

export async function handlePairVerify(
  data: PairVerifyPayload
): Promise<void> {
  const { verificationId } = data;
  const supabase = getSupabase();

  console.log(`[PairVerify] Starting verification ${verificationId}`);

  // Load the verification row to discover the pair_id
  const { data: vrow, error: vErr } = await supabase
    .from('pair_verifications')
    .select('id, pair_id, status')
    .eq('id', verificationId)
    .single();

  if (vErr || !vrow) {
    console.error(
      `[PairVerify] Verification ${verificationId} not found:`,
      vErr?.message
    );
    return;
  }

  // Transition to 'running' (if not already)
  if (vrow.status !== 'running') {
    await supabase
      .from('pair_verifications')
      .update({ status: 'running' })
      .eq('id', verificationId);
  }

  try {
    const report = await runPairVerification(vrow.pair_id, supabase);

    await supabase
      .from('pair_verifications')
      .update({
        status: report.status,
        checks: report.checks,
        duration_ms: report.duration_ms,
        completed_at: new Date().toISOString(),
      })
      .eq('id', verificationId);

    console.log(
      `[PairVerify] Verification ${verificationId} completed: ${report.status} (${report.duration_ms}ms)`
    );
  } catch (err) {
    // Capture the error into the row rather than propagating out —
    // pg-boss would otherwise retry this job and the user-visible row
    // would stay stuck in 'running' until another attempt completed.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PairVerify] Verification ${verificationId} threw:`, message);

    await supabase
      .from('pair_verifications')
      .update({
        status: 'red',
        checks: [
          {
            name: 'handler_error',
            result: 'fail',
            details: { error: message },
            is_sem_warning: false,
          },
        ],
        completed_at: new Date().toISOString(),
      })
      .eq('id', verificationId);
  }
}
