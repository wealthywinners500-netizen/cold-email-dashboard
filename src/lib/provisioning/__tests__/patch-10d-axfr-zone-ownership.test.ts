/**
 * PATCH 10d — AXFR zone-ownership regression test.
 *
 * Pins the invariant that every Hestia CLI (`v-*-dns-*`, `v-add-dns-domain`,
 * etc.) in the saga's setup_mail_domains step + the auto-fix module runs
 * only on the Hestia-master half for each zone, per computeZonePartition.
 *
 * Post-PR #4 / HL #101 architecture: each zone has exactly one Hestia
 * master + BIND primary; the peer holds the zone as a BIND slave and
 * Hestia CLI on the peer returns exit 3 "dns domain doesn't exist."
 *
 * Background: P14 saga test (2026-04-21, job
 * 2f4815e0-948f-4936-8422-a87632e2b024) failed at step 7 (setup_mail_domains)
 * because PATCH 10c's inner `for (const [sshConn, label] of [[ssh1,'S1'],
 * [ssh2,'S2']])` loop iterated over server2Domains and ran `v-list-dns-records
 * admin <s2-primary-zone>` on ssh1 — which returned exit 3 because the zone
 * is a BIND slave on ssh1, not a Hestia-managed DNS domain. See
 * reports/2026-04-21-p14-e2e-saga-test.md.
 *
 * Run: tsx src/lib/provisioning/__tests__/patch-10d-axfr-zone-ownership.test.ts
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

function extractBlock(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = rest.indexOf(endMarker);
  if (end < 0) return rest;
  return rest.slice(0, end);
}

console.log('--- PATCH 10d — AXFR zone-ownership invariants ---');

const sagaSrc = readFileSync(
  join(__dirname, '..', 'pair-provisioning-saga.ts'),
  'utf8'
);
const autoFixSrc = readFileSync(join(__dirname, '..', 'auto-fix.ts'), 'utf8');

// ---------------------------------------------------------------
// Section 1 — saga setup_mail_domains (PATCH 10c + PATCH 15)
// ---------------------------------------------------------------

// PATCH 10c block (S2 @ A + @ MX)
const patch10cBlock = extractBlock(
  sagaSrc,
  '[Step 6] Fixing @ A and MX records for S2 domains',
  '[Step 6] Fixing mail/webmail A records for S2 domains'
);
assert(
  patch10cBlock.length > 0,
  'saga PATCH 10c block found (S2 @ A + @ MX)'
);
assert(
  !/\[\[ssh1,\s*'S1'\],\s*\[ssh2,\s*'S2'\]\]/.test(patch10cBlock),
  "saga PATCH 10c: no [[ssh1,'S1'],[ssh2,'S2']] dual-ssh loop (HL #101 / post-PR #4)"
);
assert(
  /for \(const domain of server2Domains\)/.test(patch10cBlock),
  'saga PATCH 10c: outer loop iterates server2Domains'
);
assert(
  /ssh2\.exec\(\s*`\$\{HESTIA_PATH_PREFIX\}v-list-dns-records admin \$\{domain\} plain`/.test(
    patch10cBlock
  ),
  'saga PATCH 10c: v-list-dns-records runs on ssh2 (owning S2 half)'
);
assert(
  /ssh2\.exec\([\s\S]*v-add-dns-record admin \$\{domain\} @ A \$\{server2IP\}/.test(
    patch10cBlock
  ),
  'saga PATCH 10c: @ A -> server2IP written on ssh2 (owning)'
);
assert(
  /ssh2\.exec\([\s\S]*v-add-dns-record admin \$\{domain\} @ MX mail\.\$\{domain\} 10/.test(
    patch10cBlock
  ),
  'saga PATCH 10c: @ MX mail.{domain} 10 written on ssh2 (owning)'
);

// PATCH 15 block (S2 mail/webmail A)
const patch15Block = extractBlock(
  sagaSrc,
  '[Step 6] Fixing mail/webmail A records for S2 domains',
  'PATCH 10d-2'
);
assert(
  patch15Block.length > 0,
  'saga PATCH 15 block found (S2 mail/webmail A)'
);
assert(
  !/\[\[ssh1,\s*'S1'\],\s*\[ssh2,\s*'S2'\]\]/.test(patch15Block),
  "saga PATCH 15: no [[ssh1,'S1'],[ssh2,'S2']] dual-ssh loop"
);
assert(
  /ssh2\.exec\([\s\S]*v-add-dns-record admin \$\{domain\} mail A \$\{server2IP\}/.test(
    patch15Block
  ),
  'saga PATCH 15: mail A written on ssh2 (owning)'
);

// ---------------------------------------------------------------
// Section 2 — saga obsolete cross-server TXT replication removed
// ---------------------------------------------------------------
assert(
  !/const replicationPairs:/.test(sagaSrc),
  'saga: obsolete `replicationPairs` variable removed (AXFR handles TXT propagation)'
);
assert(
  !/sourceSSH: ssh1, targetSSH: ssh2/.test(sagaSrc),
  'saga: no cross-server sourceSSH/targetSSH replication structure'
);
assert(
  !/sourceSSH: ssh2, targetSSH: ssh1/.test(sagaSrc),
  'saga: no reverse cross-server sourceSSH/targetSSH structure either'
);

// ---------------------------------------------------------------
// Section 3 — auto-fix robustDNSRecordReplace signature + routing
// ---------------------------------------------------------------
assert(
  /function pickOwningServer\(/.test(autoFixSrc),
  'auto-fix: pickOwningServer helper exists'
);
assert(
  /async function robustDNSRecordReplace\(\s*ssh: SSHManager,\s*serverName: string/.test(
    autoFixSrc
  ),
  'auto-fix: robustDNSRecordReplace takes single ssh: SSHManager (not SSHManager[])'
);
assert(
  !/robustDNSRecordReplace\(\s*\[ssh1,\s*ssh2\]/.test(autoFixSrc),
  'auto-fix: no caller passes [ssh1, ssh2] array to robustDNSRecordReplace'
);

// ---------------------------------------------------------------
// Section 4 — auto-fix dual-ssh loop pattern eliminated for Hestia CLI
// ---------------------------------------------------------------
// Any `for (const [ssh, ...] of [[ssh1,...], [ssh2,...]])` loop that
// contains a Hestia `v-*` CLI command inside its body is the broken
// post-PR #4 pattern. Dual-server loops with ONLY BIND-layer commands
// (rndc reload / retransfer / reconfig) are fine — BIND is up on both
// halves regardless of zone ownership.
const dualSshLoopRegex =
  /for\s*\(\s*const\s*\[[^\]]+\]\s*of\s*\[\[\s*ssh1\s*,[^\]]+\]\s*(?:as const)?\s*,\s*\[\s*ssh2\s*,[^\]]+\]\s*(?:as const)?\s*\]\s*\)\s*\{([\s\S]*?)\n\s{0,6}\}/g;

const hestiaViolations: string[] = [];
let loopMatch: RegExpExecArray | null;
while ((loopMatch = dualSshLoopRegex.exec(autoFixSrc)) !== null) {
  const body = loopMatch[1];
  if (/v-[a-z-]+/.test(body)) {
    // Grab a line-number proxy: count newlines before the match.
    const lineNum = autoFixSrc.slice(0, loopMatch.index).split('\n').length;
    hestiaViolations.push(`auto-fix.ts:${lineNum} (body contains v-* Hestia CLI)`);
  }
}
assertEq(
  hestiaViolations.length,
  0,
  `auto-fix: no dual-ssh for-loops contain v-* Hestia CLI (violations: ${hestiaViolations.join('; ')})`
);

// Also: no caller of robustDNSRecordReplace passes an ssh-array — the
// signature change in PATCH 10d-3 forces single-ssh routing.
const oldArrayCalls =
  (autoFixSrc.match(/robustDNSRecordReplace\s*\(\s*\[\s*ssh1\s*,\s*ssh2\s*\]/g) || [])
    .length;
assertEq(
  oldArrayCalls,
  0,
  'auto-fix: no robustDNSRecordReplace([ssh1, ssh2], …) legacy call sites'
);

// ---------------------------------------------------------------
// Section 5 — addDKIM: no peer write (AXFR propagates)
// ---------------------------------------------------------------
const addDKIMBlock = extractBlock(
  autoFixSrc,
  'async function addDKIM(',
  '\nasync function '
);
assert(addDKIMBlock.length > 0, 'auto-fix: addDKIM block located');
assert(
  !/otherSSH/.test(addDKIMBlock),
  'addDKIM: no otherSSH peer-write reference (AXFR handles propagation)'
);
assert(
  !/otherServer/.test(addDKIMBlock),
  'addDKIM: no otherServer peer-write reference'
);
assert(
  /pickOwningServer\(/.test(addDKIMBlock),
  'addDKIM: uses pickOwningServer for owning-half routing'
);

// ---------------------------------------------------------------
// Section 6 — fixSOASerialSync: AXFR-aware (no v-add-dns-domain fallback)
// ---------------------------------------------------------------
const fixSOASyncBlock = extractBlock(
  autoFixSrc,
  'async function fixSOASerialSync(',
  '\nasync function '
);
assert(fixSOASyncBlock.length > 0, 'auto-fix: fixSOASerialSync block located');
assert(
  !/v-add-dns-domain admin \$\{domain\}/.test(fixSOASyncBlock),
  'fixSOASerialSync: no catastrophic v-add-dns-domain fallback (would break AXFR)'
);
assert(
  /rndc retransfer \$\{domain\}/.test(fixSOASyncBlock),
  'fixSOASerialSync: uses rndc retransfer on peer to force AXFR'
);
assert(
  /pickOwningServer\(/.test(fixSOASyncBlock),
  'fixSOASerialSync: uses pickOwningServer for owning-half routing'
);

// ---------------------------------------------------------------
// Section 7 — computeZonePartition invariants (full/total + disjoint)
// ---------------------------------------------------------------
const p = computeZonePartition('ns.info', ['b.info', 'a.info', 'd.info', 'c.info']);
assertEq(p.s1Primary[0], 'ns.info', 'NS apex is first element of S1 primary');
assertEq(
  p.s1Primary.length + p.s2Primary.length,
  5,
  'partition total = NS + sending count'
);
assert(
  p.s1Primary.every((d) => !p.s2Primary.includes(d)),
  'partition disjoint: no S1 zone appears in S2'
);
assert(
  p.s2Primary.every((d) => !p.s1Primary.includes(d)),
  'partition disjoint: no S2 zone appears in S1'
);

// ---------------------------------------------------------------
// Section 8 — PATCH 10d citation anchored in source (guards against re-regression)
// ---------------------------------------------------------------
assert(
  /PATCH 10d/.test(sagaSrc),
  'saga: PATCH 10d comment anchor present (traceability to HL #101 / this PR)'
);
assert(
  /PATCH 10d/.test(autoFixSrc),
  'auto-fix: PATCH 10d comment anchor present'
);

console.log('--- all tests passed ---');
