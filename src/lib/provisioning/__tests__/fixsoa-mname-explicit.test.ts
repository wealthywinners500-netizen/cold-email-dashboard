/**
 * fixSOA MNAME-explicit regression test — HL #145-companion to HL #107.
 *
 * Pins the invariant that the saga's `fixSOA` auto-fix passes an explicit
 * `ns1.${nsDomain}` for the SOA MNAME (arg-3 of v-change-dns-domain-soa)
 * — never an empty string `''`.
 *
 * Background: HL #107 (Session 04d) documented the SOA timer canonical
 * values and claimed extra timer args were "silently ignored" by HestiaCP.
 * That documentation was wrong about the MNAME slot (arg-3): HestiaCP
 * 1.9.4 accepts `''` and emits `MNAME=""` to the BIND zone file, which
 * BIND renders as `.` (root). MXToolbox's "Primary Name Server Listed At
 * Parent" check then fails on every zone in the cluster.
 *
 * P19 Phase H reproduced the bug on 13/13 zones; the operational fix was
 * `v-change-dns-domain-soa admin <z> ns1.<nsDomain> '' 3600 600 2419200
 * 3600`. See reports/2026-04-25-p19-complete-summary.md §8 for the full
 * forensic record.
 *
 * The bug is dormant in the saga today only because P11–P17 happened to
 * pass VG1 SOA checks cleanly without invoking the dispatcher. Any future
 * pair that hits a SOA drift during VG1 fires `fix_soa` and reproduces
 * the empty-MNAME wipe across all zones — this test pins the regression
 * so a future drive-by edit cannot reintroduce the empty-MNAME pattern.
 *
 * Run: tsx src/lib/provisioning/__tests__/fixsoa-mname-explicit.test.ts
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

function extractBlock(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) return '';
  const rest = src.slice(start);
  const end = rest.indexOf(endMarker);
  if (end < 0) return rest;
  return rest.slice(0, end);
}

console.log('--- fixSOA MNAME-explicit (HL #145-companion to #107) ---');

const autoFixSrc = readFileSync(
  join(__dirname, '..', 'auto-fix.ts'),
  'utf8'
);

// ---------------------------------------------------------------
// Section 1 — fixSOA function block located + scope assertions
// ---------------------------------------------------------------
const fixSOABlock = extractBlock(
  autoFixSrc,
  'async function fixSOA(',
  '\nasync function '
);
assert(fixSOABlock.length > 0, 'auto-fix: fixSOA function block located');

// Sanity: this is the simple SOA setter, NOT the AXFR-aware serial sync.
assert(
  !/fixSOASerialSync/.test(fixSOABlock),
  'auto-fix: extracted block is fixSOA (not fixSOASerialSync)'
);

// ---------------------------------------------------------------
// Section 2 — params type widened to include nsDomain
// ---------------------------------------------------------------
assert(
  /params:\s*\{\s*nsDomain:\s*string;/.test(fixSOABlock),
  'fixSOA: params type includes `nsDomain: string` as the first field'
);

// ---------------------------------------------------------------
// Section 3 — v-change-dns-domain-soa command shape
// ---------------------------------------------------------------
const cmdMatch = fixSOABlock.match(
  /v-change-dns-domain-soa admin \$\{domain\} ([^\s'`]+) ([^`]+?) 3600 600 2419200 3600`/
);
assert(cmdMatch !== null, 'fixSOA: v-change-dns-domain-soa command found with HL #107 timers (3600 600 2419200 3600)');

const arg3 = cmdMatch![1];
const arg4 = cmdMatch![2];

// Arg-3 (MNAME) MUST be an explicit ns1.${params.nsDomain}, NEVER '' or empty.
assert(
  arg3 === 'ns1.${params.nsDomain}',
  `fixSOA: SOA arg-3 (MNAME) is the literal \`ns1.\${params.nsDomain}\` (got: ${JSON.stringify(arg3)})`
);
assert(
  arg3 !== "''" && arg3 !== '""' && arg3.length > 0,
  'fixSOA: SOA arg-3 (MNAME) is NEVER an empty string (HL #145-companion regression guard)'
);
assert(
  /\$\{params\.nsDomain\}/.test(arg3),
  'fixSOA: SOA arg-3 (MNAME) interpolates params.nsDomain (per-zone correct primary)'
);

// Arg-4 (RNAME / TTL slot — see HL #107 / HestiaCP defaults) — current pattern
// keeps this as '' so HestiaCP's default applies. This arg is NOT load-bearing
// the way MNAME is; this assertion is here to detect drift.
assert(
  arg4 === "''",
  `fixSOA: SOA arg-4 remains '' per established HestiaCP-default pattern (got: ${JSON.stringify(arg4)})`
);

// ---------------------------------------------------------------
// Section 4 — Hard regression guards: no `'' ''` pattern after admin domain
// ---------------------------------------------------------------
// The exact bug shape was: `v-change-dns-domain-soa admin ${domain} '' '' 3600
// 600 2419200 3600`. Pin that two-empty-arg sequence does NOT appear in the
// fixSOA block.
assert(
  !/v-change-dns-domain-soa admin \$\{domain\} '' ''/.test(fixSOABlock),
  "fixSOA: no `v-change-dns-domain-soa admin {domain} '' ''` two-empty-arg pattern (the P19 bug shape)"
);

// HL #107 timers are still present and unchanged (not touched by this fix).
assert(
  /3600 600 2419200 3600/.test(fixSOABlock),
  'fixSOA: HL #107 canonical timers preserved (Refresh 3600, Retry 600, Expire 2419200, Minimum 3600)'
);

// ---------------------------------------------------------------
// Section 5 — Golden vs preserve-wave parity (both nsDomain values produce
// a valid command shape — the source uses ${params.nsDomain} so any string
// is accepted, but pin the substring substitution explicitly).
// ---------------------------------------------------------------
const goldenCmd = `v-change-dns-domain-soa admin example.info ns1.launta.info '' 3600 600 2419200 3600`;
const preserveCmd = `v-change-dns-domain-soa admin example.info ns1.marketpartners.info '' 3600 600 2419200 3600`;

assert(
  /ns1\.\$\{params\.nsDomain\}/.test(fixSOABlock),
  `fixSOA: command template renders to e.g. golden=\`${goldenCmd}\` and preserve=\`${preserveCmd}\` (substring shape verified)`
);

// ---------------------------------------------------------------
// Section 6 — Dispatcher passes the full params (incl. nsDomain) to fixSOA
// ---------------------------------------------------------------
// runAutoFixes already declares `nsDomain: string` at line ~1128. The dispatch
// case `await fixSOA(ssh1, ssh2, issue.domain, params)` passes the full params
// object — pin both invariants so the wiring stays intact.
assert(
  /export async function runAutoFixes\(/.test(autoFixSrc),
  'auto-fix: runAutoFixes is exported'
);
const runAutoFixesParamsBlock = extractBlock(
  autoFixSrc,
  'export async function runAutoFixes(',
  '): Promise<{ fixed:'
);
assert(
  /nsDomain:\s*string;/.test(runAutoFixesParamsBlock),
  'runAutoFixes: params type still declares `nsDomain: string` (saga callsite already passes context.nsDomain)'
);
assert(
  /case 'fix_soa':\s*\n\s*await fixSOA\(ssh1, ssh2, issue\.domain, params\);/.test(autoFixSrc),
  "runAutoFixes dispatcher: 'fix_soa' case calls fixSOA with full params (so nsDomain reaches fixSOA)"
);

// ---------------------------------------------------------------
// Section 7 — HL traceability: comment anchors HL #145 / HL #107 / P19 §8
// ---------------------------------------------------------------
assert(
  /HL #145|HL #107|P19/.test(fixSOABlock),
  'fixSOA: HL traceability comment present (#145-companion to #107 / P19 Phase H)'
);

console.log('--- all tests passed ---');
