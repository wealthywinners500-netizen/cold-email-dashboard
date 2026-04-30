/**
 * V1+a vocab regression test.
 *
 * Pins the locked classifier vocab split shipped on 2026-04-30:
 *   - INTERESTED redefined: "asks for general info or pricing, but does NOT
 *     ask substantive qualifying questions" (first-touch soft positive).
 *   - HOT_LEAD added: "specific qualifying questions about pricing depth,
 *     contract terms, turnaround time, typical clients, decision-makers, or
 *     next steps" (substantive engagement, ready for human follow-up).
 *
 * If a future edit collapses the split or drops HOT_LEAD, this test goes red
 * before the classifier ships the wrong labels into the dashboard.
 *
 * Pure: no Anthropic, no Supabase, no network. Reads the source file as text
 * and asserts the prompt + type union shape.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const sourcePath = resolve(__dirname, '../reply-classifier.ts');
const source = readFileSync(sourcePath, 'utf-8');

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

console.log('\nReply classifier vocab — V1+a regression\n');

test("Classification union includes 'HOT_LEAD'", () => {
  // Look for the literal string in the union declaration.
  assert(
    /export type Classification[\s\S]*?\|\s*'HOT_LEAD'/.test(source),
    "Classification union should include the 'HOT_LEAD' literal"
  );
});

test("Classification union still includes 'INTERESTED'", () => {
  assert(
    /export type Classification[\s\S]*?\|\s*'INTERESTED'/.test(source),
    "Classification union should still include 'INTERESTED'"
  );
});

test("Classification union still includes 'OBJECTION', 'BOUNCE', 'AUTO_REPLY'", () => {
  for (const label of ['OBJECTION', 'BOUNCE', 'AUTO_REPLY', 'STOP', 'SPAM', 'NOT_INTERESTED']) {
    assert(
      new RegExp(`'${label}'`).test(source),
      `Classification union dropped existing label '${label}'`
    );
  }
});

test("SYSTEM_PROMPT contains the new INTERESTED wording", () => {
  // The new definition must mention "does NOT ask substantive qualifying questions"
  // — the explicit cap that distinguishes INTERESTED from HOT_LEAD.
  assert(
    /INTERESTED:[\s\S]*?does NOT ask substantive qualifying questions/.test(source),
    "INTERESTED definition should disclaim substantive qualifying questions"
  );
  assert(
    /INTERESTED:[\s\S]*?First-touch soft positive/.test(source),
    "INTERESTED definition should call out 'First-touch soft positive'"
  );
});

test("SYSTEM_PROMPT contains the new HOT_LEAD definition", () => {
  // The HOT_LEAD definition must call out the qualifying-question signal +
  // specific examples (pricing depth, contract terms, turnaround time, etc).
  assert(
    /HOT_LEAD:[\s\S]*?specific qualifying questions/.test(source),
    "HOT_LEAD definition should mention 'specific qualifying questions'"
  );
  // Spot-check at least three of the example signals from the locked spec.
  for (const signal of ['pricing depth', 'contract terms', 'turnaround time']) {
    assert(
      new RegExp(`HOT_LEAD:[\\s\\S]*?${signal}`).test(source),
      `HOT_LEAD definition should reference '${signal}'`
    );
  }
});

test("SYSTEM_PROMPT preserves PR #25 fence-strip instruction", () => {
  // PR #25 added the bare-JSON instruction to defeat Haiku-4.5's fence wrapping.
  // V1+a must not regress it.
  assert(
    /Do not wrap in markdown fences/.test(source),
    "Bare-JSON instruction (no markdown fences) was lost"
  );
});

test("classifyReply still strips ```json fences (PR #25 logic)", () => {
  // The parse path must still handle fenced JSON — the model still emits it
  // sometimes despite the prompt instruction.
  assert(
    /fenceMatch[\s\S]*?\^```\(\?:json\)\?/.test(source),
    "Fence-strip regex was lost"
  );
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log('All vocab regression tests passed.\n');
