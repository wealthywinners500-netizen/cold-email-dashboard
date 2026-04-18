/**
 * Gate 0 regression C: Saga cascade guard tests
 *
 * Verifies:
 *   1. `assertPreviousStepOk` pure function correctly throws `SagaAborted`
 *      only for non-ok predecessor states, with the right abortedAt/reason.
 *   2. Integration: when step 1 fails, step 2's execute() is never invoked
 *      and step 1's error_message is preserved (not overwritten by the
 *      cascade marker).
 *
 * No Supabase, no network. Runs standalone via `npx tsx`.
 */

import { SagaAborted, assertPreviousStepOk } from '../saga-engine';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

// ============================================================================
// Pure-function tests: assertPreviousStepOk
// ============================================================================

function testPureCascadeGuard(): void {
  console.log('\n=== assertPreviousStepOk pure-function tests ===\n');

  // Case 1: no predecessor (first step) — must not throw
  assertPreviousStepOk(null, 'create_vps');
  assertPreviousStepOk(undefined, 'create_vps');
  console.log('✓ first step (prev=null/undefined) does not throw');

  // Case 2: predecessor completed — must not throw
  assertPreviousStepOk(
    { step_type: 'create_vps', status: 'completed', error_message: null },
    'set_ptr'
  );
  console.log('✓ predecessor completed does not throw');

  // Case 3: predecessor manual_required — must not throw (saga continues)
  assertPreviousStepOk(
    { step_type: 'verification_gate', status: 'manual_required' },
    'install_hestiacp'
  );
  console.log('✓ predecessor manual_required does not throw');

  // Case 4: predecessor skipped — must not throw
  assertPreviousStepOk(
    { step_type: 'setup_dns_zones', status: 'skipped' },
    'setup_mail_domains'
  );
  console.log('✓ predecessor skipped does not throw');

  // Case 5: predecessor failed with error_message — throws SagaAborted carrying the original error verbatim
  let caught: unknown = null;
  try {
    assertPreviousStepOk(
      {
        step_type: 'create_vps',
        status: 'failed',
        error_message: 'Linode API 500: out of capacity in us-ord',
      },
      'set_ptr'
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SagaAborted, 'failed predecessor should throw SagaAborted');
  const abortedFailed = caught as SagaAborted;
  assert(
    abortedFailed.abortedAt === 'create_vps',
    `abortedAt should be predecessor step_type, got "${abortedFailed.abortedAt}"`
  );
  assert(
    abortedFailed.reason === 'Linode API 500: out of capacity in us-ord',
    `reason should be the predecessor's verbatim error_message, got "${abortedFailed.reason}"`
  );
  assert(
    abortedFailed.name === 'SagaAborted',
    `error name should be "SagaAborted", got "${abortedFailed.name}"`
  );
  console.log('✓ predecessor failed throws SagaAborted with verbatim error_message');

  // Case 6: predecessor failed with empty error_message — throws SagaAborted with fallback reason
  caught = null;
  try {
    assertPreviousStepOk(
      { step_type: 'set_ptr', status: 'failed', error_message: '' },
      'install_hestiacp'
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SagaAborted, 'failed+empty-error should still throw');
  const abortedEmpty = caught as SagaAborted;
  assert(
    abortedEmpty.reason === 'previous step in status "failed"',
    `fallback reason should be status-based, got "${abortedEmpty.reason}"`
  );
  console.log('✓ failed predecessor with empty error_message uses fallback reason');

  // Case 7: predecessor pending — throws (stale state / corruption)
  caught = null;
  try {
    assertPreviousStepOk(
      { step_type: 'create_vps', status: 'pending' },
      'set_ptr'
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SagaAborted, 'pending predecessor should throw');
  assert(
    (caught as SagaAborted).reason === 'previous step in status "pending"',
    `pending reason should describe status, got "${(caught as SagaAborted).reason}"`
  );
  console.log('✓ predecessor pending throws SagaAborted');

  // Case 8: predecessor in_progress — throws (concurrent writer suspected)
  caught = null;
  try {
    assertPreviousStepOk(
      { step_type: 'create_vps', status: 'in_progress' },
      'set_ptr'
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SagaAborted, 'in_progress predecessor should throw');
  console.log('✓ predecessor in_progress throws SagaAborted');

  // Case 9: predecessor with unknown status — defensive abort
  caught = null;
  try {
    assertPreviousStepOk(
      { step_type: 'create_vps', status: 'garbage_state' },
      'set_ptr'
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SagaAborted, 'unknown status should abort defensively');
  console.log('✓ predecessor with unknown status throws defensively');
}

// ============================================================================
// SagaAborted class shape
// ============================================================================

function testSagaAbortedClass(): void {
  console.log('\n=== SagaAborted class shape ===\n');

  const err = new SagaAborted('step_x', 'reason_text');
  assert(err instanceof Error, 'SagaAborted extends Error');
  assert(err instanceof SagaAborted, 'instanceof SagaAborted works');
  assert(err.name === 'SagaAborted', `name should be "SagaAborted", got "${err.name}"`);
  assert(err.abortedAt === 'step_x', 'abortedAt prop');
  assert(err.reason === 'reason_text', 'reason prop');
  assert(
    err.message.includes('step_x') && err.message.includes('reason_text'),
    'message includes both abortedAt and reason'
  );
  console.log('✓ SagaAborted class shape is correct');
}

// ============================================================================
// Integration test: simulate a 2-step saga where step 1 fails
//
// This mirrors the SagaEngine inner loop closely enough to prove the
// cascade behavior without pulling in Supabase. Step rows are tracked in
// a local Map. Step 2 has a spy on its execute() that must never be called.
// Step 1's error_message must NOT be overwritten when the cascade fires.
// ============================================================================

interface FakeStepRow {
  step_type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' | 'manual_required';
  error_message?: string | null;
}

interface FakeStep {
  name: string;
  type: string;
  execute: () => Promise<{ success: boolean; error?: string }>;
}

async function testCascadeIntegration(): Promise<void> {
  console.log('\n=== Cascade integration: step1 fails → step2 never called ===\n');

  const stepRows = new Map<string, FakeStepRow>([
    ['create_vps', { step_type: 'create_vps', status: 'pending' }],
    ['set_ptr', { step_type: 'set_ptr', status: 'pending' }],
  ]);

  const ORIGINAL_STEP1_ERROR = 'Linode API 500: out of capacity in us-ord';
  let jobErrorMessage: string | null = null;
  let step2ExecuteCallCount = 0;

  const steps: FakeStep[] = [
    {
      name: 'Create VPS pair',
      type: 'create_vps',
      execute: async () => ({ success: false, error: ORIGINAL_STEP1_ERROR }),
    },
    {
      name: 'Set reverse DNS',
      type: 'set_ptr',
      execute: async () => {
        step2ExecuteCallCount++;
        return { success: true };
      },
    },
  ];

  // Inline mini-executor that mirrors SagaEngine's pre-step cascade guard.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const row = stepRows.get(step.type)!;

    // Cascade guard: before executing step N+1, assert step N is ok.
    if (i > 0) {
      const prev = stepRows.get(steps[i - 1].type);
      try {
        assertPreviousStepOk(prev, step.name);
      } catch (err) {
        if (err instanceof SagaAborted) {
          // Job-level marker, NOT a write to the predecessor row.
          jobErrorMessage = `Saga aborted at step "${err.abortedAt}": ${err.reason}`;
          break;
        }
        throw err;
      }
    }

    // Execute (only runs if cascade guard passed)
    const result = await step.execute();
    if (result.success) {
      row.status = 'completed';
      row.error_message = null;
    } else {
      row.status = 'failed';
      row.error_message = result.error ?? 'Unknown';
      jobErrorMessage = `Step "${step.name}" failed: ${result.error}`;
    }
  }

  // Assertions
  assert(
    step2ExecuteCallCount === 0,
    `step 2 execute() must NEVER be called when step 1 fails, got ${step2ExecuteCallCount} call(s)`
  );
  console.log('✓ step 2 execute() never called after step 1 failure');

  const step1Row = stepRows.get('create_vps')!;
  assert(
    step1Row.status === 'failed',
    `step 1 should be in 'failed' state, got '${step1Row.status}'`
  );
  assert(
    step1Row.error_message === ORIGINAL_STEP1_ERROR,
    `step 1's error_message must be preserved verbatim, got "${step1Row.error_message}"`
  );
  console.log('✓ step 1 error_message preserved — not overwritten by cascade marker');

  const step2Row = stepRows.get('set_ptr')!;
  assert(
    step2Row.status === 'pending',
    `step 2 should remain 'pending' (cascade stopped it), got '${step2Row.status}'`
  );
  assert(
    !step2Row.error_message,
    `step 2 should have no error_message set, got "${step2Row.error_message}"`
  );
  console.log('✓ step 2 row untouched — no spurious writes');

  assert(
    jobErrorMessage !== null,
    'job-level error_message should be populated'
  );
  assert(
    jobErrorMessage!.includes('Step "Create VPS pair" failed:') ||
      jobErrorMessage!.includes('Saga aborted at step "create_vps"'),
    `job error should reference step 1 failure; got "${jobErrorMessage}"`
  );
  console.log('✓ job-level error references step 1 (cascade or direct failure)');
}

// ============================================================================
// Runner
// ============================================================================

export async function testSagaCascadeGuard(): Promise<void> {
  testPureCascadeGuard();
  testSagaAbortedClass();
  await testCascadeIntegration();
  console.log('\n=== Saga cascade guard: ALL PASSED ===\n');
}

if (require.main === module) {
  testSagaCascadeGuard()
    .then(() => {
      console.log('ALL TESTS PASSED ✓');
      process.exit(0);
    })
    .catch((err) => {
      console.error('TESTS FAILED ✗');
      console.error(err);
      process.exit(1);
    });
}
