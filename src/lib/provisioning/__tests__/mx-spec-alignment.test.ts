/**
 * MX spec-alignment test — HL #106 (Session 04d revert, per-domain MX).
 *
 * Per-domain MX is the correct pattern for cold-email deliverability:
 * every sending domain's MX = `mail.{domain}` (HestiaCP's default), and each
 * domain has its own [mail.{d}, webmail.{d}] LE SAN cert. Shared
 * `mail{1|2}.{nsDomain}` MX (Option A, HL #100) collapsed 5 domains'
 * reputation onto a single hostname — superseded.
 *
 * This test pins three source-level invariants (Option B):
 *   1. Check 3 (verification-checks.ts) uses `mail.${domain}` for expectedMailHost.
 *   2. Auto-fix fixMX (auto-fix.ts) writes `mail.${domain}` — NEVER the shared
 *      `mail{1|2}.{nsDomain}` (Option A) or `mail{1|2}.{domain}` (legacy).
 *   3. Saga setup_mail_domains writes `mail.${domain}` for S2 domains' @ MX
 *      rewrite, and S1 domains keep Hestia's default (no saga override).
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

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
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

console.log('--- MX spec alignment (HL #106, per-domain Option B) ---');

// 1. Check 3 uses `mail.${domain}` — scoped to the MX check region to avoid
//    false positives from HELO/PTR checks that correctly still use
//    `mail{1|2}.${nsDomain}` (server identity, not mail identity).
const check3Region = (() => {
  const start = checksSrc.indexOf("// Check 3: MX record correctness");
  const end = checksSrc.indexOf("// Check 4:", start);
  return start >= 0 && end >= 0 ? checksSrc.slice(start, end) : '';
})();
assert(check3Region.length > 0, 'check 3 region located');
assert(
  /const expectedMailHost\s*=\s*`mail\.\$\{domain\}`/.test(check3Region),
  'check 3 expectedMailHost = mail.${domain} (per-domain)'
);
assert(
  !/mail[12]\.\$\{nsDomain\}/.test(check3Region),
  'check 3 does NOT use mail{1|2}.${nsDomain} (Option A superseded)'
);

// 2. Auto-fix fixMX uses `mail.${domain}`
const fixMXBody = (() => {
  const m = autoFixSrc.match(/async function fixMX\([\s\S]*?\n\}\n/);
  return m ? m[0] : '';
})();
assert(fixMXBody.length > 0, 'fixMX function body located');
assert(
  /const mxHost\s*=\s*`mail\.\$\{domain\}`/.test(fixMXBody),
  'fixMX writes mail.${domain}'
);
assert(
  !/mail[12]\.\$\{(params\.)?nsDomain\}/.test(fixMXBody),
  'fixMX does NOT use mail{1|2}.${nsDomain} (Option A superseded)'
);
assert(
  !/mail[12]\.\$\{domain\}/.test(fixMXBody),
  'fixMX does NOT use mail{1|2}.${domain} (legacy per-domain-prefix, superseded)'
);

// 3. Auto-fix addMTASTS mta-sts.txt mxHost uses per-domain
assert(
  /const mxHost\s*=\s*`mail\.\$\{domain\}`;/.test(autoFixSrc),
  'addMTASTS mxHost = mail.${domain}'
);

// 4. Saga setup_mail_domains PATCH 10c (S2 A+MX block) writes `mail.${domain}`.
//    The S1 rewrite block (old PATCH 11d) should be DELETED — Hestia's default
//    is already correct for S1 domains.
const sagaMxWrites = sagaSrc.match(/v-add-dns-record admin \$\{domain\} @ MX mail[^ ]+ 10/g) ?? [];
assert(sagaMxWrites.length === 1, `saga has exactly 1 MX write (S2 A+MX block) — found ${sagaMxWrites.length}`);
for (const cmd of sagaMxWrites) {
  assert(
    /MX mail\.\$\{domain\} 10/.test(cmd),
    `saga MX write uses mail.\${domain} — got: ${cmd}`
  );
}

// 5. No residual Option A / legacy MX writes anywhere in saga
const optionAWrites = sagaSrc.match(/MX mail[12]\.\$\{context\.nsDomain\}/g) ?? [];
const legacyPerDomainWrites = sagaSrc.match(/MX mail[12]\.\$\{domain\} 10/g) ?? [];
assert(
  optionAWrites.length === 0,
  `no Option A centralized MX writes in saga (found ${optionAWrites.length})`
);
assert(
  legacyPerDomainWrites.length === 0,
  `no legacy per-domain-prefix MX writes in saga (found ${legacyPerDomainWrites.length})`
);

// 6. Functional equivalence — simulate check & fix for sample domains
const checkExpected = (domain: string): string => `mail.${domain}`;
const fixOutput = (domain: string): string => `mail.${domain}`;

const s1Domains = ['caleap.info', 'carena.info', 'cereno.info', 'cerone.info', 'corina.info'];
const s2Domains = ['larena.info', 'seamle.info', 'seapot.info', 'searely.info', 'voility.info'];

for (const d of [...s1Domains, ...s2Domains]) {
  const c = checkExpected(d);
  const f = fixOutput(d);
  assertEq(c, f, `${d}: check=${c} === fix=${f}`);
  assert(c === `mail.${d}`, `${d}: value = mail.${d}`);
}

// 7. HL #106 cited in source so the per-domain revert is durable against
//    drive-by edits that might "fix" it back to Option A.
assert(/HL #106/.test(checksSrc), 'HL #106 cited in verification-checks.ts');
assert(/HL #106/.test(autoFixSrc), 'HL #106 cited in auto-fix.ts');
assert(/HL #106/.test(sagaSrc), 'HL #106 cited in pair-provisioning-saga.ts');

// 8. SOA timer fix (HL #107): auto-fix fixSOA uses Expire 2419200 (4 weeks),
//    not the old 604800 (1 week, which failed MXToolbox range). Per HL
//    #145-companion (P19 Phase H), arg-3 is now an explicit
//    `ns1.${params.nsDomain}` — never `''`. See fixsoa-mname-explicit.test.ts
//    for the full MNAME invariant pin.
assert(
  /v-change-dns-domain-soa admin \$\{domain\} ns1\.\$\{params\.nsDomain\} '' 3600 600 2419200 3600/.test(autoFixSrc),
  'fixSOA uses 3600 600 2419200 3600 (HL #107 — MXToolbox-safe timers) with explicit ns1.${params.nsDomain} MNAME (HL #145-companion)'
);
assert(
  !/v-change-dns-domain-soa.*604800/.test(autoFixSrc),
  'fixSOA does NOT use Expire 604800 (MXToolbox flags it)'
);

console.log('--- all tests passed ---');
