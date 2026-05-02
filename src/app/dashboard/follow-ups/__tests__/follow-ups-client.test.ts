/**
 * FollowUpsClient — source-grep contract tests.
 *
 * CC #UI-4 (2026-05-02): asserts the new "Subsequences" 4th tab exposes
 * org-wide subsequence CRUD, reusing <SequenceComposerModal> with
 * campaignId={null} + campaigns prop, and Edit/Delete actions per row.
 *
 * Pattern matches CC #UI-3.5 / CC #UI-2: source-grep against the .tsx file
 * (no jest/vitest, no React Testing Library) so the tsx runner stays clean.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(
  join(__dirname, "..", "follow-ups-client.tsx"),
  "utf-8"
);
const pageSrc = readFileSync(
  join(__dirname, "..", "page.tsx"),
  "utf-8"
);

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
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

console.log("FollowUpsClient source-grep contract (CC #UI-4):");

test("4-column tab list (was 3)", () => {
  if (!/grid w-full grid-cols-4/.test(clientSrc)) {
    throw new Error("expected `grid-cols-4` to replace previous `grid-cols-3`");
  }
});

test("Subsequences TabsTrigger present", () => {
  if (!/<TabsTrigger\s+value="subsequences"/.test(clientSrc)) {
    throw new Error('expected <TabsTrigger value="subsequences">');
  }
});

test("Subsequences TabsContent panel present", () => {
  if (!/<TabsContent\s+value="subsequences"/.test(clientSrc)) {
    throw new Error('expected <TabsContent value="subsequences">');
  }
});

test('"+ New Subsequence" button label rendered', () => {
  if (!/New Subsequence/.test(clientSrc)) {
    throw new Error("expected 'New Subsequence' button label");
  }
});

test("imports SequenceComposerModal", () => {
  if (
    !/import\s+SequenceComposerModal\s+from\s+"@\/components\/modals\/sequence-composer-modal"/.test(
      clientSrc
    )
  ) {
    throw new Error("expected SequenceComposerModal default import");
  }
});

test("renders SequenceComposerModal with campaignId={null} + sequenceType=subsequence", () => {
  if (!/campaignId=\{null\}/.test(clientSrc)) {
    throw new Error("expected campaignId={null} on the composer mount");
  }
  if (!/sequenceType="subsequence"/.test(clientSrc)) {
    throw new Error('expected sequenceType="subsequence"');
  }
});

test("passes campaigns prop into SequenceComposerModal", () => {
  if (!/campaigns=\{campaigns\}/.test(clientSrc)) {
    throw new Error("expected campaigns={campaigns} on the composer mount");
  }
});

test("DELETE handler hits /api/campaigns/[id]/sequences/[seqId]", () => {
  // Fetch URL must include both campaign_id + sequence id segments.
  if (
    !/fetch\(\s*`\/api\/campaigns\/\$\{[^}]+\.campaign_id\}\/sequences\/\$\{[^}]+\.id\}`/.test(
      clientSrc
    )
  ) {
    throw new Error("expected DELETE fetch URL to template campaign_id + id");
  }
  if (!/method:\s*"DELETE"/.test(clientSrc)) {
    throw new Error('expected method: "DELETE"');
  }
});

test("Edit button sets editingSubseq state", () => {
  if (!/setEditingSubseq\(/.test(clientSrc)) {
    throw new Error("expected setEditingSubseq(...) handler");
  }
});

test("subsequences list maps over subsequences prop", () => {
  if (!/subsequences\.map\(\(row\)\s*=>/.test(clientSrc)) {
    throw new Error("expected subsequences.map((row) => ...)");
  }
});

test("trigger label helper exists for human-friendly display", () => {
  if (!/function formatTriggerLabel/.test(clientSrc)) {
    throw new Error("expected formatTriggerLabel function");
  }
});

test("Edit button has aria-label for a11y", () => {
  if (!/aria-label="Edit subsequence"/.test(clientSrc)) {
    throw new Error('expected aria-label="Edit subsequence"');
  }
});

test("Delete button has aria-label for a11y", () => {
  if (!/aria-label="Delete subsequence"/.test(clientSrc)) {
    throw new Error('expected aria-label="Delete subsequence"');
  }
});

test("count badge in tab trigger uses subsequences.length", () => {
  if (!/Subsequences \(\{subsequences\.length\}\)/.test(clientSrc)) {
    throw new Error("expected `Subsequences ({subsequences.length})`");
  }
});

test("page.tsx fetches subsequences via getOrgSubsequences", () => {
  if (!/getOrgSubsequences/.test(pageSrc)) {
    throw new Error("expected page.tsx to call getOrgSubsequences");
  }
});

test("page.tsx fetches campaigns via getCampaigns", () => {
  if (!/getCampaigns/.test(pageSrc)) {
    throw new Error("expected page.tsx to call getCampaigns");
  }
});

test("page.tsx passes subsequences + campaigns props to client", () => {
  if (!/subsequences=\{subsequences\}/.test(pageSrc)) {
    throw new Error("expected subsequences={subsequences} prop forward");
  }
  if (!/campaigns=\{campaigns\}/.test(pageSrc)) {
    throw new Error("expected campaigns={campaigns} prop forward");
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All FollowUpsClient (CC #UI-4) tests passed.\n");
