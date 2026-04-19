/**
 * Pair-verify dead-zone test — HL #103 (Session 04d).
 *
 * Invaluement retired their open DNSBL in 2018 and poisons every query
 * against `sip.invaluement.com` with `127.0.0.2` + a TXT record telling
 * callers to migrate to the paid v2 HTTPS API. Left in PAIR_VERIFY_ZONES
 * it produced universal false-positives — every pair came back `red` on
 * `operational_blacklist_sweep` regardless of actual reputation, matching
 * MXToolbox zero-red results for the same IPs.
 *
 * This test pins the removal and prevents accidental reintroduction as a
 * DNSBL zone. If Invaluement v2 API support lands, it should arrive as an
 * HTTPS client, not as another `DnsblZone` entry in this file.
 *
 * Run: tsx src/lib/provisioning/__tests__/pair-verify-invaluement-dead-zone.test.ts
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

const src = readFileSync(
  join(__dirname, '..', 'pair-verify.ts'),
  'utf8'
);

console.log('--- Pair-verify Invaluement dead-zone (HL #103) ---');

// Extract the PAIR_VERIFY_ZONES block so the assertions are scoped to the
// active zone list, not to the unrelated OPERATIONAL_BLACKLISTS classifier
// Set (which legitimately keeps Invaluement SIP for MXToolbox-response
// classification if it ever shows up via their v2 API).
const zonesBlockMatch = src.match(/const PAIR_VERIFY_ZONES:[\s\S]*?\];/);
assert(zonesBlockMatch !== null, 'PAIR_VERIFY_ZONES block located');
const zonesBlock = zonesBlockMatch![0];

// 1. sip.invaluement.com is not a queried zone
assert(
  !/zone:\s*'sip\.invaluement\.com'/.test(zonesBlock),
  'sip.invaluement.com is NOT in PAIR_VERIFY_ZONES (dead zone, HL #103)'
);

// 2. The three live zones are present
assert(
  /zone:\s*'sbl\.spamhaus\.org'/.test(zonesBlock),
  'sbl.spamhaus.org IS in PAIR_VERIFY_ZONES'
);
assert(
  /zone:\s*'dbl\.spamhaus\.org'/.test(zonesBlock),
  'dbl.spamhaus.org IS in PAIR_VERIFY_ZONES'
);
assert(
  /zone:\s*'b\.barracudacentral\.org'/.test(zonesBlock),
  'b.barracudacentral.org IS in PAIR_VERIFY_ZONES'
);

// 3. Classifier Set keeps Invaluement SIP for classification (defensive:
//    if MXToolbox reports an Invaluement listing via their v2 path we want
//    to still class it as operational rather than unknown).
assert(
  /OPERATIONAL_BLACKLISTS\s*=\s*new Set<string>\(\[[\s\S]*?'Invaluement SIP'/.test(src),
  'Invaluement SIP kept in OPERATIONAL_BLACKLISTS for MXToolbox classification'
);

// 4. Narrative comment explains why (so a future reviewer doesn't re-add it)
assert(
  /HL #103/.test(src),
  'HL #103 cited in source so the removal survives drive-by edits'
);

console.log('--- all tests passed ---');
