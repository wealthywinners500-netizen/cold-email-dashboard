/**
 * IP blacklist classifier tests — Hard Lesson #R1 (2026-04-18, job 1e41871a).
 *
 * The `classifyDnsblReply` helper is the DNS-reply classifier used by
 * create_vps Step 1 to decide whether a fresh VPS IP is listed, clean, or
 * the resolver was blocked. Job 1e41871a (launta.info, 2026-04-17) failed
 * because the prior classifier treated ANY A-record as `listed` — including
 * `127.255.255.254`, the Spamhaus "anonymous public resolver denied"
 * sentinel. That false-positive rejected six clean Linode pairs in a row.
 *
 * These tests pin the new semantics in place so the bug can't come back.
 */

import { classifyDnsblReply, type ZoneQueryResult } from '../ip-blacklist-check';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function expect(actual: ZoneQueryResult, expected: ZoneQueryResult, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}\n  expected=${e}\n  actual  =${a}`);
}

function testListed_127_0_0_2(): void {
  // A well-behaved DNSBL reply for a real listing. Every zone returns
  // 127.0.0.2 for the 127.0.0.2 canary; per-list "reason" codes like
  // 127.0.0.10 (SORBS DUL) are also valid listings.
  const r = classifyDnsblReply(null, ['127.0.0.2']);
  expect(r, { kind: 'listed', response: '127.0.0.2' }, '127.0.0.2 → listed');

  const r10 = classifyDnsblReply(null, ['127.0.0.10']);
  expect(r10, { kind: 'listed', response: '127.0.0.10' }, '127.0.0.10 → listed');

  console.log('✓ 127.0.0.x A-record classified as listed');
}

function testDenied_127_255_255_254(): void {
  // Spamhaus DENIED sentinel. MUST NOT be treated as a listing — that was
  // the bug that killed job 1e41871a.
  const r = classifyDnsblReply(null, ['127.255.255.254']);
  expect(
    r,
    { kind: 'error', code: 'RESOLVER_DENIED' },
    '127.255.255.254 → error RESOLVER_DENIED (was incorrectly listed)'
  );

  // All three known Spamhaus sentinel codes must normalize to the same
  // RESOLVER_DENIED error kind.
  for (const sentinel of ['127.255.255.252', '127.255.255.254', '127.255.255.255']) {
    const s = classifyDnsblReply(null, [sentinel]);
    expect(s, { kind: 'error', code: 'RESOLVER_DENIED' }, `${sentinel} → RESOLVER_DENIED`);
  }
  console.log('✓ 127.255.255.x sentinels classified as RESOLVER_DENIED (not listed)');
}

function testUnexpectedAddress(): void {
  // Anything outside 127.0.0.0/24 or 127.255.255.0/24 is unknown territory.
  // Treat as error (not-listed) per HL #129 (fail-open on transient/
  // unknown states — downstream VG will catch anything real).
  const r = classifyDnsblReply(null, ['192.168.1.1']);
  expect(
    r,
    { kind: 'error', code: 'UNEXPECTED_192.168.1.1' },
    '192.168.1.1 → UNEXPECTED (not listed, per fail-open rule)'
  );
  console.log('✓ Off-spec A-record classified as UNEXPECTED error, not listed');
}

function testNxdomain(): void {
  // ENOTFOUND / ENODATA both map to a clean NXDOMAIN outcome.
  for (const code of ['ENOTFOUND', 'ENODATA'] as const) {
    const err = Object.assign(new Error(`mock ${code}`), { code });
    const r = classifyDnsblReply(err as NodeJS.ErrnoException, null);
    expect(r, { kind: 'nxdomain' }, `${code} → nxdomain`);
  }
  console.log('✓ ENOTFOUND / ENODATA classified as nxdomain');
}

function testOtherDnsError(): void {
  // Other DNS errors (SERVFAIL, REFUSED, ECONNREFUSED, etc.) propagate with
  // their original code so the caller can distinguish them in logs.
  const servfail = Object.assign(new Error('mock'), { code: 'SERVFAIL' });
  const r = classifyDnsblReply(servfail as NodeJS.ErrnoException, null);
  expect(r, { kind: 'error', code: 'SERVFAIL' }, 'SERVFAIL → error SERVFAIL');
  console.log('✓ Non-NXDOMAIN DNS errors propagate their code');
}

function testEmptyAnswer(): void {
  // No error, empty answer section — some mirrors do this under load. Mark
  // explicitly as empty so the caller can distinguish from clean NXDOMAIN.
  const r = classifyDnsblReply(null, []);
  expect(r, { kind: 'empty' }, 'empty answer section → empty');

  const rNull = classifyDnsblReply(null, null);
  expect(rNull, { kind: 'empty' }, 'null addresses → empty');
  console.log('✓ Empty / null answers classified as empty');
}

export async function testIpBlacklistClassifier(): Promise<void> {
  console.log('\n=== IP Blacklist Response Classifier Tests ===\n');
  testListed_127_0_0_2();
  testDenied_127_255_255_254();
  testUnexpectedAddress();
  testNxdomain();
  testOtherDnsError();
  testEmptyAnswer();
  console.log('\n=== IP Blacklist Classifier: ALL PASSED ===\n');
}

async function main(): Promise<void> {
  try {
    await testIpBlacklistClassifier();
    console.log('ALL TESTS PASSED ✓');
    process.exit(0);
  } catch (err) {
    console.error('\nTEST FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
