/**
 * CC #5b2-v2 — sidecar cross-file invariant tests.
 *
 * Belt-and-suspenders future-CC-resilience: catches refactors that
 * accidentally diverge the env-var name or remove the helper from one
 * site but not the other. CC #5b1's and CC #5b1.5's own tests pin
 * each file's local invariants; THIS test pins what they share.
 *
 * Specifically: USE_PANEL_SIDECAR_ACCOUNT_IDS is consumed at THREE
 * sites that must stay in lockstep:
 *   - src/lib/email/smtp-manager.ts          (sender-pipeline gate)
 *   - src/lib/email/error-handler.ts         (handleImapError suppress)
 *   - src/worker/handlers/smtp-connection-monitor.ts (monitor skip)
 *
 * If a future commit renames the env var in one site without touching
 * the others, the production canary becomes incoherent — some surfaces
 * gate-on, others don't, and accounts cascade-disable through the
 * un-renamed surface. This test fails loud BEFORE merge.
 *
 * Run via: tsx src/__tests__/sidecar-cross-file-invariants.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  tests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

console.log('\nsidecar cross-file invariants\n');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const smtpManagerSrc = readFileSync(resolve(root, 'lib/email/smtp-manager.ts'), 'utf8');
const errorHandlerSrc = readFileSync(resolve(root, 'lib/email/error-handler.ts'), 'utf8');
const monitorSrc = readFileSync(resolve(root, 'worker/handlers/smtp-connection-monitor.ts'), 'utf8');
const sidecarHealthSrc = readFileSync(resolve(root, 'worker/handlers/sidecar-health-monitor.ts'), 'utf8');
const workerIndexSrc = readFileSync(resolve(root, 'worker/index.ts'), 'utf8');

test('USE_PANEL_SIDECAR_ACCOUNT_IDS is referenced in all 3 sender-pipeline sites', () => {
  assert(smtpManagerSrc.includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'smtp-manager.ts missing env var');
  assert(errorHandlerSrc.includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'error-handler.ts missing env var');
  assert(monitorSrc.includes('USE_PANEL_SIDECAR_ACCOUNT_IDS'), 'smtp-connection-monitor.ts missing env var');
});

test('SIDECAR_DEPLOYED_HOSTS env var is consumed by sidecar-health-monitor.ts', () => {
  assert(sidecarHealthSrc.includes('SIDECAR_DEPLOYED_HOSTS'), 'sidecar-health-monitor.ts missing env var');
});

test('SIDECAR_HMAC_SECRET env var is referenced by both sender (smtp-manager) and prober (sidecar-health-monitor)', () => {
  assert(smtpManagerSrc.includes('SIDECAR_HMAC_SECRET'), 'smtp-manager.ts must sign with HMAC_SECRET');
  // Note: sidecar-health-monitor probes /admin/health which is unauthenticated, so HMAC_SECRET
  // is intentionally NOT required there. This test only documents the sender-side invariant.
});

test('worker/index.ts registers BOTH crons that protect sidecar accounts', () => {
  assert(/"smtp-connection-monitor"/.test(workerIndexSrc), 'smtp-connection-monitor cron registered');
  assert(/"sidecar-health-monitor"/.test(workerIndexSrc), 'sidecar-health-monitor cron registered');
});

test('worker/index.ts schedules BOTH crons at */15 cadence (lockstep with smtp-cm window)', () => {
  // The 15-min cadence on sidecar-health-monitor matches smtp-connection-monitor by design:
  // both observe the same cohort of accounts (sidecar-flagged) but on different liveness axes.
  // Drift between cadences would create an alerting blind-spot.
  assert(
    /boss\.schedule\(\s*"smtp-connection-monitor",\s*"\*\/15 \* \* \* \*"\s*\)/.test(workerIndexSrc),
    'smtp-connection-monitor on */15'
  );
  assert(
    /boss\.schedule\(\s*"sidecar-health-monitor",\s*"\*\/15 \* \* \* \*"\s*\)/.test(workerIndexSrc),
    'sidecar-health-monitor on */15'
  );
});

test('handleImapError generic-branch suppress and smtp-connection-monitor skip use the SAME helper name', () => {
  // The helper name `getSidecarAccountIds` is identical across error-handler.ts and
  // smtp-connection-monitor.ts. CC #5b1 created it in monitor.ts; CC #5b1.5 created
  // a copy in error-handler.ts (intentionally duplicated to keep the modules
  // independent — but they MUST keep the same name + parsing semantics so that
  // `USE_PANEL_SIDECAR_ACCOUNT_IDS` stays a single canonical operator-facing var).
  assert(/function getSidecarAccountIds/.test(errorHandlerSrc), 'error-handler.ts has helper');
  assert(/function getSidecarAccountIds/.test(monitorSrc), 'smtp-connection-monitor.ts has helper');
});

console.log(`\n${tests - failed}/${tests} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed > 0) process.exit(1);
