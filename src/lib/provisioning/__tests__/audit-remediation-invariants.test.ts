/**
 * Audit-remediation invariants — 2026-04-21 workspace audit, Part 5.
 *
 * Four invariants that pin the three drift failures closed by the
 * `gate0/audit-remediation-2026-04-21` branch:
 *
 *   5.1. HL #95 is cited nowhere in src/ (number-collision cleanup). The
 *        real HL #95 is Let's-Encrypt DNS propagation; the 9 pre-remediation
 *        citations meant HL #109 (DMARC canonical) or HL #112 (zone sync).
 *   5.2. Canonical DMARC template (dns-templates.ts CANONICAL_DMARC_VALUE)
 *        and every src/ emitter publishes `v=DMARC1` WITHOUT
 *        `rua=`/`ruf=`/`fo=` — HL #109, per RFC 7489 §7.1 (External
 *        Destinations) and §3.2 (Organizational Domain via Public Suffix).
 *   5.3. No ghost HL citations in src/ for HL numbers ≥ 1 — every HL
 *        number cited in src/ must have a `## N.` heading in the master
 *        `feedback_hard_lessons.md`. Rescoped from ≥ 81 → ≥ 1 by the
 *        2026-04-22 HL #1–#80 audit: cited bullets #1–#77 were promoted
 *        to `## N.` headings in place, 25 collide-class citations were
 *        redirected to current-target headings (#113–#135 recovered from
 *        code comments, plus 2 renumber-to-existing), and 2 ghost
 *        citations (#78, #79) were recovered as #132 and #135 respectively.
 *        See `reports/2026-04-22-hl-1-80-audit-decisions.md`.
 *   5.4. MEMORY.md does not still claim `Main = Vercel = worker = be1006b`
 *        as the live HEAD (guards against the 2026-04-19 stale-HEAD drift
 *        the audit caught; HEAD has since advanced past 5890331 and onward).
 *
 * Run: tsx src/lib/provisioning/__tests__/audit-remediation-invariants.test.ts
 *
 * Memory files for 5.3 and 5.4 live outside the repo at
 * `Master Claude Cowork/.auto-memory/`. The default path resolves via
 * `__dirname` relative to that layout. Override with the env vars:
 *   HL_FILE=/path/to/feedback_hard_lessons.md
 *   MEMORY_INDEX=/path/to/MEMORY.md
 * If either file is unreachable, the dependent test logs a SKIP line
 * (not a failure) so CI without the memory mount still passes.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

function fail(label: string, detail: string): never {
  console.error(`FAIL: ${label}\n  ${detail}`);
  process.exit(1);
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
      walkTsFiles(full, acc);
    } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      acc.push(full);
    }
  }
  return acc;
}

const SRC_DIR = resolve(__dirname, '..', '..', '..', '..', 'src');
const SELF_PATH = __filename;
const DNS_TEMPLATES_REL = 'lib/provisioning/dns-templates.ts';

const srcFiles = walkTsFiles(SRC_DIR).filter((f) => f !== SELF_PATH);

// ---------------------------------------------------------------------------
// Test 5.1 — no HL #95 citations in src/ (number-collision cleanup).
// ---------------------------------------------------------------------------
console.log('--- Test 5.1: no HL #95 citations in src/ ---');
{
  const hits: string[] = [];
  const re = /(HL|Hard Lesson|Lesson)\s*#?\s*95\b/;
  for (const f of srcFiles) {
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  if (hits.length > 0) {
    fail(
      'HL #95 is cited in src/ — pre-audit these meant HL #109 (DMARC canonical) or HL #112 (zone sync)',
      hits.join('\n  ')
    );
  }
  console.log('PASS: HL #95 is not cited anywhere in src/');
}

// ---------------------------------------------------------------------------
// Test 5.2 — canonical DMARC is emitted, no external rua / ruf / fo.
// ---------------------------------------------------------------------------
console.log('--- Test 5.2: canonical DMARC has no rua / ruf / fo ---');

// Part A — dns-templates.ts defines CANONICAL_DMARC_VALUE with no rua/ruf/fo.
{
  const dnsTemplatesPath = resolve(SRC_DIR, DNS_TEMPLATES_REL);
  if (!existsSync(dnsTemplatesPath)) {
    fail(
      'dns-templates.ts does not exist',
      `Expected ${dnsTemplatesPath} to export CANONICAL_DMARC_VALUE (Part 3 of the 2026-04-21 audit remediation).`,
    );
  }
  const dnsTemplatesSrc = readFileSync(dnsTemplatesPath, 'utf8');
  const constMatch = dnsTemplatesSrc.match(
    /CANONICAL_DMARC_VALUE\s*=\s*(`[^`]*`|"[^"]*"|'[^']*')/,
  );
  if (!constMatch) {
    fail(
      'dns-templates.ts exists but CANONICAL_DMARC_VALUE is not defined as a literal string',
      'Expected `export const CANONICAL_DMARC_VALUE = "v=DMARC1; …"` (or backtick / single-quote literal).',
    );
  }
  const canonical = constMatch[1];
  assert(/v=DMARC1/.test(canonical), 'CANONICAL_DMARC_VALUE contains v=DMARC1');
  assert(/p=quarantine/.test(canonical), 'CANONICAL_DMARC_VALUE contains p=quarantine');
  assert(!/\brua=/.test(canonical), 'CANONICAL_DMARC_VALUE has no rua=');
  assert(!/\bruf=/.test(canonical), 'CANONICAL_DMARC_VALUE has no ruf=');
  assert(!/\bfo=/.test(canonical), 'CANONICAL_DMARC_VALUE has no fo=');
}

// Part B — no src file emits a DMARC TXT with rua= / ruf= / fo= on the same line.
{
  const banned: string[] = [];
  for (const f of srcFiles) {
    if (f.endsWith('dns-templates.ts')) continue;
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/v=DMARC1/.test(line) && /(rua=|ruf=|fo=)/.test(line)) {
        banned.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  if (banned.length > 0) {
    fail(
      'src/ still emits DMARC TXT with rua= / ruf= / fo= — emitters must use CANONICAL_DMARC_VALUE (HL #109)',
      banned.join('\n  '),
    );
  }
  console.log('PASS: no src file emits DMARC TXT with rua= / ruf= / fo=');
}

// ---------------------------------------------------------------------------
// Test 5.3 — every HL ≥ 1 cited in src/ exists as a heading in the HL file.
// (Rescoped from ≥ 81 by the 2026-04-22 HL #1–#80 audit.)
// ---------------------------------------------------------------------------
console.log('--- Test 5.3: no ghost HL ≥ 1 citations in src/ ---');
{
  const hlFilePath =
    process.env.HL_FILE ||
    resolve(__dirname, '..', '..', '..', '..', '..', '.auto-memory', 'feedback_hard_lessons.md');
  if (!existsSync(hlFilePath)) {
    console.warn(
      `SKIP: Test 5.3 — memory file ${hlFilePath} not reachable (set HL_FILE env var to override). ` +
        'Advisory: local developers must run this against a populated .auto-memory/.',
    );
  } else {
    const hlSrc = readFileSync(hlFilePath, 'utf8');
    const present = new Set<number>();
    for (const m of hlSrc.matchAll(/^## (\d+)\./gm)) present.add(Number(m[1]));
    const ghosts: string[] = [];
    for (const f of srcFiles) {
      const text = readFileSync(f, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const re = /(HL|Hard Lesson|Lesson)\s*#?\s*(\d+)\b/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const n = Number(m[2]);
          if (n < 1) continue;
          if (!present.has(n)) {
            ghosts.push(`${f}:${i + 1}: HL #${n} (not a heading in feedback_hard_lessons.md)`);
          }
        }
      });
    }
    if (ghosts.length > 0) {
      fail(
        'src/ cites HL numbers that have no matching `## N.` heading in feedback_hard_lessons.md',
        ghosts.join('\n  '),
      );
    }
    console.log(
      `PASS: every HL ≥ 1 cited in src/ has a heading in feedback_hard_lessons.md (file has ${present.size} numbered entries)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Test 5.4 — MEMORY.md does not still claim be1006b as the live HEAD.
// ---------------------------------------------------------------------------
console.log('--- Test 5.4: MEMORY.md not pinning stale be1006b HEAD ---');
{
  const memPath =
    process.env.MEMORY_INDEX ||
    resolve(__dirname, '..', '..', '..', '..', '..', '.auto-memory', 'MEMORY.md');
  if (!existsSync(memPath)) {
    console.warn(
      `SKIP: Test 5.4 — MEMORY.md index ${memPath} not reachable (set MEMORY_INDEX env var to override).`,
    );
  } else {
    const memSrc = readFileSync(memPath, 'utf8');
    assert(
      !/Main\s*=\s*Vercel\s*=\s*worker\s*=\s*be1006b/i.test(memSrc),
      'MEMORY.md does not still claim `Main = Vercel = worker = be1006b` (2026-04-19 snapshot)',
    );
  }
}

console.log('\nAll audit-remediation invariants passed.');
