/**
 * V1+a sync-inbox pacing + empty-text short-circuit tests.
 *
 * Pins the two handler-side primitives shipped on 2026-04-30:
 *   - isEmptyMessage: pure predicate; (replyOnlyText AND bodyText are both
 *     empty/whitespace) ⇒ true. Drives the LLM-skip short-circuit for the
 *     ~36% of inbox_messages that are empty Snov warm-up pings.
 *   - _waitForClassifierSlot: module-scope timestamp throttle; ensures
 *     ≥ CLASSIFIER_PACING_MS (2000ms) between consecutive LLM calls so the
 *     worker stays under Anthropic's 50 req/min cap on Haiku 4.5.
 *
 * No Supabase, no network, no Anthropic. The throttle test takes ~8s wall
 * clock by design (5 calls × 2000ms pacing).
 */

import { isEmptyMessage, _waitForClassifierSlot } from '../sync-inbox';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

async function run() {
  console.log('\nsync-inbox pacing + empty-text short-circuit\n');

  // ───── isEmptyMessage ─────
  console.log('isEmptyMessage:');

  await test('null + null is empty', () => {
    assert(isEmptyMessage(null, null), 'null/null should be empty');
  });

  await test('undefined + undefined is empty', () => {
    assert(isEmptyMessage(undefined, undefined), 'undefined/undefined should be empty');
  });

  await test('"" + "" is empty', () => {
    assert(isEmptyMessage('', ''), 'empty strings should be empty');
  });

  await test('whitespace-only is empty', () => {
    assert(isEmptyMessage('   \n\t  ', '\n\n   '), 'pure whitespace should be empty');
  });

  await test('replyOnlyText set, bodyText null → NOT empty', () => {
    assert(
      !isEmptyMessage('Out of office until next week.', null),
      'real reply text leaked through short-circuit'
    );
  });

  await test('replyOnlyText null, bodyText set → NOT empty', () => {
    assert(
      !isEmptyMessage(null, 'Some body text'),
      'body text only leaked through short-circuit'
    );
  });

  await test('both set → NOT empty', () => {
    assert(
      !isEmptyMessage('reply', 'body'),
      'both texts present should NOT be empty'
    );
  });

  await test('whitespace + real text → NOT empty', () => {
    assert(
      !isEmptyMessage('   ', 'This is a real bounce notification'),
      'whitespace-then-content should NOT be empty'
    );
  });

  // ───── _waitForClassifierSlot pacing ─────
  console.log('\n_waitForClassifierSlot pacing:');

  await test('first call (cold start) returns immediately (no prior timestamp)', async () => {
    // Module-scope lastClassifierCallAt starts at 0; first call shouldn't
    // sleep 2 seconds against epoch 0. (The throttle still updates the
    // timestamp for subsequent calls.)
    const t0 = Date.now();
    await _waitForClassifierSlot();
    const elapsed = Date.now() - t0;
    assert(
      elapsed < 500,
      `first call slept ${elapsed}ms — expected near-zero (throttle vs epoch 0)`
    );
  });

  await test('5 consecutive paced calls take ≥ 4 × 2000ms ≈ 8000ms', async () => {
    // After the first call (above), lastClassifierCallAt is fresh. 5 more
    // back-to-back calls should be paced at ≥2000ms each — total ≥ ~8000ms
    // (the FIRST of these 5 follows immediately after the cold start, so it
    // pays one 2000ms gap; the next 4 each pay another 2000ms, for 5 gaps).
    // We assert ≥ 4 gaps to give a margin for clock jitter.
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      await _waitForClassifierSlot();
    }
    const elapsed = Date.now() - t0;
    assert(
      elapsed >= 8000,
      `5 paced calls took ${elapsed}ms — expected ≥ 8000ms (≥ 4 × 2000ms gaps)`
    );
    // Also assert we didn't run wildly over: 5 × 2200ms (full jitter) = 11000ms
    // ceiling. If we see 15s the throttle is broken (sleeping per-call instead
    // of since-last-call).
    assert(
      elapsed < 15000,
      `5 paced calls took ${elapsed}ms — expected < 15000ms (sanity ceiling)`
    );
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('All pacing + short-circuit tests passed.\n');
}

run();
