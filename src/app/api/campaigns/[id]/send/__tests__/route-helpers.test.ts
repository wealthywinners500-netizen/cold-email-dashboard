/**
 * /api/campaigns/[id]/send — pure helper unit tests + source-grep contracts.
 *
 * V9 CC #4 (2026-05-01 send-route wiring): the codebase has no jest/vitest
 * and no React Testing Library; tests run as plain `tsx` scripts and
 * source-grep the route + worker text files for the contracts that bind
 * the wiring together (route → initializeSequence; cron deletion).
 *
 * Pattern mirrors src/components/modals/__tests__/sequence-composer-helpers.test.ts.
 */

import {
  validatePrimarySequenceContent,
  buildSendResponse,
} from "../route-helpers";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

console.log("\nsend-route helpers + cron-deletion contract\n");

// ───── validatePrimarySequenceContent ─────
console.log("validatePrimarySequenceContent:");

test("[] returns ok:false reason='Primary sequence has no steps'", () => {
  const r = validatePrimarySequenceContent([]);
  assert(r.ok === false, "expected ok:false");
  assert(r.reason === "Primary sequence has no steps", `unexpected reason: ${r.reason}`);
});

test("null returns ok:false (not an array)", () => {
  const r = validatePrimarySequenceContent(null);
  assert(r.ok === false, "expected ok:false");
  assert(r.reason === "Primary sequence has no steps", `unexpected reason: ${r.reason}`);
});

test("[{}] (empty step) returns ok:false reason='No email body...'", () => {
  const r = validatePrimarySequenceContent([{}]);
  assert(r.ok === false, "expected ok:false");
  assert(
    r.reason === "No email body configured in primary sequence",
    `unexpected reason: ${r.reason}`
  );
});

test("[{ body_html: 'hi' }] returns ok:true", () => {
  const r = validatePrimarySequenceContent([{ body_html: "hi" }]);
  assert(r.ok === true, "expected ok:true");
});

test("[{ ab_variants:[{variant:'A',body_html:'hi'}] }] returns ok:true", () => {
  const r = validatePrimarySequenceContent([
    { ab_variants: [{ variant: "A", body_html: "hi" }] },
  ]);
  assert(r.ok === true, "expected ok:true");
});

test("[{ ab_variants:[{variant:'A'}] }] returns ok:false (variant w/o body)", () => {
  const r = validatePrimarySequenceContent([
    { ab_variants: [{ variant: "A" }] },
  ]);
  assert(r.ok === false, "expected ok:false");
});

test("[{}, { body_html:'hi' }] returns ok:true (any step with content passes)", () => {
  const r = validatePrimarySequenceContent([{}, { body_html: "hi" }]);
  assert(r.ok === true, "expected ok:true");
});

test("whitespace-only body_html does NOT count as content", () => {
  const r = validatePrimarySequenceContent([{ body_html: "   " }]);
  assert(r.ok === false, "expected whitespace-only to fail");
});

// ───── buildSendResponse ─────
console.log("\nbuildSendResponse:");

test("happy path includes states_initialized:5", () => {
  const body = buildSendResponse({
    statesInitialized: 5,
    recipientCount: 5,
    accountCount: 2,
  });
  assert(body.success === true, "success must be true");
  assert(body.states_initialized === 5, `expected states_initialized=5 got ${body.states_initialized}`);
  assert(body.recipients_queued === 5, "recipients_queued mismatch");
  assert(body.accounts_assigned === 2, "accounts_assigned mismatch");
  assert(body.already_initialized === undefined, "already_initialized must be absent on fresh init");
});

test("alreadyInitialized:true sets already_initialized + existing_state_count", () => {
  const body = buildSendResponse({
    alreadyInitialized: true,
    statesInitialized: 0,
    existingStateCount: 12,
    recipientCount: 12,
    accountCount: 2,
  });
  assert(body.already_initialized === true, "already_initialized must be true");
  assert(body.existing_state_count === 12, `expected existing_state_count=12 got ${body.existing_state_count}`);
  assert(body.status === "sending", "status must be 'sending' on idempotent return");
  assert(body.states_initialized === undefined, "states_initialized must be absent on idempotent path");
});

// ───── Source-grep contract on route.ts ─────
console.log("\nroute.ts source contract:");

const routeSrc = readFileSync(join(__dirname, "..", "route.ts"), "utf8");

test("imports initializeSequence from sequence-engine", () => {
  assert(
    /from\s+["']@\/lib\/email\/sequence-engine["']/.test(routeSrc),
    "must import from @/lib/email/sequence-engine"
  );
  assert(
    /\binitializeSequence\s*\(/.test(routeSrc),
    "must call initializeSequence(...)"
  );
});

test("legacy `if (!campaign.body_html)` check is GONE", () => {
  assert(
    !/if\s*\(\s*!\s*campaign\.body_html\s*\)/.test(routeSrc),
    "legacy body_html check must be removed (CC #4: composer writes to campaign_sequences.steps[N].body_html)"
  );
});

test("dead `assigned_account_id` round-robin write is GONE", () => {
  assert(
    !/\.update\(\s*\{\s*assigned_account_id\s*:/.test(routeSrc),
    "route must NOT write campaign_recipients.assigned_account_id (dead path)"
  );
});

test("idempotency pre-check on lead_sequence_state count exists", () => {
  assert(
    /from\(\s*["']lead_sequence_state["']\s*\)/.test(routeSrc),
    "route must query lead_sequence_state for the idempotency pre-check"
  );
});

test("validatePrimarySequenceContent helper is wired", () => {
  assert(
    /\bvalidatePrimarySequenceContent\s*\(/.test(routeSrc),
    "route must call validatePrimarySequenceContent"
  );
});

test("initBoss is awaited before initializeSequence (pg-boss start guard)", () => {
  // sequence-engine.initializeSequence calls boss.send internally; without
  // boss.start() (via initBoss) the call throws "Queue cache is not initialized"
  // on each Vercel cold start. Pattern matches pairs/verify/route.ts:85 and
  // admin/dbl-monitor/run/route.ts:80.
  assert(
    /\bawait\s+initBoss\s*\(\s*\)/.test(routeSrc),
    "route must `await initBoss()` before initializeSequence"
  );
  assert(
    /from\s+["']@\/lib\/email\/campaign-queue["']/.test(routeSrc),
    "route must import initBoss from @/lib/email/campaign-queue"
  );
});

// ───── Source-grep contract on src/worker/index.ts ─────
console.log("\nsrc/worker/index.ts cron-deletion contract:");

const workerIndexPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "worker",
  "index.ts"
);
const workerSrc = readFileSync(workerIndexPath, "utf8");

test("no \"distribute-campaign-sends\" string-literal queue-name reference", () => {
  // The audit comment uses the bare word `distribute-campaign-sends` (without
  // surrounding quotes), so we specifically forbid the quoted-string form.
  assert(
    !/["']distribute-campaign-sends["']/.test(workerSrc),
    "all quoted distribute-campaign-sends references (queue name, schedule, work) must be removed"
  );
});

test("no handleDistributeCampaignSends import or call", () => {
  assert(
    !/handleDistributeCampaignSends/.test(workerSrc),
    "handleDistributeCampaignSends must not be imported or called"
  );
});

test("audit comment is present so future readers see why the cron was removed", () => {
  assert(
    /distribute-campaign-sends cron REMOVED 2026-05-01/.test(workerSrc),
    "must keep the dated audit comment explaining the removal"
  );
});

test("distribute-campaign-sends.ts handler file is gone from disk", () => {
  const handlerPath = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "worker",
    "handlers",
    "distribute-campaign-sends.ts"
  );
  assert(
    !existsSync(handlerPath),
    `${handlerPath} must not exist on disk`
  );
});

// ───── Summary ─────
console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All send-route + cron-deletion tests passed.\n");
