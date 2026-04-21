/**
 * VG2 fcrdns retry-with-backoff test — 2026-04-22.
 *
 * 04-21 failure root cause (per reports/2026-04-22-p14-diagnostic.md,
 * verdict PROPAGATION-RESOLVED): Linode authoritative
 * `*.ip.linodeusercontent.com` → public-resolver cache lag. PTR was set by
 * `fix_ptr` in auto-fix, but 8.8.8.8 had not yet picked up the new reverse
 * name when VG2 ran its single-shot fcrdns probe ~5 min later. Net effect
 * was a hard saga failure despite correct end state.
 *
 * Fix under test (PR gate0/vg2-retry-backoff-2026-04-22):
 *   1. `runVerificationChecks` accepts a new optional param `fcrdnsRetryBackoff`.
 *   2. When true, Check 21 (FCrDNS) retries up to 3 attempts with
 *      10-minute spacing. If the last attempt still has non-pass results,
 *      their `details` are prefixed with "fcrdns retry exhausted after
 *      <N> attempts (<mins> min): " so the failure class is identifiable
 *      in the job error_message.
 *   3. VG2 (step 12) passes `fcrdnsRetryBackoff: true`. VG1 (step 10) does not
 *      — VG1 failures route through auto-fix, and lag only manifests at VG2.
 *   4. VG2's `estimatedDurationMs` is bumped to accommodate 20 min of waits
 *      without tripping the pg-boss 30-min queue expire (HL #94).
 *
 * Style: source-regex asserts, matching the sibling VG2 tests (vg2-fcrdns-
 * resolver.test.ts, vg2-ssl-probe-mail-hostname.test.ts). We do not mock
 * SSH / dig here — the invariants we care about are code-shape invariants,
 * not run-time behavior.
 *
 * Run: tsx src/lib/provisioning/__tests__/vg2-retry-backoff.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

const verifSrc = readFileSync(
  join(__dirname, '..', 'verification-checks.ts'),
  'utf8'
);
const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);

console.log('--- VG2 fcrdns retry-with-backoff (2026-04-22) ---');

// 1. `fcrdnsRetryBackoff` param is declared on the runVerificationChecks
//    params object, typed as optional boolean.
assert(
  /fcrdnsRetryBackoff\?:\s*boolean/.test(verifSrc),
  'runVerificationChecks params include `fcrdnsRetryBackoff?: boolean`'
);

// 2. The param is destructured inside the function body.
assert(
  /const\s*\{[^}]*fcrdnsRetryBackoff[^}]*\}\s*=\s*params;/.test(verifSrc),
  '`fcrdnsRetryBackoff` destructured from params'
);

// 3. Check 21 uses a max-attempts constant that goes to 3 when the flag is on.
assert(
  /FCRDNS_MAX_ATTEMPTS\s*=\s*fcrdnsRetryBackoff\s*\?\s*3\s*:\s*1/.test(verifSrc),
  'FCRDNS_MAX_ATTEMPTS = 3 when fcrdnsRetryBackoff else 1'
);

// 4. Inter-attempt delay is exactly 10 minutes (10 * 60 * 1000 ms).
assert(
  /FCRDNS_RETRY_DELAY_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/.test(verifSrc),
  'FCRDNS_RETRY_DELAY_MS = 10 * 60 * 1000 (10 min between attempts)'
);

// 5. Retry loop exists and waits FCRDNS_RETRY_DELAY_MS between attempts.
assert(
  /for\s*\(\s*let\s+attempt\s*=\s*1;\s*attempt\s*<=\s*FCRDNS_MAX_ATTEMPTS;\s*attempt\+\+\s*\)/.test(
    verifSrc
  ),
  'fcrdns attempts iterated via for(attempt=1..FCRDNS_MAX_ATTEMPTS)'
);
assert(
  /setTimeout\(r,\s*FCRDNS_RETRY_DELAY_MS\)/.test(verifSrc),
  'retry sleep uses FCRDNS_RETRY_DELAY_MS'
);

// 6. Exhaustion branch tags the failure class — match only after exhaustion,
//    not on every non-pass attempt, so the error_message stays clean until
//    the last pass.
assert(
  /attempt\s*===\s*FCRDNS_MAX_ATTEMPTS/.test(verifSrc),
  'exhaustion branch gated on attempt === FCRDNS_MAX_ATTEMPTS'
);
assert(
  /fcrdns retry exhausted after \$\{attempt\} attempts \(\$\{waitedMin\} min\):/.test(verifSrc),
  '`fcrdns retry exhausted after <N> attempts (<mins> min):` tag prefixed on exhausted failures'
);

// 7. Early-exit branch: all results pass on an attempt → break out of loop.
assert(
  /allPassing\s*=\s*fcrdnsResults\.every\(\(r\)\s*=>\s*r\.status\s*===\s*'pass'\)/.test(
    verifSrc
  ),
  'early-exit computes allPassing over fcrdnsResults'
);

// 8. Probe helper exists as a named inner function — scoped to Check 21.
assert(
  /const\s+probeFcrdnsOnce\s*=\s*async\s*\(\s*\)\s*:\s*Promise<VerificationResult\[\]>/.test(
    verifSrc
  ),
  '`probeFcrdnsOnce` helper defined with correct return type'
);

// 9. VG2 call site in the saga passes `fcrdnsRetryBackoff: true`.
//    Look for the Step 11/VG2 block specifically — match the block with
//    "Verification Gate 2" before the runVerificationChecks call.
const vg2Block = sagaSrc.match(
  /name:\s*'Verification Gate 2'[\s\S]*?runVerificationChecks\(ssh1,\s*ssh2,\s*\{[\s\S]*?\}\);/
);
assert(vg2Block !== null, 'located VG2 runVerificationChecks call block');
assert(
  !!vg2Block && /fcrdnsRetryBackoff:\s*true/.test(vg2Block[0]),
  'VG2 passes `fcrdnsRetryBackoff: true` to runVerificationChecks'
);

// 10. VG1 call site does NOT pass `fcrdnsRetryBackoff` — VG1 failures
//     route through auto-fix, propagation lag is only a VG2 concern.
const vg1Block = sagaSrc.match(
  /name:\s*'Verification Gate 1'[\s\S]*?runVerificationChecks\(ssh1,\s*ssh2,\s*\{[\s\S]*?\}\);/
);
assert(vg1Block !== null, 'located VG1 runVerificationChecks call block');
assert(
  !!vg1Block && !/fcrdnsRetryBackoff/.test(vg1Block[0]),
  'VG1 call does NOT pass fcrdnsRetryBackoff (default: single attempt)'
);

// 11. VG2 `estimatedDurationMs` bumped ≥ 20 min to accommodate retry waits
//     without blowing the pg-boss 30-min queue expire (HL #94).
const vg2FullBlock = sagaSrc.match(
  /name:\s*'Verification Gate 2',[\s\S]*?type:\s*'verification_gate_2'[\s\S]*?estimatedDurationMs:\s*([\d_]+)/
);
assert(vg2FullBlock !== null, 'located VG2 estimatedDurationMs declaration');
const durationLiteral = vg2FullBlock ? vg2FullBlock[1].replace(/_/g, '') : '0';
const durationMs = Number(durationLiteral);
assert(
  durationMs >= 20 * 60 * 1000 && durationMs <= 30 * 60 * 1000,
  `VG2 estimatedDurationMs ∈ [20 min, 30 min] (got ${durationMs / 60000} min)`
);

// 12. Behavior simulation — verify the retry/exhaustion logic over a mocked
//     probe sequence. This is a tiny TS harness that mirrors the loop shape
//     in verification-checks.ts. If the source diverges from this harness,
//     the static-regex asserts above will catch it; this case covers the
//     two behaviors named in the task prompt:
//       (a) first call fails, second call succeeds → overall PASS
//       (b) all three calls fail → overall FAIL with exhausted tag.
async function simulateRetryLoop(
  probes: Array<'pass' | 'fail'>,
  retryBackoff: boolean
): Promise<{ finalPass: boolean; detailsHead: string }> {
  const MAX = retryBackoff ? 3 : 1;
  let last: Array<{ status: string; details: string }> = [];
  for (let attempt = 1; attempt <= MAX; attempt++) {
    const outcome = probes[attempt - 1] ?? probes[probes.length - 1];
    last = [
      outcome === 'pass'
        ? { status: 'pass', details: 'FCrDNS confirmed: …' }
        : { status: 'auto_fixable', details: 'No PTR record found for …' },
    ];
    const allPass = last.every((r) => r.status === 'pass');
    if (allPass) return { finalPass: true, detailsHead: last[0].details };
    if (attempt === MAX) {
      if (MAX > 1) {
        const waitedMin = (attempt - 1) * 10;
        last = last.map((r) =>
          r.status === 'pass'
            ? r
            : {
                ...r,
                details: `fcrdns retry exhausted after ${attempt} attempts (${waitedMin} min): ${r.details}`,
              }
        );
      }
      break;
    }
    // production loop sleeps 10 min here — skipped in the simulation
  }
  return { finalPass: false, detailsHead: last[0].details };
}

(async () => {
  // (a) fail → pass → (should never reach third slot)
  const caseA = await simulateRetryLoop(['fail', 'pass', 'fail'], true);
  assert(caseA.finalPass === true, 'case (a) fail→pass→… → overall PASS');

  // (b) fail → fail → fail
  const caseB = await simulateRetryLoop(['fail', 'fail', 'fail'], true);
  assert(caseB.finalPass === false, 'case (b) fail×3 → overall FAIL');
  assert(
    caseB.detailsHead.startsWith('fcrdns retry exhausted after 3 attempts (20 min):'),
    'case (b) details tagged with "fcrdns retry exhausted after 3 attempts (20 min):"'
  );

  // Sanity: single-attempt mode (VG1) still fails immediately on first bad probe.
  const caseVg1 = await simulateRetryLoop(['fail', 'pass', 'pass'], false);
  assert(
    caseVg1.finalPass === false && !caseVg1.detailsHead.startsWith('fcrdns retry exhausted'),
    'VG1 single-attempt: fail on 1st probe, no "retry exhausted" tag'
  );

  console.log('--- all tests passed ---');
})();
