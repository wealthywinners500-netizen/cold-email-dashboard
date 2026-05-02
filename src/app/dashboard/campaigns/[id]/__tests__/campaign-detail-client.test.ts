/**
 * CampaignDetailClient — source-grep contract tests.
 *
 * CC #UI-3 (2026-05-02): asserts that the campaign detail page renders the
 * Start / Pause / Resume / Edit Schedule / Add Recipients buttons and wires
 * them to the correct API surfaces.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(
  join(__dirname, "..", "campaign-detail-client.tsx"),
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

console.log("CampaignDetailClient source-grep contract:");

test("imports SendScheduleModal", () => {
  if (!/import\s+SendScheduleModal\s+from\s+"@\/components\/modals\/send-schedule-modal"/.test(clientSrc)) {
    throw new Error("expected SendScheduleModal import");
  }
});

test("imports RecipientsUploadModal", () => {
  if (!/import\s+RecipientsUploadModal\s+from\s+"@\/components\/modals\/recipients-upload-modal"/.test(clientSrc)) {
    throw new Error("expected RecipientsUploadModal import");
  }
});

test("renders Start Campaign button", () => {
  if (!/Start Campaign/.test(clientSrc)) {
    throw new Error("expected 'Start Campaign' button text");
  }
});

test("renders Pause and Resume buttons (gated by status)", () => {
  if (!/{canPause\s*&&/.test(clientSrc)) {
    throw new Error("expected canPause-gated Pause button");
  }
  if (!/{canResume\s*&&/.test(clientSrc)) {
    throw new Error("expected canResume-gated Resume button");
  }
});

test("renders Edit Schedule button", () => {
  if (!/Edit Schedule/.test(clientSrc)) {
    throw new Error("expected 'Edit Schedule' button text");
  }
});

test("renders + Add Recipients button", () => {
  if (!/\+ Add Recipients/.test(clientSrc)) {
    throw new Error("expected '+ Add Recipients' button text");
  }
});

test("Start Campaign POSTs to /api/campaigns/[id]/send", () => {
  if (!/\/api\/campaigns\/\$\{campaign\.id\}\/send/.test(clientSrc)) {
    throw new Error("expected POST to /api/campaigns/${campaign.id}/send");
  }
});

test("Pause/Resume PATCH /api/campaigns/[id] with status field", () => {
  if (!/\/api\/campaigns\/\$\{campaign\.id\}/.test(clientSrc)) {
    throw new Error("expected PATCH to /api/campaigns/${campaign.id}");
  }
  if (!/method:\s*"PATCH"/.test(clientSrc)) {
    throw new Error("expected PATCH method");
  }
  if (!/status:\s*newStatus/.test(clientSrc)) {
    throw new Error("expected status field in PATCH body");
  }
});

test("schedule display reads engine shape (send_between_hours, max_per_day)", () => {
  if (!/send_between_hours/.test(clientSrc)) {
    throw new Error("display must read send_between_hours (engine shape)");
  }
  if (!/max_per_day/.test(clientSrc)) {
    throw new Error("display must read max_per_day (engine shape)");
  }
});

test("canStart respects recipient count + primary sequence", () => {
  if (!/total_recipients\s*>\s*0/.test(clientSrc)) {
    throw new Error("canStart must check total_recipients > 0");
  }
  if (!/!!primarySequence/.test(clientSrc)) {
    throw new Error("canStart must check primarySequence presence");
  }
});

test("Start button disabled when canStart is false", () => {
  if (!/disabled=\{!canStart/.test(clientSrc)) {
    throw new Error("Start button must be disabled when !canStart");
  }
});

test("Modals mounted at end of component", () => {
  if (!/<SendScheduleModal/.test(clientSrc)) {
    throw new Error("expected <SendScheduleModal /> mount");
  }
  if (!/<RecipientsUploadModal/.test(clientSrc)) {
    throw new Error("expected <RecipientsUploadModal /> mount");
  }
});

console.log(`\n${tests - failed}/${tests} passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
