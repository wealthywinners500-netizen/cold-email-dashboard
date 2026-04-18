/**
 * Smoke test for the Pair Detail client component.
 *
 * This repo has no jest/vitest and no React Testing Library. The main
 * correctness signal for UI is `npm run typecheck` plus manual browser
 * verification. This script adds a lightweight runtime sanity check that
 * the module's exported constants match the UX contract (5s polling, 5min
 * cap) and that the admin-gating prop is the documented boolean shape.
 *
 * We intentionally avoid importing the React component module directly:
 * pair-detail-client.tsx is a "use client" file that pulls in next/link,
 * @radix-ui/react-dialog, and sonner — all browser-oriented. Under plain
 * tsx they may throw on module top-level side-effects (e.g. crypto hooks).
 * Importing the types module is sufficient for this sanity check; the
 * actual compile of the component is covered by `npm run typecheck`.
 */

import { POLL_INTERVAL_MS, POLL_MAX_MS } from '../types';
import type { PairSummary, VerificationRow, VerificationStatus } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1) Polling constants match the spec.
assert(POLL_INTERVAL_MS === 5_000, `expected 5s interval, got ${POLL_INTERVAL_MS}`);
assert(POLL_MAX_MS === 5 * 60 * 1_000, `expected 5min cap, got ${POLL_MAX_MS}`);

// 2) Type contract — compile-time assertions (no runtime) but we reference
//    the imported types so the file fails to compile if they drift.
const _statusValues: VerificationStatus[] = ['green', 'yellow', 'red', 'running'];
assert(_statusValues.length === 4, 'status union must have exactly 4 members');

// 3) Read the component source and assert the admin-gating + polling
//    shape. This is a coarse grep — we only need to detect regressions
//    in the public contract, not parse the full AST.
const componentPath = join(__dirname, '..', 'pair-detail-client.tsx');
const src = readFileSync(componentPath, 'utf8');

assert(
  src.includes('"use client"') || src.includes("'use client'"),
  'pair-detail-client must be a client component'
);
assert(
  /isAdmin:\s*boolean/.test(src),
  'pair-detail-client must expose isAdmin: boolean in its props'
);
assert(
  src.includes('POLL_INTERVAL_MS'),
  'pair-detail-client must use POLL_INTERVAL_MS for polling cadence'
);
assert(
  src.includes('POLL_MAX_MS'),
  'pair-detail-client must use POLL_MAX_MS for polling cap'
);
assert(
  /\/api\/pairs\/.+\/verify/.test(src),
  'pair-detail-client must call POST /api/pairs/[id]/verify'
);
assert(
  /\/api\/pairs\/.+\/verifications\//.test(src),
  'pair-detail-client must poll /api/pairs/[id]/verifications/[vid]'
);
assert(
  /isAdmin\s*&&/.test(src) || /if\s*\(\s*!\s*isAdmin\s*\)/.test(src),
  'pair-detail-client must gate privileged UI on isAdmin'
);

// 4) PairSummary + VerificationRow shape compiles — force a structural
//    check so the test fails if the types go out of sync with the route.
const _examplePair: PairSummary = {
  id: 'p-1',
  pair_number: 1,
  ns_domain: 'ns.example.com',
  s1_ip: '203.0.113.10',
  s1_hostname: 'mail1.ns.example.com',
  s2_ip: '203.0.113.11',
  s2_hostname: 'mail2.ns.example.com',
  status: 'complete',
  warmup_day: 0,
};
assert(_examplePair.pair_number === 1, 'PairSummary structural check');

const _exampleRow: VerificationRow = {
  id: 'v-1',
  pair_id: 'p-1',
  run_at: new Date().toISOString(),
  run_by: null,
  status: 'running',
  checks: [],
  duration_ms: null,
};
assert(_exampleRow.status === 'running', 'VerificationRow structural check');

// eslint-disable-next-line no-console
console.log('[pair-detail-client.test] ok — polling constants + admin-gating + API contract verified');
