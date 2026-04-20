/**
 * Saga NS-apex mail-domain invariant — HL #111 (2026-04-20).
 *
 * Pins the Option-B fix for the drift that caused P11 to ship without DKIM on
 * the NS apex:
 *
 *   1. `computeZonePartition` puts the NS apex first in `s1Primary`.
 *   2. Saga `setup_mail_domains` uses `partition.s1Primary` verbatim — the
 *      pre-HL-#111 `.filter((d) => d !== context.nsDomain)` has been deleted.
 *      Combined with (1), this means the S1 loop iterates
 *      `[ns_domain, ...s1 sending domains]` in order, and S2 iterates the
 *      remainder. The total set of `createMailDomain` invocations across both
 *      servers is therefore `[ns_domain, ...sending_domains]` in alphabetical
 *      order — NS apex first on S1, sending domains following their partition
 *      assignment.
 *   3. The S1 loop special-cases the NS apex with an empty accounts list (the
 *      `dmarc@<ns>` mailbox is created separately downstream).
 *   4. The post-HL-#111 saga comments cite HL #111 so the invariant is
 *      discoverable at reading time.
 *
 * Run: tsx src/lib/provisioning/__tests__/setup-mail-domains-ns-apex.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { computeZonePartition } from '../hestia-scripts';

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

const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);

console.log('--- Saga NS-apex mail-domain uniformity (HL #111) ---');

// 1. computeZonePartition: NS apex first in s1Primary, across a variety of
//    pair shapes.
const pEven = computeZonePartition('ns.info', ['d.info', 'b.info', 'a.info', 'c.info']);
assertEq(pEven.s1Primary[0], 'ns.info', 'even pair: s1Primary[0] === ns_domain');
assertEq(
  pEven.s1Primary,
  ['ns.info', 'a.info', 'b.info'],
  'even pair: s1Primary = [ns, ...first half alphabetically]'
);
assertEq(pEven.s2Primary, ['c.info', 'd.info'], 'even pair: s2Primary = second half');

const pOdd = computeZonePartition('ns.info', ['b.info', 'a.info', 'c.info']);
assertEq(pOdd.s1Primary[0], 'ns.info', 'odd pair: s1Primary[0] === ns_domain');
assertEq(pOdd.s1Primary, ['ns.info', 'a.info', 'b.info'], 'odd pair: s1Primary = [ns, a, b]');
assertEq(pOdd.s2Primary, ['c.info'], 'odd pair: s2Primary = [c]');

const pOne = computeZonePartition('ns.info', ['only.info']);
assertEq(pOne.s1Primary, ['ns.info', 'only.info'], 'single-sending: NS apex + only domain on S1');
assertEq(pOne.s2Primary, [], 'single-sending: S2 empty');

// 2. Synthesize the exact invocation ordering produced by the saga loops.
//    Combined across both servers, the call sequence must be
//    [ns_domain, ...sending_domains] in alphabetical order — NS first.
function simulateSagaInvocationOrder(
  nsDomain: string,
  sendingDomains: string[]
): Array<{ ssh: 'ssh1' | 'ssh2'; domain: string }> {
  const partition = computeZonePartition(nsDomain, sendingDomains);
  const server1Domains = partition.s1Primary;
  const server2Domains = partition.s2Primary;
  const calls: Array<{ ssh: 'ssh1' | 'ssh2'; domain: string }> = [];
  for (const domain of server1Domains) {
    calls.push({ ssh: 'ssh1', domain });
  }
  for (const domain of server2Domains) {
    calls.push({ ssh: 'ssh2', domain });
  }
  return calls;
}

const orderEven = simulateSagaInvocationOrder('ns.info', ['d.info', 'b.info', 'a.info', 'c.info']);
assertEq(
  orderEven.map((c) => c.domain),
  ['ns.info', 'a.info', 'b.info', 'c.info', 'd.info'],
  'even pair: total call order = [ns, ...sending (alphabetical)]'
);
assertEq(
  orderEven[0],
  { ssh: 'ssh1', domain: 'ns.info' },
  'NS apex is createMailDomain(ssh1, ns_domain) — first call, S1 side'
);
assertEq(
  orderEven.filter((c) => c.ssh === 'ssh1').length,
  3,
  'S1 gets NS apex + 2 sending = 3 createMailDomain calls (even pair of 4)'
);
assertEq(
  orderEven.filter((c) => c.ssh === 'ssh2').length,
  2,
  'S2 gets 2 sending createMailDomain calls (even pair of 4)'
);

// 3. Saga source: the NS-apex-filtering line is GONE.
assert(
  !/partition\.s1Primary\.filter\(\(d\) => d !== context\.nsDomain\)/.test(sagaSrc),
  'saga no longer filters NS apex out of s1Primary (pre-HL-#111 anti-pattern removed)'
);
assert(
  /const server1Domains = partition\.s1Primary;/.test(sagaSrc),
  'saga sets server1Domains = partition.s1Primary (includes NS apex)'
);
assert(
  /const server2Domains = partition\.s2Primary;/.test(sagaSrc),
  'saga sets server2Domains = partition.s2Primary'
);

// 4. Saga source: NS apex is handled explicitly with an empty accounts list.
assert(
  /const isNsApex = domain === context\.nsDomain;/.test(sagaSrc),
  'saga S1 loop flags NS apex explicitly (isNsApex)'
);
assert(
  /const accounts = isNsApex \? \[\] : \(namesByDomain\[sendingIdx\] \|\| \[\]\);/.test(sagaSrc),
  'saga S1 loop gives NS apex an empty accounts list'
);

// 5. Saga source: HL #111 cited so future readers understand why the filter
//    was deleted.
assert(
  /HL #111/.test(sagaSrc),
  'saga cites HL #111 (keeps the invariant discoverable)'
);

// 6. Saga still uses computeZonePartition (preserves zone-sync-axfr test's
//    partition invariant from HL #101).
assert(
  /const partition = computeZonePartition\(context\.nsDomain, context\.sendingDomains\);/.test(sagaSrc),
  'saga setup_mail_domains still anchors on computeZonePartition'
);

// 7. Integration with PATCH 10c per-server split: server1Domains flows into
//    step-6 metadata (`server1Domains, server2Domains`) that downstream
//    verifyDKIMCrossServerMatch reads, so the NS apex's DKIM check routes to S1.
assert(
  /metadata:\s*\{[\s\S]*?server1Domains,[\s\S]*?server2Domains,/.test(sagaSrc),
  'saga still emits {server1Domains, server2Domains} in step-6 metadata for downstream split-aware checks'
);

console.log('--- all tests passed ---');
