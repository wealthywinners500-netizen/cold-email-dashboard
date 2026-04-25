/**
 * Saga LE-hostname-cert chmod 0640 belt-and-suspenders test — HL #145.
 *
 * Pins the invariant that the saga's hostname-cert flow (issueSSLCert with
 * isHostname: true, called once per ssh on both halves of the pair from the
 * saga's security_hardening / SSL step) ends with:
 *
 *   chmod 0640 /usr/local/hestia/ssl/certificate.key
 *   chown Debian-exim:mail /usr/local/hestia/ssl/certificate.key
 *   stat -c %a /usr/local/hestia/ssl/certificate.key   (defensive, non-failing)
 *
 * Background: P18 α (2026-04-25) suffered a 14h-46m TLS outage because
 * /usr/local/hestia/ssl/certificate.key was left mode 0600 root:root after
 * a renewal. Exim runs as Debian-exim:mail and could not read the key,
 * so STARTTLS failed on every inbound delivery until manually fixed. See
 * reports/2026-04-25-p18-tls-incident.md for the full forensic record;
 * §3 is the actual chmod 0640 + chown Debian-exim:mail fix that worked,
 * §7 covers the renewal-time risk analysis. HL #145 §3 made this rule
 * universal: "any code path that writes /usr/local/hestia/ssl/certificate.
 * {crt,key} MUST end with `chmod 0640 certificate.key && chown Debian-exim:
 * mail certificate.key`."
 *
 * The chmod itself is idempotent: a no-op when the install is already
 * correct, save when it isn't. The defensive stat assertion makes a
 * regression in the chmod path visible (warns, does NOT fail the saga).
 *
 * Run: tsx src/lib/provisioning/__tests__/saga-step9-chmod-cert-key.test.ts
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

console.log('--- saga LE-hostname-cert chmod 0640 (HL #145) ---');

const hestiaSrc = readFileSync(
  join(__dirname, '..', 'hestia-scripts.ts'),
  'utf8'
);

// ---------------------------------------------------------------
// Section 1 — issueSSLCert function body located + isHostname branch present
// ---------------------------------------------------------------
assert(
  /export async function issueSSLCert\(/.test(hestiaSrc),
  'issueSSLCert is exported from hestia-scripts.ts'
);

const fnMatch = hestiaSrc.match(/export async function issueSSLCert\([\s\S]*?\n\}\n/);
assert(fnMatch !== null, 'issueSSLCert function body located');
const fnBody = fnMatch![0];

assert(
  /if \(isHostname\) \{/.test(fnBody),
  'issueSSLCert: isHostname branch present'
);

// ---------------------------------------------------------------
// Section 2 — Scope all assertions to the isHostname branch
// ---------------------------------------------------------------
const isHostnameBranchMatch = fnBody.match(/if \(isHostname\) \{([\s\S]*?)\n\s{2}\} else \{/);
assert(isHostnameBranchMatch !== null, 'issueSSLCert: isHostname branch body extracted');
const isHostnameBranch = isHostnameBranchMatch![1];

// LE issuance comes first.
assert(
  /v-add-letsencrypt-host admin/.test(isHostnameBranch),
  'isHostname branch: v-add-letsencrypt-host admin call present (HL #117)'
);

// ---------------------------------------------------------------
// Section 3 — chmod 0640 belt-and-suspenders (HL #145)
// ---------------------------------------------------------------
assert(
  /chmod 0640 \/usr\/local\/hestia\/ssl\/certificate\.key/.test(isHostnameBranch),
  'isHostname branch: chmod 0640 /usr/local/hestia/ssl/certificate.key present (HL #145 belt-and-suspenders)'
);
assert(
  /chown Debian-exim:mail \/usr\/local\/hestia\/ssl\/certificate\.key/.test(isHostnameBranch),
  'isHostname branch: chown Debian-exim:mail /usr/local/hestia/ssl/certificate.key present (HL #145)'
);

// Order: LE issuance → chmod → chown. The chmod must come AFTER v-add-letsencrypt-host.
const leIdx = isHostnameBranch.indexOf('v-add-letsencrypt-host');
const chmodIdx = isHostnameBranch.indexOf('chmod 0640 /usr/local/hestia/ssl/certificate.key');
const chownIdx = isHostnameBranch.indexOf('chown Debian-exim:mail /usr/local/hestia/ssl/certificate.key');
assert(
  leIdx >= 0 && chmodIdx > leIdx,
  'isHostname branch: chmod 0640 follows v-add-letsencrypt-host (post-issuance fix-up)'
);
assert(
  chownIdx > leIdx,
  'isHostname branch: chown Debian-exim:mail follows v-add-letsencrypt-host'
);

// ---------------------------------------------------------------
// Section 4 — Defensive stat assertion (non-failing)
// ---------------------------------------------------------------
assert(
  /stat -c %a \/usr\/local\/hestia\/ssl\/certificate\.key/.test(isHostnameBranch),
  'isHostname branch: defensive `stat -c %a` check present after chmod'
);
assert(
  /console\.warn\(/.test(isHostnameBranch),
  'isHostname branch: stat-mismatch path uses console.warn (not throw — saga must NOT fail on the defensive check)'
);
assert(
  !/throw new Error\([^)]*certificate\.key/.test(isHostnameBranch),
  'isHostname branch: defensive stat check does NOT throw on mismatch (HL #145: warn, do not fail)'
);

// The stat check must be wrapped in try/catch so an unrelated SSH hiccup
// during the defensive read cannot wedge the saga.
assert(
  /try\s*\{[\s\S]*stat -c %a[\s\S]*\}\s*catch\s*\{/.test(isHostnameBranch),
  'isHostname branch: defensive stat check is wrapped in try/catch (cannot wedge saga on transient SSH error)'
);

// ---------------------------------------------------------------
// Section 5 — Both halves S1 + S2 receive the chmod
// ---------------------------------------------------------------
// The saga calls issueSSLCert(ssh1, { isHostname: true }) AND
// issueSSLCert(ssh2, { isHostname: true }) — pin both call sites still exist
// in the saga so the chmod (which lives inside the helper) reaches both halves.
const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);
// Use a bounded-window match: find each `issueSSLCert(sshN,` and look for
// `isHostname: true` within the next 200 chars. A naive `[^}]*` regex stops at
// the first `}` inside a template-literal interpolation like `mail1.${ctx...}`.
function callsiteHasHostnameTrue(src: string, sshLabel: 'ssh1' | 'ssh2'): boolean {
  const callRegex = new RegExp(`issueSSLCert\\(${sshLabel},`, 'g');
  let m: RegExpExecArray | null;
  while ((m = callRegex.exec(src)) !== null) {
    const window = src.slice(m.index, m.index + 200);
    if (/isHostname:\s*true/.test(window)) return true;
  }
  return false;
}
const ssh1HostnameCall = callsiteHasHostnameTrue(sagaSrc, 'ssh1');
const ssh2HostnameCall = callsiteHasHostnameTrue(sagaSrc, 'ssh2');
assert(
  ssh1HostnameCall,
  'saga: issueSSLCert(ssh1, { isHostname: true, ... }) callsite present (S1 half receives chmod via helper)'
);
assert(
  ssh2HostnameCall,
  'saga: issueSSLCert(ssh2, { isHostname: true, ... }) callsite present (S2 half receives chmod via helper)'
);

// ---------------------------------------------------------------
// Section 6 — HL traceability: HL #145 anchored in source
// ---------------------------------------------------------------
assert(
  /HL #145/.test(isHostnameBranch),
  'isHostname branch: HL #145 comment anchor present (P18 α 14h-46m TLS outage traceability)'
);

console.log('--- all tests passed ---');
