/**
 * Saga isolation invariant for the dbl-resweep PR.
 *
 * The dbl-resweep work explicitly promised not to touch saga territory.
 * This test pins that promise into the gate-0 chain — if any future
 * commit on this branch (or a rebase against main) introduces a change
 * to the listed paths, this test FAILS LOUD before the PR can merge.
 *
 * Two invariants:
 *   (a) None of the 16 listed saga files appear in
 *         git diff --name-only origin/main...HEAD
 *   (b) No path under app/api/provisioning/, app/dashboard/provisioning/,
 *         or app/dashboard/pairs/ appears in the same diff
 *
 * Plain tsx + assert() to match the gate-0 test style. No vitest.
 *
 * Run: tsx src/__tests__/dbl-resweep-saga-isolation.test.ts
 */

import { execSync } from 'child_process';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

console.log('--- dbl-resweep saga-isolation invariant ---');

// ---------------------------------------------------------------
// Resolve the diff list. Prefer origin/main; fall back to local main
// if origin/main isn't available (rare in CI but happens with shallow
// fetches). If neither exists we skip — the gate is meaningful only
// when both refs are reachable.
// ---------------------------------------------------------------

function safeRev(ref: string): boolean {
  try {
    execSync(`git rev-parse --verify ${ref}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

let baseRef: string | null = null;
if (safeRev('origin/main')) {
  baseRef = 'origin/main';
} else if (safeRev('main')) {
  baseRef = 'main';
}

if (!baseRef) {
  console.warn(
    'SKIP: neither origin/main nor main is reachable — saga-isolation gate cannot run here.'
  );
  process.exit(0);
}

const diffOutput = execSync(`git diff --name-only ${baseRef}...HEAD`, {
  encoding: 'utf8',
});
const changedFiles = diffOutput
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(
  `[saga-isolation] base=${baseRef} files-changed=${changedFiles.length}`
);

// ---------------------------------------------------------------
// Invariant (a) — exact-path file list
// ---------------------------------------------------------------

const FORBIDDEN_FILES = [
  'src/lib/provisioning/pair-provisioning-saga.ts',
  'src/worker/handlers/provision-step.ts',
  'src/worker/handlers/pair-verify.ts',
  'src/lib/provisioning/serverless-steps.ts',
  'src/lib/provisioning/auto-fix.ts',
  'src/lib/provisioning/dns-templates.ts',
  'src/lib/provisioning/domain-blacklist.ts',
  'src/lib/provisioning/domain-listing.ts',
  'src/lib/provisioning/checks/intodns-health.ts',
  'src/lib/provisioning/checks/mxtoolbox-health.ts',
  'src/lib/provisioning/dnsbl-liveness.ts',
  'src/app/api/provisioning/[jobId]/worker-callback/route.ts',
  'src/app/api/provisioning/[jobId]/execute-step/route.ts',
  // Plus three core libs that any future saga regression would touch
  'src/lib/provisioning/encryption.ts',
  'src/lib/provisioning/cloud-init-templates.ts',
  'src/lib/provisioning/csv-generator.ts',
];

const violatedFiles = changedFiles.filter((f) => FORBIDDEN_FILES.includes(f));
if (violatedFiles.length > 0) {
  console.error('Forbidden files modified by this branch:');
  for (const f of violatedFiles) console.error(`  - ${f}`);
}
assert(
  violatedFiles.length === 0,
  '(a) zero saga files modified by this branch'
);

// ---------------------------------------------------------------
// Invariant (b) — directory-prefix patterns
// ---------------------------------------------------------------

const FORBIDDEN_PREFIXES = [
  /^src\/app\/api\/provisioning\//,
  /^src\/app\/dashboard\/provisioning\//,
  /^src\/app\/dashboard\/pairs\//,
  // Also catch the bare /app/... form in case the repo layout changes.
  /^app\/api\/provisioning\//,
  /^app\/dashboard\/provisioning\//,
  /^app\/dashboard\/pairs\//,
];

const violatedPrefixes = changedFiles.filter((f) =>
  FORBIDDEN_PREFIXES.some((re) => re.test(f))
);
if (violatedPrefixes.length > 0) {
  console.error('Forbidden directories touched by this branch:');
  for (const f of violatedPrefixes) console.error(`  - ${f}`);
}
assert(
  violatedPrefixes.length === 0,
  '(b) zero provisioning/pairs UI or API paths modified'
);

console.log('--- saga-isolation invariant: all PASS ---');
