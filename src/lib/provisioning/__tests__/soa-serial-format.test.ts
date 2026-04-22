/**
 * SOA Serial Format validation — format-only check.
 *
 * Validates the YYYYMMDDNN shape plus month/day range. Does NOT compare
 * the yyyymmdd portion against today_UTC — that previous rule (PR #18,
 * 2026-04-22) was refuted by P15-v2 Attempt 3 (2026-04-22), where 11 zones
 * with today-UTC serials (`2026042229+`) returned PERFECT on MXToolbox.
 * See `reports/2026-04-22-p15-v2-attempt-3-partial.md` for the empirical
 * basis. SOA correctness is enforced at creation time by Step 2's HL #107
 * `patchDomainSHSOATemplate` plus `setDomainSOA` in Steps 5/7.
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

console.log('--- SOA Serial Format (format-only) validation ---');

// 1. Valid 10-digit YYYYMMDDNN — passes regardless of date position.
{
  const r = validateSOASerialFormat('2026042201');
  assert(r.ok, 'valid YYYYMMDDNN serial passes');
  assert(r.issue === undefined, 'valid serial has no issue');
}

// 2. Today-UTC-dated serial — passes. MXToolbox accepts these (P15-v2 A3
//    empirical, 2026-04-22: 11 zones with today-UTC serials returned
//    PERFECT on Domain Health scans).
{
  const r = validateSOASerialFormat('2026042230');
  assert(r.ok, 'today-UTC-dated serial passes (format only)');
}

// 3. Future-dated serial — passes format-only check (no date comparison).
{
  const r = validateSOASerialFormat('2099123199');
  assert(r.ok, 'future-dated serial passes format-only check');
}

// 4. Yesterday-dated serial — passes.
{
  const r = validateSOASerialFormat('2026042130');
  assert(r.ok, 'yesterday-dated serial passes');
}

// 5. Two-days-past serial (launta.info-style reference) — passes.
{
  const r = validateSOASerialFormat('2026042021');
  assert(r.ok, 'launta.info-style 2-day-past serial (2026042021) passes');
}

// 6. 9-digit serial — rejected (format).
{
  const r = validateSOASerialFormat('202604210');
  assert(!r.ok, '9-digit serial is rejected');
  assert(
    r.issue !== undefined && r.issue.includes('YYYYMMDDNN format'),
    '9-digit serial issue mentions format'
  );
}

// 7. 11-digit serial — rejected.
{
  const r = validateSOASerialFormat('20260421300');
  assert(!r.ok, '11-digit serial is rejected');
}

// 8. Non-numeric serial — rejected.
{
  const r = validateSOASerialFormat('abcdefghij');
  assert(!r.ok, 'non-numeric serial is rejected');
}

// 9. Month 00 — rejected.
{
  const r = validateSOASerialFormat('2026002201');
  assert(!r.ok, 'month 00 is rejected');
  assert(
    r.issue !== undefined && r.issue.includes('invalid month'),
    'month 00 issue mentions invalid month'
  );
}

// 10. Month 13 — rejected.
{
  const r = validateSOASerialFormat('2026130101');
  assert(!r.ok, 'month 13 is rejected');
}

// 11. Day 00 — rejected.
{
  const r = validateSOASerialFormat('2026040001');
  assert(!r.ok, 'day 00 is rejected');
  assert(
    r.issue !== undefined && r.issue.includes('invalid day'),
    'day 00 issue mentions invalid day'
  );
}

// 12. Day 32 — rejected.
{
  const r = validateSOASerialFormat('2026013201');
  assert(!r.ok, 'day 32 is rejected');
}

// 13. NN=00 — passes (NN pool is 00-99, no restriction on counter).
{
  const r = validateSOASerialFormat('2026042100');
  assert(r.ok, 'NN=00 passes');
}

// 14. NN=99 — passes.
{
  const r = validateSOASerialFormat('2026042199');
  assert(r.ok, 'NN=99 passes');
}

// 15. Determinism — repeated calls with same input return same result.
{
  const r1 = validateSOASerialFormat('2026042201');
  const r2 = validateSOASerialFormat('2026042201');
  assertEq(r1, r2, 'repeated calls return identical results');
}

console.log('');
console.log('All SOA serial format tests passed.');
