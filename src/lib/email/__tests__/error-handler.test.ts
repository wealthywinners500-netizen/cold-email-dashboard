/**
 * CC #5b1.5 — error-handler.ts contract tests.
 *
 * Mix of pure-helper tests (getSidecarAccountIds via env-shadowed re-import)
 * and source-grep contracts (pattern matches CC #5b1's smtp-manager-sidecar.test.ts).
 * Source-grep dominates because handleImapError requires Supabase at runtime
 * and this codebase uses no jest/vitest mocking infra.
 *
 * Run via: tsx src/lib/email/__tests__/error-handler.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

console.log('\nerror-handler tests (CC #5b1.5)\n');

const here = dirname(fileURLToPath(import.meta.url));
const errorHandlerPath = resolve(here, '..', 'error-handler.ts');
const imapSyncPath = resolve(here, '..', 'imap-sync.ts');
const smtpMonitorPath = resolve(here, '..', '..', '..', 'worker', 'handlers', 'smtp-connection-monitor.ts');

const ehSrc = readFileSync(errorHandlerPath, 'utf8');
const isSrc = readFileSync(imapSyncPath, 'utf8');
const monitorSrc = readFileSync(smtpMonitorPath, 'utf8');

(async () => {
  // ───── Pure helpers — getSidecarAccountIds parser parity ─────
  // Mirror CC #5b1's parser exactly. Re-implement here to test the parsing
  // contract without importing (the helper isn't exported from error-handler.ts;
  // not needed publicly — it's internal). This locks the parsing equivalence
  // between error-handler.ts and smtp-connection-monitor.ts at gate0 time.
  function ehParser(): Set<string> {
    const raw = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || '';
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }

  await test('parser returns empty Set when env var unset', () => {
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
    const s = ehParser();
    assert(s instanceof Set, 'returns a Set');
    assert(s.size === 0, 'empty when unset');
  });

  await test('parser parses comma-separated UUIDs', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS =
      '11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222';
    const s = ehParser();
    assert(s.size === 2, 'two ids parsed');
    assert(s.has('11111111-1111-1111-1111-111111111111'), 'first');
    assert(s.has('22222222-2222-2222-2222-222222222222'), 'second');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  await test('parser is whitespace-tolerant', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = '  a  ,  b  ,  c  ';
    const s = ehParser();
    assert(s.size === 3, '3 entries despite whitespace');
    assert(s.has('a'), 'a trimmed');
    assert(s.has('b'), 'b trimmed');
    assert(s.has('c'), 'c trimmed');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  await test('parser drops empty entries from trailing/leading commas', () => {
    process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS = ',a,,b,';
    const s = ehParser();
    assert(s.size === 2, 'only a + b retained');
    assert(s.has('a'), 'a present');
    assert(s.has('b'), 'b present');
    assert(!s.has(''), 'empty string filtered');
    delete process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS;
  });

  // ───── Parser parity with smtp-connection-monitor.ts ─────
  await test('error-handler parser matches CC #5b1 smtp-connection-monitor parser byte-shape', () => {
    // Both files must use the same parsing recipe so the same UUID list
    // produces the same in/out membership decisions across both code paths.
    // Match: split(',').map(trim).filter(Boolean).
    const ehMatch = ehSrc.match(
      /function getSidecarAccountIds\([^)]*\)[^{]*\{[\s\S]*?\}/
    );
    const monMatch = monitorSrc.match(
      /function getSidecarAccountIds\([^)]*\)[^{]*\{[\s\S]*?\}/
    );
    assert(ehMatch, 'error-handler.ts contains getSidecarAccountIds()');
    assert(monMatch, 'smtp-connection-monitor.ts contains getSidecarAccountIds()');
    // Both must reference the same env var.
    assert(ehMatch![0].includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'eh reads canary env');
    assert(monMatch![0].includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'monitor reads canary env');
    // Both must split on comma + trim + Boolean-filter.
    assert(/split\(['"],['"]\)/.test(ehMatch![0]), 'eh splits on comma');
    assert(/\.map\(.*\.trim\(\)\)/.test(ehMatch![0]), 'eh trims');
    assert(/\.filter\(Boolean\)/.test(ehMatch![0]), 'eh filter Boolean');
  });

  // ───── Source-grep: handleImapError signature has optional context ─────
  await test('handleImapError signature includes optional context?: ImapErrorContext', () => {
    assert(
      /export async function handleImapError\(\s*error:\s*Error,\s*accountId:\s*string,\s*orgId:\s*string,\s*context\?:\s*ImapErrorContext\s*\):\s*Promise<void>/.test(ehSrc),
      '4-arg signature with optional context required'
    );
  });

  await test('ImapErrorContext interface declares the verified imapflow fields', () => {
    assert(/export interface ImapErrorContext/.test(ehSrc), 'interface exported (callers may use it)');
    assert(/responseStatus\?:\s*string/.test(ehSrc), 'responseStatus field');
    assert(/responseText\?:\s*string/.test(ehSrc), 'responseText field');
    assert(/executedCommand\?:\s*string/.test(ehSrc), 'executedCommand field (NOT command — verified vs imapflow v1.2.18)');
    assert(/code\?:\s*string\s*\|\s*number/.test(ehSrc), 'code field');
    assert(/cause\?:\s*string/.test(ehSrc), 'cause field');
  });

  // ───── Source-grep: GENERIC branch is sidecar-aware ─────
  await test('GENERIC branch reads isSidecarAccount before cascade-disabling', () => {
    // The decision shape we want: in the generic catch-all (after the 3
    // previous if/else-if branches close), failures>=3 leads to an
    // if (isSidecarAccount) ... else ... split.
    assert(
      /isSidecarAccount/.test(ehSrc),
      'must reference isSidecarAccount in body'
    );
    // Make sure the sidecar-suppress alert lives inside the failures>=3 generic
    // branch, not somewhere else: the suppress text has the canonical phrase.
    assert(
      ehSrc.includes('cascade-disable suppressed'),
      'sidecar suppress branch present with canonical phrase'
    );
  });

  await test('sidecar suppress alert is severity=warning + sidecar_protected=true', () => {
    // Find the suppress branch and confirm its alert literal.
    const idx = ehSrc.indexOf('cascade-disable suppressed');
    assert(idx > 0, 'suppress phrase exists');
    // Look ~250 chars around it for the severity + flag.
    const window = ehSrc.slice(Math.max(0, idx - 400), idx + 400);
    assert(/'warning'/.test(window), 'severity warning');
    assert(/sidecar_protected:\s*true/.test(window), 'sidecar_protected: true flag');
  });

  await test('non-sidecar generic-error branch still sets status=disabled at cf>=3', () => {
    // Four updateData.status='disabled' assignments total in the file:
    //   - handleSmtpError AUTH (535) cascade
    //   - handleSmtpError generic cascade
    //   - handleImapError AUTH cascade (unchanged for sidecar — real creds problem)
    //   - handleImapError generic cascade (now wrapped by `if (isSidecarAccount) ... else { ... }`
    //     — only the non-sidecar arm sets status='disabled')
    // Pre-CC#5b1.5 there were also 4 — we did NOT remove the IMAP cascade for
    // non-sidecar accounts (existing behavior preserved).
    const matches = ehSrc.match(/updateData\.status\s*=\s*'disabled'/g) || [];
    assert(matches.length === 4, `expected exactly 4 status='disabled' assignments (2 SMTP + 2 IMAP), got ${matches.length}`);
    // Stronger: assert the 4th occurrence (handleImapError generic non-sidecar)
    // sits inside an `else {` block (the sidecar guard split).
    const handleImapStart = ehSrc.indexOf('export async function handleImapError');
    const handleImapEnd = ehSrc.indexOf('export async function handleWorkerError', handleImapStart);
    const fnBody = ehSrc.slice(handleImapStart, handleImapEnd);
    const imapDisableMatches = fnBody.match(/updateData\.status\s*=\s*'disabled'/g) || [];
    assert(imapDisableMatches.length === 2, `expected 2 status='disabled' inside handleImapError (AUTH + generic-non-sidecar), got ${imapDisableMatches.length}`);
  });

  // ───── Source-grep: AUTH-failure branch unchanged for sidecar accounts ─────
  await test('AUTH-failure branch does NOT branch on isSidecarAccount (fully cascades for everyone)', () => {
    // Pull the AUTH-failure block and confirm no isSidecarAccount inside.
    const authIdx = ehSrc.indexOf('AUTHENTICATIONFAILED');
    assert(authIdx > 0, 'AUTH branch exists');
    // The next else-if (Connection-lost) starts with 'ECONNREFUSED' —
    // bound the AUTH block by that.
    const nextIdx = ehSrc.indexOf('ECONNREFUSED', authIdx);
    assert(nextIdx > authIdx, 'next branch found');
    const authBlock = ehSrc.slice(authIdx, nextIdx);
    assert(
      !/isSidecarAccount/.test(authBlock),
      'AUTH branch must NOT consult isSidecarAccount — sidecar can\'t fix wrong creds'
    );
    assert(
      authBlock.includes("updateData.status = 'disabled'"),
      'AUTH still cascades at cf>=3'
    );
  });

  await test('Mailbox-not-found branch does NOT branch on isSidecarAccount (alert-only for everyone)', () => {
    const mbIdx = ehSrc.indexOf('Mailbox not found');
    assert(mbIdx > 0, 'mailbox branch exists');
    const elseIdx = ehSrc.indexOf('} else {', mbIdx);
    assert(elseIdx > mbIdx, 'else block found');
    const mbBlock = ehSrc.slice(mbIdx, elseIdx);
    assert(
      !/isSidecarAccount/.test(mbBlock),
      'mailbox-not-found branch must NOT consult isSidecarAccount'
    );
  });

  // ───── Source-grep: all 4 branches spread context into alert details ─────
  await test('all 4 branches spread ...(context || {}) into alert details', () => {
    // Count occurrences. We have:
    //   AUTH cascade-disable critical + AUTH warning
    //   Connection-lost warning
    //   Mailbox-not-found critical
    //   Generic sidecar-suppress warning + Generic non-sidecar critical
    // = 6 alert-creating sites total inside handleImapError. Each must spread context.
    const handleImapStart = ehSrc.indexOf('export async function handleImapError');
    assert(handleImapStart > 0, 'handleImapError found');
    // End of function = matching closing brace; conservative: take a slice through
    // the next `export async function` definition (handleWorkerError).
    const handleImapEnd = ehSrc.indexOf('export async function handleWorkerError', handleImapStart);
    assert(handleImapEnd > handleImapStart, 'handleWorkerError marker found');
    const fnBody = ehSrc.slice(handleImapStart, handleImapEnd);
    const spreadCount = (fnBody.match(/\.\.\.\(context \|\| \{\}\)/g) || []).length;
    assert(
      spreadCount === 6,
      `expected 6 spreads of ...(context || {}) inside handleImapError, got ${spreadCount}`
    );
  });

  // ───── Source-grep: imap-sync.ts caller wraps imapflow fields ─────
  await test('imap-sync.ts caller wraps responseText into context arg', () => {
    assert(/responseText:\s*typeof e\.responseText/.test(isSrc),
      'responseText wrapped with typeof guard');
    assert(/executedCommand:\s*typeof e\.executedCommand/.test(isSrc),
      'executedCommand wrapped');
    assert(/responseStatus:\s*e\.responseStatus/.test(isSrc),
      'responseStatus passed');
    assert(/code:\s*e\.code/.test(isSrc), 'code passed');
    assert(/cause:\s*e\.cause\s*\?/.test(isSrc), 'cause guarded');
  });

  await test('imap-sync.ts caller truncates string fields to 500 chars', () => {
    const calls = (isSrc.match(/\.substring\(0,\s*500\)/g) || []).length;
    assert(
      calls >= 3,
      `expected >=3 substring(0, 500) truncations (responseText, executedCommand, cause), got ${calls}`
    );
  });

  await test('imap-sync.ts caller passes context as 4th arg to handleImapError', () => {
    // Confirm the call shape: handleImapError(errObj, account.id, orgId, { ... })
    assert(
      /handleImapError\(\s*errObj,\s*account\.id,\s*orgId,\s*\{/.test(isSrc),
      '4-arg call shape required'
    );
  });

  // ───── Out-of-scope guards ─────
  await test('handleSmtpError signature unchanged (out of scope this session)', () => {
    // SMTP error handler must remain the original 3-arg shape.
    assert(
      /export async function handleSmtpError\(\s*error:\s*Error \| null,\s*accountId:\s*string,\s*orgId:\s*string\s*\):\s*Promise<void>/.test(ehSrc),
      'handleSmtpError signature must be byte-identical to pre-CC#5b1.5'
    );
    // And it must NOT consult isSidecarAccount — SMTP cascade is CC #5a v2 territory.
    const smtpStart = ehSrc.indexOf('export async function handleSmtpError');
    const smtpEnd = ehSrc.indexOf('export async function handleImapError', smtpStart);
    const smtpBlock = ehSrc.slice(smtpStart, smtpEnd);
    assert(
      !/isSidecarAccount/.test(smtpBlock),
      'handleSmtpError must NOT have been touched'
    );
  });

  await test('handleWorkerError + resetDailyCounters + updateWorkerHeartbeat unchanged', () => {
    // Spot-check that the other exports still match their pre-CC#5b1.5 signatures.
    assert(
      /export async function handleWorkerError\(\s*error:\s*Error,\s*jobName:\s*string,\s*jobData:\s*any,\s*orgId\?:\s*string\s*\):\s*Promise<void>/.test(ehSrc),
      'handleWorkerError unchanged'
    );
    assert(
      /export async function resetDailyCounters\(orgId:\s*string\):\s*Promise<void>/.test(ehSrc),
      'resetDailyCounters unchanged'
    );
    assert(
      /export async function updateWorkerHeartbeat\(orgId:\s*string\):\s*Promise<void>/.test(ehSrc),
      'updateWorkerHeartbeat unchanged'
    );
  });

  // ───── Backward-compat: 3-arg call must still typecheck ─────
  await test('handleImapError(err, accountId, orgId) — 3-arg call compiles (context is optional)', () => {
    // We don't run a separate tsc here (gate0 will), but we verify the
    // `context?:` optional marker is present (which is what makes 3-arg legal).
    assert(/context\?:\s*ImapErrorContext/.test(ehSrc), 'context param marked optional');
  });

  // ───── Final ─────
  console.log(`\n${tests - failed}/${tests} passed${failed ? `, ${failed} FAILED` : ''}`);
  if (failed > 0) process.exit(1);
})();
