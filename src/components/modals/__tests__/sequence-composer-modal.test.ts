/**
 * SequenceComposerModal — source-grep contract for the CC #UI-4 changes.
 *
 * CC #UI-4 (2026-05-02): asserts campaignId is now `string | null`, the
 * modal renders <CampaignPicker> when invoked from the org-wide flow, the
 * picker is locked in edit mode, and submission rejects null pickedCampaignId
 * before the network call.
 *
 * The functional helpers are still covered by sequence-composer-helpers.test.ts.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(
  join(__dirname, "..", "sequence-composer-modal.tsx"),
  "utf-8"
);
const pickerSrc = readFileSync(
  join(__dirname, "..", "..", "sequence", "campaign-picker.tsx"),
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

console.log("SequenceComposerModal CC #UI-4 contract:");

test("imports CampaignPicker from @/components/sequence/campaign-picker", () => {
  if (
    !/import\s+\{\s*CampaignPicker\s*\}\s+from\s+"@\/components\/sequence\/campaign-picker"/.test(
      modalSrc
    )
  ) {
    throw new Error("expected named import of CampaignPicker");
  }
});

test("campaignId prop typed as string | null", () => {
  if (!/campaignId:\s*string\s*\|\s*null/.test(modalSrc)) {
    throw new Error("expected campaignId: string | null");
  }
});

test("accepts optional campaigns prop for the picker", () => {
  if (!/campaigns\?:\s*CampaignOption\[\]/.test(modalSrc)) {
    throw new Error("expected campaigns?: CampaignOption[]");
  }
});

test("renders <CampaignPicker> only when campaignId === null && isSubsequence", () => {
  if (
    !/isSubsequence\s*&&\s*campaignId\s*===\s*null\s*&&\s*campaigns\s*&&\s*\(\s*<CampaignPicker/.test(
      modalSrc
    )
  ) {
    throw new Error(
      "expected `isSubsequence && campaignId === null && campaigns && (<CampaignPicker ...>)`"
    );
  }
});

test("CampaignPicker is disabled when mode === 'edit'", () => {
  if (!/disabled=\{mode\s*===\s*"edit"\}/.test(modalSrc)) {
    throw new Error('expected disabled={mode === "edit"} on CampaignPicker');
  }
});

test("pickedCampaignId state initializes from existingSequence.campaign_id ?? campaignId", () => {
  if (
    !/useState<string\s*\|\s*null>\(\s*existingSequence\?\.campaign_id\s*\?\?\s*campaignId\s*\?\?\s*null\s*\)/.test(
      modalSrc
    )
  ) {
    throw new Error("expected pickedCampaignId initial state from existingSequence ?? prop");
  }
});

test("submit rejects when pickedCampaignId is null", () => {
  if (!/if\s*\(\s*!submitCampaignId\s*\)/.test(modalSrc)) {
    throw new Error("expected `if (!submitCampaignId)` guard before submit");
  }
  if (!/Please pick a campaign/.test(modalSrc)) {
    throw new Error("expected user-facing 'Please pick a campaign' error");
  }
});

test("endpointFor receives submitCampaignId (not raw campaignId)", () => {
  if (!/endpointFor\(mode,\s*submitCampaignId/.test(modalSrc)) {
    throw new Error("expected endpointFor(mode, submitCampaignId, ...)");
  }
});

test("CampaignPicker component exposes value/onChange/campaigns/disabled props", () => {
  if (!/value:\s*string\s*\|\s*null/.test(pickerSrc)) {
    throw new Error("expected value: string | null on CampaignPicker");
  }
  if (!/onChange:\s*\(campaignId:\s*string\)\s*=>\s*void/.test(pickerSrc)) {
    throw new Error("expected onChange: (campaignId: string) => void");
  }
  if (!/disabled\?:\s*boolean/.test(pickerSrc)) {
    throw new Error("expected disabled?: boolean");
  }
  if (!/campaigns:\s*Campaign\[\]/.test(pickerSrc)) {
    throw new Error("expected campaigns: Campaign[]");
  }
});

test("CampaignPicker filters out archived campaigns", () => {
  if (!/c\.status\s*!==\s*"archived"/.test(pickerSrc)) {
    throw new Error('expected filter `c.status !== "archived"`');
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All SequenceComposerModal (CC #UI-4) tests passed.\n");
