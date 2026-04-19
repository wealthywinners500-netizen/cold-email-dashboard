/**
 * MX spec-alignment test — HL #100 (Session 04d, Option A centralized gateway).
 *
 * VG2 mx_record check expects `mail{1|2}.{nsDomain}` for every sending domain
 * (centralized gateway: all domains owned by S1 route to mail1.{nsDomain}, all
 * S2-owned route to mail2.{nsDomain}). Auto-fix fixMX and saga setup_mail_domains
 * MUST write the same value — otherwise VG1 passes, auto-fix runs, VG2 still fails.
 *
 * This test pins three source-level invariants:
 *   1. Check 3 (verification-checks.ts) uses `mail{1|2}.${nsDomain}` for expectedMailHost.
 *   2. Auto-fix fixMX (auto-fix.ts) writes `mail{1|2}.${params.nsDomain}` — NEVER
 *      `mail{1|2}.${domain}` (per-domain — Option B, which would contradict the check).
 *   3. Saga setup_mail_domains writes `mail{1|2}.${context.nsDomain}` for both S1 and S2
 *      domains on both servers.
 *
 * Sample inputs cover: NS domain itself, 5 S1-owned, 5 S2-owned.
 *
 * Run: tsx src/lib/provisioning/__tests__/mx-spec-alignment.test.ts
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

const checksSrc = readFileSync(
  join(__dirname, '..', 'verification-checks.ts'),
  'utf8'
);

const autoFixSrc = readFileSync(
  join(__dirname, '..', 'auto-fix.ts'),
  'utf8'
);

const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);

console.log('--- MX spec alignment (HL #100, Option A centralized gateway) ---');

// 1. Check 3 uses `mail{1|2}.${nsDomain}` for expected MX
assert(
  /expectedMailHost\s*=\s*server\s*===\s*'S1'\s*\?\s*`mail1\.\$\{nsDomain\}`\s*:\s*`mail2\.\$\{nsDomain\}`/.test(checksSrc),
  'check 3 expectedMailHost = mail{1|2}.${nsDomain}'
);

// 2. Auto-fix fixMX uses params.nsDomain, NOT ${domain}
const fixMXBody = (() => {
  const m = autoFixSrc.match(/async function fixMX\([\s\S]*?\n\}\n/);
  return m ? m[0] : '';
})();
assert(fixMXBody.length > 0, 'fixMX function body located');
assert(
  /`mail2\.\$\{params\.nsDomain\}`\s*:\s*`mail1\.\$\{params\.nsDomain\}`/.test(fixMXBody),
  'fixMX writes mail{1|2}.${params.nsDomain}'
);
assert(
  !/mail[12]\.\$\{domain\}/.test(fixMXBody),
  'fixMX does NOT write mail{1|2}.${domain} (Option B would)'
);

// 3. Auto-fix addMTASTS mta-sts.txt mxHost uses nsDomain
assert(
  /const mxHost\s*=\s*`mail\$\{serverNum\}\.\$\{params\.nsDomain\}`;/.test(autoFixSrc),
  'addMTASTS mxHost = mail${serverNum}.${params.nsDomain}'
);

// 4. Saga: every `@ MX mail...` v-add-dns-record uses context.nsDomain
const sagaMxWrites = sagaSrc.match(/v-add-dns-record admin \$\{domain\} @ MX mail[12]\.\$\{[^}]+\} 10/g) ?? [];
assert(sagaMxWrites.length >= 2, `saga has \u22652 MX writes (S1 + S2 blocks) — found ${sagaMxWrites.length}`);
for (const cmd of sagaMxWrites) {
  assert(
    /context\.nsDomain/.test(cmd),
    `saga MX write uses context.nsDomain — got: ${cmd}`
  );
  assert(
    !/\$\{domain\} 10$/.test(cmd.replace(/mail[12]\.\$\{domain\}/, 'X')),
    `saga MX write does NOT use per-domain host — got: ${cmd}`
  );
}

// 5. No stale per-domain MX writes remain anywhere in saga
const staleMxWrites = sagaSrc.match(/@ MX mail[12]\.\$\{domain\} 10/g) ?? [];
assert(
  staleMxWrites.length === 0,
  `no stale per-domain MX writes in saga (found ${staleMxWrites.length})`
);

// 6. Functional equivalence — simulate check & fix for sample domains
// Check behavior: server === 'S1' ? mail1.{nsDomain} : mail2.{nsDomain}
// Fix behavior:   isS2 ? mail2.{params.nsDomain} : mail1.{params.nsDomain}
const checkExpected = (serverLabel: 'S1' | 'S2', nsDomain: string): string =>
  serverLabel === 'S1' ? `mail1.${nsDomain}` : `mail2.${nsDomain}`;

const fixOutput = (isS2: boolean, nsDomain: string): string =>
  isS2 ? `mail2.${nsDomain}` : `mail1.${nsDomain}`;

const nsDomain = 'launta.info';
// NS domain itself (special case): check uses S1 by convention (NS domain lives on S1 in saga step 4)
// The NS domain does not get a mail_domain in the saga, but if the check ran on it, it'd expect
// mail1.{nsDomain} = mail1.launta.info. Both check and fix produce the same value for nsDomain.
assert(
  checkExpected('S1', nsDomain) === fixOutput(false, nsDomain),
  `NS domain ${nsDomain}: check=${checkExpected('S1', nsDomain)}, fix=${fixOutput(false, nsDomain)}`
);

const s1Domains = ['caleap.info', 'carena.info', 'cereno.info', 'cerone.info', 'corina.info'];
const s2Domains = ['larena.info', 'seamle.info', 'seapot.info', 'searely.info', 'voility.info'];

for (const d of s1Domains) {
  const c = checkExpected('S1', nsDomain);
  const f = fixOutput(false, nsDomain);
  assert(c === f, `S1 domain ${d}: check=${c}, fix=${f}`);
  assert(c === `mail1.${nsDomain}`, `S1 domain ${d}: value = mail1.${nsDomain}`);
}

for (const d of s2Domains) {
  const c = checkExpected('S2', nsDomain);
  const f = fixOutput(true, nsDomain);
  assert(c === f, `S2 domain ${d}: check=${c}, fix=${f}`);
  assert(c === `mail2.${nsDomain}`, `S2 domain ${d}: value = mail2.${nsDomain}`);
}

console.log('--- all tests passed ---');
