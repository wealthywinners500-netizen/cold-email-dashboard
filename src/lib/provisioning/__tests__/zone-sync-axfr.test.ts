/**
 * Zone-sync AXFR test — HL #101 (Session 04d).
 *
 * Pins Phase 2 invariants:
 *   1. computeZonePartition is deterministic, alphabetical, NS domain on S1.
 *   2. setup_dns_zones saga step calls configureZoneTransferPolicy
 *      (for master-side allow-transfer) and installSlaveZones (for peer-side
 *      cluster include) — NOT the old replicateZone (dual-primary).
 *   3. installSlaveZones writes stanzas with `type slave; masters { IP; };`
 *      and references `slaves/{zone}.db` (BIND default slave directory).
 *   4. setup_mail_domains uses the same partition (computeZonePartition)
 *      so mail domains land on the same server as the primary DNS zone —
 *      required for DKIM to be authored on the primary side, then propagated
 *      via AXFR.
 *
 * Run: tsx src/lib/provisioning/__tests__/zone-sync-axfr.test.ts
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

console.log('--- Zone-sync AXFR (HL #101, Option A) ---');

// 1. computeZonePartition determinism
const p1 = computeZonePartition('launta.info', [
  'voility.info',
  'caleap.info',
  'seamle.info',
  'corina.info',
  'larena.info',
  'cerone.info',
  'seapot.info',
  'cereno.info',
  'searely.info',
  'carena.info',
]);
assertEq(
  p1.s1Primary,
  ['launta.info', 'caleap.info', 'carena.info', 'cereno.info', 'cerone.info', 'corina.info'],
  'S1 primary = NS + first half alphabetically'
);
assertEq(
  p1.s2Primary,
  ['larena.info', 'seamle.info', 'seapot.info', 'searely.info', 'voility.info'],
  'S2 primary = second half alphabetically'
);

// 2. Re-run produces identical partition
const p2 = computeZonePartition('launta.info', [
  'voility.info', 'caleap.info', 'seamle.info', 'corina.info', 'larena.info',
  'cerone.info', 'seapot.info', 'cereno.info', 'searely.info', 'carena.info',
]);
assertEq(p1, p2, 'partition is idempotent across calls (same input)');

// 3. Odd-count partitions (rounded up to S1)
const p3 = computeZonePartition('x.info', ['c.info', 'a.info', 'b.info']);
assertEq(p3.s1Primary, ['x.info', 'a.info', 'b.info'], 'odd count — S1 gets ceil(3/2)=2 sending + NS');
assertEq(p3.s2Primary, ['c.info'], 'odd count — S2 gets floor(3/2)=1');

// 4. Single-sending-domain partition (NS + 1 on S1, empty S2)
const p4 = computeZonePartition('ns.com', ['only.com']);
assertEq(p4.s1Primary, ['ns.com', 'only.com'], 'single domain — S1 primary = NS + 1');
assertEq(p4.s2Primary, [], 'single domain — S2 primary empty');

// 5. Saga integration — setup_dns_zones uses the new helpers
const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);

assert(
  /computeZonePartition\(context\.nsDomain, context\.sendingDomains\)/.test(sagaSrc),
  'setup_dns_zones calls computeZonePartition'
);
assert(
  /configureZoneTransferPolicy\(ssh1, s1Primary, server2IP\)/.test(sagaSrc),
  'setup_dns_zones configures S1 allow-transfer to S2'
);
assert(
  /configureZoneTransferPolicy\(ssh2, s2Primary, server1IP\)/.test(sagaSrc),
  'setup_dns_zones configures S2 allow-transfer to S1'
);
assert(
  /installSlaveZones\(ssh2, s1Primary, server1IP\)/.test(sagaSrc),
  'setup_dns_zones installs S1-primary as slaves on S2'
);
assert(
  /installSlaveZones\(ssh1, s2Primary, server2IP\)/.test(sagaSrc),
  'setup_dns_zones installs S2-primary as slaves on S1'
);

// 6. setup_mail_domains uses the same partition (DKIM ↔ DNS primary parity)
assert(
  /const partition = computeZonePartition\(context\.nsDomain, context\.sendingDomains\);/.test(sagaSrc),
  'setup_mail_domains uses computeZonePartition for server1/server2Domains'
);

// 7. No residual replicateZone calls in the saga (old dual-primary flow eliminated).
// replicateZone is still exported by hestia-scripts.ts for backwards compatibility
// but must no longer appear in the saga execute path.
const sagaReplicateZoneCalls = (sagaSrc.match(/await replicateZone\(/g) ?? []).length;
assert(
  sagaReplicateZoneCalls === 0,
  `saga no longer calls replicateZone (found ${sagaReplicateZoneCalls})`
);

// 8. installSlaveZones output structure — read hestia-scripts.ts to verify stanza template
const hestiaSrc = readFileSync(
  join(__dirname, '..', 'hestia-scripts.ts'),
  'utf8'
);

assert(
  /type slave; masters \{ \$\{primaryIP\}; \}; file "slaves\/\$\{z\}\.db"; allow-transfer \{ none; \};/.test(hestiaSrc),
  'installSlaveZones writes slave stanza with masters/file/allow-transfer=none'
);
assert(
  /'mkdir -p \/var\/cache\/bind\/slaves && chown bind:bind \/var\/cache\/bind\/slaves'/.test(hestiaSrc),
  'installSlaveZones ensures /var/cache/bind/slaves exists and is owned by bind user'
);
assert(
  /grep -q 'named\.conf\.cluster' \/etc\/bind\/named\.conf \|\| echo 'include "\/etc\/bind\/named\.conf\.cluster";' >> \/etc\/bind\/named\.conf/.test(hestiaSrc),
  'installSlaveZones idempotently adds include directive to named.conf'
);
assert(
  /rndc retransfer \$\{zone\}/.test(hestiaSrc),
  'installSlaveZones triggers initial AXFR via rndc retransfer'
);

// 9. configureZoneTransferPolicy sed edit form
assert(
  /allow-transfer \{ \$\{peerIP\}; \}; also-notify \{ \$\{peerIP\}; \}/.test(hestiaSrc),
  'configureZoneTransferPolicy writes allow-transfer + also-notify scoped to peer IP'
);

// 10. openBindFirewall idempotency pattern
assert(
  /iptables -C INPUT -p tcp -s \$\{peerIP\} --dport 53 -j ACCEPT 2>\/dev\/null \|\| iptables -I INPUT -p tcp -s \$\{peerIP\} --dport 53 -j ACCEPT/.test(hestiaSrc),
  'openBindFirewall uses iptables -C to check before -I to insert (idempotent)'
);

console.log('--- all tests passed ---');
