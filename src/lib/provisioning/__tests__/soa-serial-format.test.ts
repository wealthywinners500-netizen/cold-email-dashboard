/**
 * SOA Serial Format validation — HL-new 2026-04-22 (P14 parity pass).
 *
 * Pins the rule discovered during the P14 → P13 parity investigation:
 * MXToolbox's Domain Health UI flags "SOA Serial Number Format is Invalid"
 * when the serial's yyyymmdd portion is today_UTC or future. Regardless of
 * the NN counter portion (00-99).
 *
 * Evidence: lauseart.info with serial 2026042203 (counter 03, yyyymmdd =
 * today UTC) was flagged at wall clock 03:05 UTC; rewriting virina.info to
 * 2026042130 (counter 30, yyyymmdd = yesterday) cleared the warning on the
 * next MXToolbox scan. See `reports/2026-04-22-p13-vs-p14-investigation.md`
 * §5 and the live verification log in `reports/2026-04-22-p14-parity-complete.md`.
 *
 * The check is embedded in runVerificationChecks Check 5; this test
 * targets the pure helper `validateSOASerialFormat` for fast, deterministic
 * coverage without SSH mocks.
 *
 * Run: tsx src/lib/provisioning/__tests__/soa-serial-format.test.ts
 */

import { validateSOASerialFormat } from '../verification-checks';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

console.log('--- SOA Serial Format validation (HL-new 2026-04-22) ---');

// Anchor date: 2026-04-22 03:05 UTC (wall clock during P14 parity pass).
const now = new Date(Date.UTC(2026, 3, 22, 3, 5, 0));

// 1. Today-dated serial — should fail (the P14 pre-fix state).
{
  const r = validateSOASerialFormat('2026042203', now);
  assert(!r.ok, 'today-dated serial is flagged');
  assert(
    r.issue !== undefined && r.issue.includes('today-UTC or future'),
    'today-dated serial issue mentions today-UTC'
  );
  assert(
    r.issue !== undefined && r.issue.includes('2026-04-22'),
    'today-dated serial issue mentions today_UTC=2026-04-22'
  );
}

// 2. Today-dated high counter — still flagged (counter irrelevant).
{
  const r = validateSOASerialFormat('2026042299', now);
  assert(!r.ok, 'today-dated serial with counter 99 is flagged');
}

// 3. Future-dated serial — flagged.
{
  const r = validateSOASerialFormat('2026042301', now);
  assert(!r.ok, 'future-dated serial is flagged');
  assert(
    r.issue !== undefined && r.issue.includes('today-UTC or future'),
    'future-dated serial issue mentions today-UTC or future'
  );
}

// 4. Yesterday-dated serial — passes (the P14 post-fix state).
{
  const r = validateSOASerialFormat('2026042130', now);
  assert(r.ok, 'yesterday-dated serial (counter 30) passes');
  assert(r.issue === undefined, 'yesterday-dated serial has no issue');
}

// 5. Two-days-past serial — passes (the P13 reference state).
{
  const r = validateSOASerialFormat('2026042021', now);
  assert(r.ok, 'launta.info-style 2-day-past serial (2026042021) passes');
}

// 6. Malformed — non-10-digit — flagged with format issue.
{
  const r = validateSOASerialFormat('202604210', now);
  assert(!r.ok, '9-digit serial is flagged');
  assert(
    r.issue !== undefined && r.issue.includes('YYYYMMDDNN format'),
    '9-digit serial issue mentions format'
  );
}
{
  const r = validateSOASerialFormat('20260421300', now);
  assert(!r.ok, '11-digit serial is flagged');
}
{
  const r = validateSOASerialFormat('abcdefghij', now);
  assert(!r.ok, 'non-numeric serial is flagged');
}

// 7. Edge — midnight boundary. At wall clock 2026-04-23 00:00:00 UTC, the
//    P14 "2026042130" serial is now 2 days past → passes. A fresh saga
//    run emitting 2026042301 (today_UTC = 2026-04-23) would be flagged.
{
  const midnight = new Date(Date.UTC(2026, 3, 23, 0, 0, 0));
  const r1 = validateSOASerialFormat('2026042130', midnight);
  assert(r1.ok, 'yesterday-dated P14 serial still passes at UTC day rollover');
  const r2 = validateSOASerialFormat('2026042301', midnight);
  assert(!r2.ok, 'same-day serial at rollover is flagged');
}

// 8. Edge — exactly yesterday 23:59. Wall clock 2026-04-22 00:01 UTC:
//    a "2026042199" serial (NN=99, yyyymmdd=yesterday) passes.
{
  const justAfterMidnight = new Date(Date.UTC(2026, 3, 22, 0, 1, 0));
  const r = validateSOASerialFormat('2026042199', justAfterMidnight);
  assert(
    r.ok,
    'yesterday-counter-99 serial passes immediately after UTC midnight'
  );
}

// 9. Year/month boundary — 2026-03-01 00:00 UTC evaluates 2026022899 as past.
{
  const marchFirst = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
  const r = validateSOASerialFormat('2026022899', marchFirst);
  assert(r.ok, 'serial dated the last day of the previous month passes');
}

// 10. Determinism sanity — repeated calls with the same inputs return the
//     same verdict (no implicit Date.now() leak).
{
  const r1 = validateSOASerialFormat('2026042203', now);
  const r2 = validateSOASerialFormat('2026042203', now);
  assertEq(r1, r2, 'repeated calls return identical results');
}

console.log('');
console.log('All SOA serial format tests passed.');
