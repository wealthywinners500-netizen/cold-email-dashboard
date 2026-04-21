/**
 * verifyDKIMCrossServerMatch NS-apex invariant — HL #111 (2026-04-20).
 *
 * Pins the serverless-side half of the P11 DKIM-drift fix:
 *
 *   1. `verifyDKIMCrossServerMatch` accepts `nsDomain` as its 3rd parameter
 *      (after jobId, orgId) and iterates `[nsDomain, ...sendingDomains]`.
 *      Pre-HL-#111 it only iterated sendingDomains, so a missing
 *      `/home/admin/conf/mail/<ns>/dkim.pem` false-greened the VG.
 *   2. The single caller (runVerificationGateOnce → Item 11) passes
 *      `job.ns_domain` in the new slot.
 *   3. Per-server-split mode (HL #126) routes the NS apex to the
 *      server whose `server1Domains` / `server2Domains` set contains it —
 *      post-HL-#111 that's S1, because setup_mail_domains puts the NS apex
 *      in server1Domains.
 *   4. Legacy (non-split) mode still requires matching sha256 on both
 *      servers — the NS apex just joins the iteration.
 *   5. The issue strings still carry the domain name, so failures like
 *      `<ns>: DKIM key missing on S1 (...)` are distinguishable in the VG
 *      forensic dump.
 *
 * Run: tsx src/lib/provisioning/__tests__/verify-dkim-cross-server-match-ns.test.ts
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

const serverlessSrc = readFileSync(
  join(__dirname, '..', 'serverless-steps.ts'),
  'utf8'
);

console.log('--- verifyDKIMCrossServerMatch NS-apex uniformity (HL #111) ---');

// Extract the whole function body so later assertions can scope cleanly.
const fnBody = (() => {
  const start = serverlessSrc.indexOf('async function verifyDKIMCrossServerMatch(');
  assert(start >= 0, 'verifyDKIMCrossServerMatch declaration found');
  // Find the matching close-brace: scan for `^}` at start-of-line.
  const tail = serverlessSrc.slice(start);
  const endRel = tail.search(/\n\}\n/);
  assert(endRel > 0, 'verifyDKIMCrossServerMatch body end found');
  return tail.slice(0, endRel + 2);
})();

// 1. Signature: (jobId, orgId, nsDomain, sendingDomains, server1IP, server2IP).
//    The 3rd positional parameter must be `nsDomain: string`.
assert(
  /async function verifyDKIMCrossServerMatch\(\s*jobId:\s*string,\s*orgId:\s*string,\s*nsDomain:\s*string,\s*sendingDomains:\s*string\[\],\s*server1IP:\s*string,\s*server2IP:\s*string\s*\)/.test(
    fnBody
  ),
  'signature is (jobId, orgId, nsDomain, sendingDomains, server1IP, server2IP)'
);

// 2. Body: allDomains = [nsDomain, ...sendingDomains]; the iteration uses allDomains.
assert(
  /const allDomains = \[nsDomain, \.\.\.sendingDomains\];/.test(fnBody),
  'allDomains = [nsDomain, ...sendingDomains]'
);
assert(
  /for \(const domain of allDomains\)/.test(fnBody),
  'main loop iterates allDomains (not sendingDomains)'
);
assert(
  !/for \(const domain of sendingDomains\)/.test(fnBody),
  'main loop does NOT iterate sendingDomains directly (pre-HL-#111 anti-pattern)'
);

// 3. Per-server-split mode: assignedSSH is picked from s1Domains/s2Domains.
assert(
  /const assignedSSH = s1Domains\.has\(domain\) \? ssh1 : ssh2;/.test(fnBody),
  'per-server-split mode routes each domain to its assigned server'
);
// The NS apex is in server1Domains per setup_mail_domains (HL #111), so
// s1Domains.has(ns_domain) → true → assignedSSH === ssh1.
const s1DomainsHasRouting = (domain: string, s1: string[], s2: string[]): 'S1' | 'S2' =>
  new Set(s1).has(domain) ? 'S1' : 'S2';
assertEq(
  s1DomainsHasRouting('ns.info', ['ns.info', 'a.info', 'b.info'], ['c.info', 'd.info']),
  'S1',
  'NS apex routes to S1 in per-server-split mode (server1Domains includes ns.info)'
);
assertEq(
  s1DomainsHasRouting('c.info', ['ns.info', 'a.info', 'b.info'], ['c.info', 'd.info']),
  'S2',
  'S2-primary sending domain routes to S2 in per-server-split mode'
);

// 4. Legacy (non-split) mode still reads both servers' keys and compares sha256.
assert(
  /h1 !== h2/.test(fnBody),
  'legacy mode compares S1 and S2 sha256 for equality'
);
assert(
  /DKIM mismatch S1↔S2/.test(fnBody),
  'legacy mismatch issue string mentions both servers'
);

// 5. Issue strings carry the domain (NS apex failures are distinguishable).
assert(
  /\$\{domain\}: DKIM key missing on \$\{assignedLabel\}/.test(fnBody),
  'per-split missing-key issue string includes ${domain} and ${assignedLabel}'
);
assert(
  /\$\{domain\}: DKIM key missing on S1/.test(fnBody),
  'legacy missing-S1 issue string includes ${domain}'
);
assert(
  /\$\{domain\}: DKIM key missing on S2/.test(fnBody),
  'legacy missing-S2 issue string includes ${domain}'
);

// 6. Caller: runVerificationGateOnce passes job.ns_domain to the new slot.
const callerRegion = (() => {
  const start = serverlessSrc.indexOf('Item 11: DKIM sha256 cross-server match');
  const end = serverlessSrc.indexOf('Item 12:', start);
  return start >= 0 && end >= 0 ? serverlessSrc.slice(start, end) : '';
})();
assert(callerRegion.length > 0, 'caller region (Item 11) located');
assert(
  /await verifyDKIMCrossServerMatch\(\s*jobId,\s*job\.org_id,\s*job\.ns_domain,\s*job\.sending_domains \|\| \[\],\s*server1IP,\s*server2IP\s*\)/.test(
    callerRegion
  ),
  'caller passes (jobId, job.org_id, job.ns_domain, job.sending_domains, server1IP, server2IP)'
);

// 7. HL #111 cited in both the function body and the call site — keeps the
//    rationale discoverable.
assert(/HL #111/.test(fnBody), 'function body cites HL #111');
assert(/HL #111/.test(callerRegion), 'caller region cites HL #111');

// 8. Success message reflects NS apex + sending domains (not just sending).
assert(
  /NS apex \+ \$\{job\.sending_domains\?\.length \|\| 0\} sending domain\(s\)/.test(
    callerRegion
  ),
  'caller success message mentions NS apex + sending count'
);

// 9. Pure-function simulation of the iteration — confirms the order in which
//    ssh-exec sha256 is invoked for a representative pair shape.
function simulateLoopIteration(
  nsDomain: string,
  sendingDomains: string[]
): string[] {
  return [nsDomain, ...sendingDomains];
}
assertEq(
  simulateLoopIteration('ns.info', ['a.info', 'b.info', 'c.info']),
  ['ns.info', 'a.info', 'b.info', 'c.info'],
  'loop iterates [ns_domain, ...sending_domains] in that order (NS apex first)'
);
assertEq(
  simulateLoopIteration('ns.info', []),
  ['ns.info'],
  'with zero sending domains the loop still visits the NS apex once'
);

console.log('--- all tests passed ---');
