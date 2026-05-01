/**
 * SequenceComposerModal — helper unit tests + source-grep contract checks.
 *
 * V8 Phase 2 (2026-04-30 sequences-composer): the codebase has no jest/vitest
 * and no React Testing Library; UI tests follow the pattern set by
 * pair-detail-client.test.ts — pure helpers run as plain `tsx` scripts, plus
 * a source-grep of the .tsx file to assert the contract (fetch URLs, body
 * shape, persona validation, etc.) without importing browser-only modules.
 *
 * Helpers under test live in ../sequence-composer-helpers.ts (no React, no
 * Radix, no sonner — safe to import here).
 *
 * Component being grepped: ../sequence-composer-modal.tsx (the React modal
 * that wraps the existing <SequenceStepEditor> in write mode).
 */

import {
  makeDefaultStep,
  initialStepsFor,
  validateComposerInput,
  hasErrors,
  buildCreatePayload,
  buildUpdatePayload,
  endpointFor,
  methodFor,
} from "../sequence-composer-helpers";
import type { CampaignSequence, SequenceStep } from "@/lib/supabase/types";
import { readFileSync } from "node:fs";
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

console.log("\nSequenceComposerModal helpers + contract\n");

// ───── makeDefaultStep ─────
console.log("makeDefaultStep:");

test("step 1 is a single A-variant skeleton with same_thread=false", () => {
  const s = makeDefaultStep(1);
  assert(s.step_number === 1, "step_number wrong");
  assert(s.delay_days === 0 && s.delay_hours === 0, "default delay should be 0/0");
  assert(s.send_in_same_thread === false, "step 1 must NOT default to same_thread");
  assert(s.ab_variants.length === 1, "default should seed exactly one variant");
  assert(s.ab_variants[0].variant === "A", "default variant must be A");
});

test("step >1 defaults to send_in_same_thread=true", () => {
  const s = makeDefaultStep(2);
  assert(s.send_in_same_thread === true, "step 2+ must default to same_thread (matches editor handleAddStep)");
});

// ───── initialStepsFor ─────
console.log("\ninitialStepsFor:");

test("create mode seeds one default step (avoids editor's empty-state early return)", () => {
  const steps = initialStepsFor("create");
  assert(steps.length === 1, "create mode must seed >=1 step so editor renders");
  assert(steps[0].step_number === 1, "seeded step must be step 1");
});

test("edit mode with existing sequence preserves its steps", () => {
  const existing = {
    steps: [
      { step_number: 1, delay_days: 0, delay_hours: 0, subject: "x", body_html: "y", body_text: "z", send_in_same_thread: false, ab_variants: [{ variant: "A", subject: "x", body_html: "y", body_text: "z" }] },
      { step_number: 2, delay_days: 3, delay_hours: 0, subject: "a", body_html: "b", body_text: "c", send_in_same_thread: true, ab_variants: [{ variant: "A", subject: "a", body_html: "b", body_text: "c" }] },
    ],
  } as unknown as CampaignSequence;
  const steps = initialStepsFor("edit", existing);
  assert(steps.length === 2, "edit mode must reflect existing.steps length");
  assert(steps[1].delay_days === 3, "edit mode must reflect existing step content");
});

test("edit mode with empty existing falls back to default seed", () => {
  const existing = { steps: [] } as unknown as CampaignSequence;
  const steps = initialStepsFor("edit", existing);
  assert(steps.length === 1, "empty edit must still seed a step so editor renders");
});

// ───── validateComposerInput ─────
console.log("\nvalidateComposerInput:");

test("blank name → name error (mirrors API's persona-shape error pattern)", () => {
  const errs = validateComposerInput({ name: "  ", persona: "Victor", steps: [makeDefaultStep(1)] });
  assert(errs.name && errs.name.toLowerCase().includes("name"), "expected name error");
});

test("blank persona → persona error (mirrors API 400 'persona is required')", () => {
  // Mirrors src/app/api/campaigns/[id]/sequences/route.ts:81-86 which 400s on missing persona.
  const errs = validateComposerInput({ name: "x", persona: "", steps: [makeDefaultStep(1)] });
  assert(errs.persona && errs.persona.toLowerCase().includes("persona"), "expected persona error");
});

test("zero steps → steps error", () => {
  const errs = validateComposerInput({ name: "x", persona: "x", steps: [] });
  assert(errs.steps, "expected steps error");
});

test("valid input → no errors", () => {
  const errs = validateComposerInput({ name: "x", persona: "Victor", steps: [makeDefaultStep(1)] });
  assert(!hasErrors(errs), `expected no errors, got ${JSON.stringify(errs)}`);
});

// ───── buildCreatePayload / buildUpdatePayload ─────
console.log("\npayload builders:");

test("create payload pins sequence_type to 'primary' (v1 lock)", () => {
  const payload = buildCreatePayload({ name: "  Test  ", persona: "  Victor  ", steps: [makeDefaultStep(1)] });
  assert(payload.sequence_type === "primary", "sequence_type must be 'primary' for v1 — subsequences are out of scope");
  assert(payload.name === "Test", "name must be trimmed");
  assert(payload.persona === "Victor", "persona must be trimmed");
  assert(payload.steps.length === 1, "steps must be passed through");
});

test("create payload matches the API POST body shape (verbatim API contract)", () => {
  // src/app/api/campaigns/[id]/sequences/route.ts:69-78 destructures:
  //   { name, sequence_type, trigger_event, trigger_condition, trigger_priority, persona, steps }
  // For primary v1 we only send name, sequence_type, persona, steps (trigger_* unused).
  const payload = buildCreatePayload({ name: "x", persona: "y", steps: [makeDefaultStep(1)] });
  const keys = Object.keys(payload).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(["name", "persona", "sequence_type", "steps"]),
    `unexpected payload keys: ${JSON.stringify(keys)}`
  );
});

test("update payload is name+persona+steps (NO sequence_type — PATCH ignores it anyway)", () => {
  // src/app/api/campaigns/[id]/sequences/[seqId]/route.ts:70-72 — PATCH explicitly
  // ignores sequence_type. Sending it is harmless but we keep the body minimal.
  const payload = buildUpdatePayload({ name: "x", persona: "y", steps: [makeDefaultStep(1)] });
  const keys = Object.keys(payload).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(["name", "persona", "steps"]),
    `unexpected update payload keys: ${JSON.stringify(keys)}`
  );
});

// ───── endpointFor / methodFor ─────
console.log("\nrouting helpers:");

test("create routes to POST /api/campaigns/[id]/sequences", () => {
  assert(endpointFor("create", "camp-123") === "/api/campaigns/camp-123/sequences", "create endpoint wrong");
  assert(methodFor("create") === "POST", "create method wrong");
});

test("edit routes to PATCH /api/campaigns/[id]/sequences/[seqId]", () => {
  assert(
    endpointFor("edit", "camp-123", "seq-456") === "/api/campaigns/camp-123/sequences/seq-456",
    "edit endpoint wrong"
  );
  assert(methodFor("edit") === "PATCH", "edit method wrong");
});

test("edit without seqId throws (defensive guard)", () => {
  let threw = false;
  try {
    endpointFor("edit", "camp-123");
  } catch {
    threw = true;
  }
  assert(threw, "edit without seqId must throw");
});

// ───── Source-grep contract on the modal .tsx ─────
console.log("\nsequence-composer-modal.tsx source contract:");

const modalSrc = readFileSync(join(__dirname, "..", "sequence-composer-modal.tsx"), "utf8");

test("modal is a client component", () => {
  assert(/^["']use client["']/m.test(modalSrc), "modal must declare 'use client'");
});

test("modal consumes existing SequenceStepEditor (does NOT rebuild)", () => {
  assert(
    /from\s+["']@\/components\/sequence\/sequence-step-editor["']/.test(modalSrc),
    "modal must import SequenceStepEditor from existing path"
  );
  assert(/<SequenceStepEditor[\s\S]*onChange=\{setSteps\}/.test(modalSrc), "modal must wire onChange to setSteps");
});

test("SequenceStepEditor is rendered WITHOUT readOnly={true} (write mode)", () => {
  // The modal must NOT render the editor read-only — that's the gap we're closing.
  // The existing read-only render path in campaign-detail-client.tsx is preserved separately.
  // Match only the JSX usage (which always starts with `<SequenceStepEditor steps=`),
  // not free-form `<SequenceStepEditor>` mentions in this file's comment header.
  const editorMatch = modalSrc.match(/<SequenceStepEditor\s+steps=[\s\S]*?\/>/);
  assert(editorMatch, "modal must render <SequenceStepEditor steps={…}>");
  assert(!/readOnly\s*=\s*\{\s*true\s*\}/.test(editorMatch![0]), "modal JSX must NOT pass readOnly={true} — write mode is the whole point");
});

test("modal POSTs to /api/campaigns/[id]/sequences via helper", () => {
  // Indirect: the modal calls endpointFor + methodFor from the helper module,
  // which the helper unit tests above already verify route correctly.
  assert(
    /from\s+["']\.\/sequence-composer-helpers["']/.test(modalSrc),
    "modal must import its helpers (route + payload builders are tested separately)"
  );
  assert(/endpointFor\(\s*mode\s*,\s*campaignId/.test(modalSrc), "modal must call endpointFor with mode + campaignId");
  assert(/methodFor\(\s*mode\s*\)/.test(modalSrc), "modal must call methodFor with mode");
});

test("modal surfaces persona-required API 400 inline", () => {
  // The modal extracts json.error and shows it via apiError state — the API
  // returns { error: 'persona is required' } per route.ts:81-86.
  assert(/json\?\.error/.test(modalSrc) || /json\.error/.test(modalSrc), "modal must read json.error from failed response");
  assert(/setApiError/.test(modalSrc), "modal must surface error via setApiError state");
});

test("modal calls router.refresh() on success (matches create-campaign-modal.tsx pattern)", () => {
  assert(/router\.refresh\(\)/.test(modalSrc), "modal must call router.refresh() so server-component data re-fetches");
});

test("modal resets form state when (re)opened (useEffect on [open, mode, existingSequence])", () => {
  // Without this, opening Edit on sequence A then closing and opening Edit on
  // sequence B would show A's data. The useEffect resets on prop change.
  assert(/useEffect/.test(modalSrc), "modal must use useEffect for prop-change resets");
  assert(/\[open\s*,\s*mode\s*,\s*existingSequence\]/.test(modalSrc), "useEffect deps must include all reset triggers");
});

// ───── Source-grep contract on the detail page wiring ─────
console.log("\ncampaign-detail-client.tsx wiring contract:");

const detailSrc = readFileSync(
  join(__dirname, "..", "..", "..", "app", "dashboard", "campaigns", "[id]", "campaign-detail-client.tsx"),
  "utf8"
);

test("detail page imports the modal", () => {
  assert(
    /from\s+["']@\/components\/modals\/sequence-composer-modal["']/.test(detailSrc),
    "detail page must import SequenceComposerModal"
  );
});

test("dead 'Create Sequence' button now has an onClick", () => {
  // Pre-fix line was: <button className="mt-4 px-4 py-2 ...">Create Sequence</button>
  // Post-fix must include an onClick that opens the composer in create mode.
  const emptyStateBlock = detailSrc.match(/No sequences created yet[\s\S]{0,400}Create Sequence/);
  assert(emptyStateBlock, "expected to find the 'Create Sequence' empty-state block");
  assert(
    /onClick=\{[^}]*setComposerState\(\{[^}]*open:\s*true[^}]*mode:\s*["']create["']/.test(emptyStateBlock![0]),
    "Create Sequence button must wire onClick → setComposerState({open:true, mode:'create'})"
  );
});

test("primary sequence card has an Edit affordance opening the composer in edit mode", () => {
  assert(
    /Edit primary sequence/.test(detailSrc) || /aria-label="Edit primary sequence"/.test(detailSrc),
    "primary card must expose an Edit button (aria-label preferred)"
  );
  assert(
    /mode:\s*["']edit["'],\s*seq:\s*primarySequence/.test(detailSrc),
    "Edit button must pass mode:'edit' + seq:primarySequence to composer"
  );
});

test("modal is rendered once at end of component with composerState bound", () => {
  assert(
    /<SequenceComposerModal[\s\S]*open=\{composerState\.open\}/.test(detailSrc),
    "<SequenceComposerModal> must be mounted with open bound to composerState"
  );
  assert(
    /campaignId=\{campaign\.id\}/.test(detailSrc),
    "modal must receive campaignId from the campaign prop"
  );
});

test("existing read-only <SequenceStepEditor> render path is preserved", () => {
  // Per V8 NO-GO: do NOT remove the read-only display path. Dean's existing
  // sequence list view depends on it.
  assert(
    /steps=\{primarySequence\.steps\}[\s\S]{0,200}readOnly=\{true\}/.test(detailSrc) ||
      /readOnly=\{true\}/.test(detailSrc),
    "read-only SequenceStepEditor render must still exist in detail page"
  );
});

// ───── Summary ─────
console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All sequence-composer tests passed.\n");
