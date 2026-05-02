/**
 * SequenceComposerModal — helper unit tests + source-grep contract checks.
 *
 * V8 Phase 2 (2026-04-30 sequences-composer): the codebase has no jest/vitest
 * and no React Testing Library; UI tests follow the pattern set by
 * pair-detail-client.test.ts — pure helpers run as plain `tsx` scripts, plus
 * a source-grep of the .tsx file to assert the contract (fetch URLs, body
 * shape, persona validation, etc.) without importing browser-only modules.
 *
 * CC #UI-2 (2026-05-02): extended with subsequence-shape assertions covering
 * the new sequenceType prop / triggerConfig threading. Existing primary tests
 * stay GREEN via default-arg backward compat.
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
  normalizeTriggerEvent,
  type SubsequenceTriggerConfig,
  type CreateSubsequencePayload,
  type UpdateSubsequencePayload,
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

test("create payload defaults to 'primary' (backward-compat, no second arg)", () => {
  const payload = buildCreatePayload({ name: "  Test  ", persona: "  Victor  ", steps: [makeDefaultStep(1)] });
  assert(payload.sequence_type === "primary", "default sequenceType must be 'primary' for backward compat");
  assert(payload.name === "Test", "name must be trimmed");
  assert(payload.persona === "Victor", "persona must be trimmed");
  assert(payload.steps.length === 1, "steps must be passed through");
});

test("create payload (primary) matches the API POST body shape (verbatim API contract)", () => {
  // src/app/api/campaigns/[id]/sequences/route.ts:69-78 destructures:
  //   { name, sequence_type, trigger_event, trigger_condition, trigger_priority, persona, steps }
  // For primary we only send name, sequence_type, persona, steps (trigger_* unused).
  const payload = buildCreatePayload({ name: "x", persona: "y", steps: [makeDefaultStep(1)] });
  const keys = Object.keys(payload).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(["name", "persona", "sequence_type", "steps"]),
    `unexpected primary payload keys: ${JSON.stringify(keys)}`
  );
});

test("update payload (primary) is name+persona+steps (NO sequence_type — PATCH ignores it anyway)", () => {
  // src/app/api/campaigns/[id]/sequences/[seqId]/route.ts:70-72 — PATCH explicitly
  // ignores sequence_type. Sending it is harmless but we keep the body minimal.
  const payload = buildUpdatePayload({ name: "x", persona: "y", steps: [makeDefaultStep(1)] });
  const keys = Object.keys(payload).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(["name", "persona", "steps"]),
    `unexpected primary update payload keys: ${JSON.stringify(keys)}`
  );
});

// ───── CC #UI-2: subsequence helpers ─────
console.log("\nsubsequence (CC #UI-2):");

const sampleTrigger: SubsequenceTriggerConfig = {
  trigger_event: "Reply Classified",
  trigger_condition: { classification: "INTERESTED" },
  trigger_priority: 1,
  persona: "Decision Maker",
};

test("normalizeTriggerEvent maps display strings → DB-canonical snake_case", () => {
  assert(normalizeTriggerEvent("Reply Classified") === "reply_classified", "Reply Classified must map to reply_classified");
  assert(normalizeTriggerEvent("No Reply") === "no_reply", "No Reply must map to no_reply");
  assert(normalizeTriggerEvent("Opened") === "opened", "Opened must map to opened");
  assert(normalizeTriggerEvent("Clicked") === "clicked", "Clicked must map to clicked");
});

test("buildCreatePayload(input, 'subsequence', triggerConfig) returns sequence_type:'subsequence' with all 4 trigger fields canonicalized", () => {
  const payload = buildCreatePayload(
    { name: "INTERESTED follow-up", persona: "ignored", steps: [makeDefaultStep(1)] },
    "subsequence",
    sampleTrigger
  ) as CreateSubsequencePayload;
  assert(payload.sequence_type === "subsequence", "sequence_type must be 'subsequence'");
  assert(payload.trigger_event === "reply_classified", "trigger_event must be canonicalized (Reply Classified → reply_classified)");
  assert(JSON.stringify(payload.trigger_condition) === JSON.stringify({ classification: "INTERESTED" }), "trigger_condition must round-trip");
  assert(payload.trigger_priority === 1, "trigger_priority must round-trip");
  assert(payload.persona === "Decision Maker", "persona must come from triggerConfig (not input.persona) for subsequence");
});

test("buildCreatePayload(subsequence) without triggerConfig throws (defensive guard)", () => {
  let threw = false;
  try {
    buildCreatePayload({ name: "x", persona: "x", steps: [makeDefaultStep(1)] }, "subsequence");
  } catch {
    threw = true;
  }
  assert(threw, "missing triggerConfig in subsequence mode must throw");
});

test("buildUpdatePayload(subsequence, triggerConfig) includes the 3 trigger fields", () => {
  const payload = buildUpdatePayload(
    { name: "renamed", persona: "ignored", steps: [makeDefaultStep(1)] },
    "subsequence",
    sampleTrigger
  ) as UpdateSubsequencePayload;
  const keys = Object.keys(payload).sort();
  assert(
    JSON.stringify(keys) ===
      JSON.stringify(["name", "persona", "steps", "trigger_condition", "trigger_event", "trigger_priority"]),
    `unexpected subsequence update payload keys: ${JSON.stringify(keys)}`
  );
  assert(payload.trigger_event === "reply_classified", "update payload must canonicalize trigger_event");
});

test("validateComposerInput(subsequence) — happy path, plus 4 distinct field-level error scenarios", () => {
  const baseInput = { name: "x", persona: "", steps: [makeDefaultStep(1)] };
  // Happy path: Reply Classified + classification + persona + priority>=1 → no errors
  assert(!hasErrors(validateComposerInput(baseInput, "subsequence", sampleTrigger)), "expected happy path to be error-free");
  // null triggerConfig → trigger_event error
  assert(validateComposerInput(baseInput, "subsequence", null).trigger_event, "null triggerConfig must error");
  // No Reply + days=0 → trigger_condition error; days=3 → no error
  assert(
    validateComposerInput(baseInput, "subsequence", { trigger_event: "No Reply", trigger_condition: { days: 0 }, trigger_priority: 1, persona: "p" }).trigger_condition,
    "No Reply with days=0 must error"
  );
  assert(
    !hasErrors(validateComposerInput(baseInput, "subsequence", { trigger_event: "No Reply", trigger_condition: { days: 3 }, trigger_priority: 1, persona: "p" })),
    "No Reply with days=3 must be error-free"
  );
  // priority < 1 → trigger_priority error
  assert(validateComposerInput(baseInput, "subsequence", { ...sampleTrigger, trigger_priority: 0 }).trigger_priority, "priority<1 must error");
  // empty triggerConfig.persona → persona error
  assert(validateComposerInput(baseInput, "subsequence", { ...sampleTrigger, persona: "" }).persona, "empty subsequence persona must error");
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

test("modal imports SubsequenceTriggerEditor (CC #UI-2 wire-up — was dead code prior)", () => {
  assert(
    /from\s+["']@\/components\/sequence\/subsequence-trigger-editor["']/.test(modalSrc),
    "modal must import SubsequenceTriggerEditor"
  );
});

test("modal renders <SubsequenceTriggerEditor> JSX (gated on sequenceType)", () => {
  // The JSX site is under `isSubsequence &&` block — match the JSX usage itself.
  assert(/<SubsequenceTriggerEditor[\s\S]*?onChange=\{[\s\S]*?\}/.test(modalSrc), "modal must render <SubsequenceTriggerEditor> with onChange");
});

test("modal title branches between Primary and Subsequence", () => {
  assert(/New Subsequence/.test(modalSrc), "modal must contain 'New Subsequence' title text");
  assert(/Edit Subsequence/.test(modalSrc), "modal must contain 'Edit Subsequence' title text");
  assert(/New Primary Sequence/.test(modalSrc), "modal must STILL contain 'New Primary Sequence' (regression)");
});

test("modal accepts sequenceType prop", () => {
  assert(/sequenceType\??:\s*SequenceType/.test(modalSrc), "modal props must include sequenceType: SequenceType");
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
  // CC #UI-4 (2026-05-02): modal now resolves a `submitCampaignId` from
  // pickedCampaignId (which falls back to the prop) before calling
  // endpointFor — the prop alias rename keeps the contract intact.
  assert(
    /endpointFor\(\s*mode\s*,\s*(submitCampaignId|campaignId)/.test(modalSrc),
    "modal must call endpointFor with mode + (submitCampaignId|campaignId)"
  );
  assert(/methodFor\(\s*mode\s*\)/.test(modalSrc), "modal must call methodFor with mode");
});

test("modal threads triggerConfig into buildCreatePayload + buildUpdatePayload", () => {
  // Ensures the new 3-arg helper signature is actually exercised by the modal,
  // not just exported and unreachable.
  assert(/buildCreatePayload\([\s\S]*?triggerConfig/.test(modalSrc), "modal must pass triggerConfig to buildCreatePayload");
  assert(/buildUpdatePayload\([\s\S]*?triggerConfig/.test(modalSrc), "modal must pass triggerConfig to buildUpdatePayload");
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
  // CC #UI-4 (2026-05-02): campaignId added to the deps array so the picker
  // re-prefills when a fresh campaign target is bound (e.g., Edit reopened
  // for a different subsequence).
  assert(
    /\[\s*open\s*,\s*mode\s*,\s*existingSequence(\s*,\s*campaignId)?\s*\]/.test(modalSrc),
    "useEffect deps must include open, mode, existingSequence (and optionally campaignId)"
  );
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

test("empty-state primary sequence button has an onClick (CC #UI-3-rev: text changed to '+ New Primary Sequence')", () => {
  // CC #UI-3-rev moved the empty state's button text from "Create Sequence" to
  // "+ New Primary Sequence" (subsequences no longer rendered in this file).
  const emptyStateBlock = detailSrc.match(/No primary sequence yet[\s\S]{0,500}New Primary Sequence/);
  assert(emptyStateBlock, "expected to find the 'No primary sequence yet' empty-state with '+ New Primary Sequence' button");
  assert(
    /onClick=\{[^}]*setComposerState\(\{[^}]*open:\s*true[^}]*mode:\s*["']create["']/.test(emptyStateBlock![0]),
    "primary-sequence empty-state button must wire onClick → setComposerState({open:true, mode:'create'})"
  );
});

test("primary sequence card has an Edit affordance opening the composer in edit mode", () => {
  // CC #UI-3-rev: composerState no longer carries `sequenceType` (subsequences gone),
  // and the modal receives sequenceType="primary" as a literal at the mount point.
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
  // CC #UI-3-rev: sequenceType is now hard-coded "primary" (subsequences moved
  // to /dashboard/follow-ups in CC #UI-4) — match the literal prop on the mount.
  assert(
    /sequenceType=\{?\s*["']primary["']\s*\}?/.test(detailSrc),
    "<SequenceComposerModal> must receive sequenceType=\"primary\" (hard-coded post CC #UI-3-rev)"
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

// CC #UI-3-rev REMOVED the in-file subsequence section from campaign-detail-client.tsx.
// Subsequences are now managed on /dashboard/follow-ups (CC #UI-4 will rebuild).
// The CC #UI-2 detail-page subsequence assertions have been intentionally deleted —
// the composer-modal subsequence contract above (lines ~163-237, 283-298) still
// covers the helper behavior. The CC #UI-3-rev test file
// (../app/dashboard/campaigns/[id]/__tests__/campaign-detail-client.test.ts)
// asserts the in-file removal directly.

// ───── Summary ─────
console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All sequence-composer tests passed.\n");
