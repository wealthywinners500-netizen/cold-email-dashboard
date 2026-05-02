/**
 * CampaignDetailClient — source-grep contract tests.
 *
 * CC #UI-3 (2026-05-02): asserts the campaign detail page wires Start /
 * Pause / Resume / Edit Schedule / Add Leads (recipients upload) buttons.
 *
 * CC #UI-3-rev (2026-05-02): asserts the 4-tab → 5-tab Instantly layout
 * refactor (Analytics / Leads / Sequences / Schedule / Options), the removal
 * of the in-tab Subsequences section (moved to Follow-Ups page in CC #UI-4),
 * the Tags input wiring, and the URL-param tab persistence.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(
  join(__dirname, "..", "campaign-detail-client.tsx"),
  "utf-8"
);
const layoutSrc = readFileSync(
  join(__dirname, "..", "..", "..", "layout.tsx"),
  "utf-8"
);
const migrationsDir = join(__dirname, "..", "..", "..", "..", "..", "..", "supabase", "migrations");
const tagsMig = readFileSync(join(migrationsDir, "025_add_campaigns_tags.sql"), "utf-8");
const acctMig = readFileSync(
  join(migrationsDir, "026_add_campaigns_assigned_account_id.sql"),
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

console.log("CampaignDetailClient source-grep contract (CC #UI-3 + #UI-3-rev):");

// --- CC #UI-3 baseline (carried forward) ---

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

test("renders + Add Leads button (renamed from Recipients in CC #UI-3-rev)", () => {
  if (!/\+ Add Leads/.test(clientSrc)) {
    throw new Error("expected '+ Add Leads' button text");
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

// --- CC #UI-3-rev: 5-tab Instantly layout ---

test("[#UI-3-rev] tab triggers exactly: analytics, leads, sequences, schedule, options", () => {
  for (const v of ["analytics", "leads", "sequences", "schedule", "options"]) {
    const re = new RegExp(`<Tabs\\.Trigger[^>]*value="${v}"`);
    if (!re.test(clientSrc)) throw new Error(`missing Tabs.Trigger value="${v}"`);
  }
});

test("[#UI-3-rev] old tab triggers removed: overview, recipients", () => {
  if (/<Tabs\.Trigger[^>]*value="overview"/.test(clientSrc)) {
    throw new Error("expected 'overview' tab trigger to be removed");
  }
  if (/<Tabs\.Trigger[^>]*value="recipients"/.test(clientSrc)) {
    throw new Error("expected 'recipients' tab trigger to be removed (renamed to 'leads')");
  }
});

test("[#UI-3-rev] tab labels visible: Analytics / Leads / Sequences / Schedule / Options", () => {
  for (const label of ["Analytics", "Leads", "Sequences", "Schedule", "Options"]) {
    if (!new RegExp(`>\\s*${label}\\s*<`).test(clientSrc)) {
      throw new Error(`missing tab label "${label}"`);
    }
  }
});

test("[#UI-3-rev] default tab is 'analytics'", () => {
  // Match either ternary fallback or explicit return: `: "analytics"` or `return "analytics"`
  if (!/(?::|return)\s*"analytics"/.test(clientSrc)) {
    throw new Error("expected default tab fallback to be 'analytics'");
  }
});

test("[#UI-3-rev] URL ?tab= persistence wired", () => {
  if (!/useSearchParams/.test(clientSrc)) {
    throw new Error("expected useSearchParams import for URL sync");
  }
  if (!/window\.history\.replaceState/.test(clientSrc)) {
    throw new Error("expected window.history.replaceState for tab persistence");
  }
});

test("[#UI-3-rev] Subsequences section removed from Sequences tab", () => {
  // The h3 heading "Subsequences" must not exist anymore
  if (/<h3[^>]*>\s*Subsequences\s*</.test(clientSrc)) {
    throw new Error("expected the in-page <h3>Subsequences</h3> heading to be removed");
  }
  // The "+ New Subsequence" button (only PR #49 added this) must be gone
  if (/\+ New Subsequence/.test(clientSrc)) {
    throw new Error("expected '+ New Subsequence' button to be removed");
  }
  // The subsequences filter (const subsequences = sequences.filter(...)) must be gone
  if (/const\s+subsequences\s*=\s*sequences\.filter/.test(clientSrc)) {
    throw new Error("expected `const subsequences = sequences.filter(...)` to be removed");
  }
});

test("[#UI-3-rev] SubsequenceTriggerEditor NOT imported in this file", () => {
  if (/SubsequenceTriggerEditor/.test(clientSrc)) {
    throw new Error("SubsequenceTriggerEditor must not be referenced; lives only in sequence-composer-modal");
  }
});

test("[#UI-3-rev] Tags input renders in Options tab + PATCHes /api/campaigns/[id] with tags array", () => {
  if (!/Tags<\/CardTitle>/.test(clientSrc)) {
    throw new Error("expected Tags <CardTitle> in Options tab");
  }
  if (!/aria-label="Campaign tags"/.test(clientSrc)) {
    throw new Error("expected tags input aria-label");
  }
  if (!/saveTags/.test(clientSrc)) {
    throw new Error("expected saveTags handler");
  }
  if (!/JSON\.stringify\(\{\s*tags:\s*newTags\s*\}\)/.test(clientSrc)) {
    throw new Error("expected PATCH body { tags: newTags }");
  }
});

test("[#UI-3-rev] Start/Pause/Resume relocated to Options tab (Campaign Controls card)", () => {
  if (!/Campaign Controls<\/CardTitle>/.test(clientSrc)) {
    throw new Error("expected 'Campaign Controls' CardTitle in Options tab");
  }
});

// --- CC #UI-3-rev: Sidebar reorder (layout.tsx) ---

test("[#UI-3-rev] sidebar nav: Leads appears BEFORE Campaigns", () => {
  const leadsIdx = layoutSrc.indexOf('label: "Leads"');
  const campIdx = layoutSrc.indexOf('label: "Campaigns"');
  if (leadsIdx < 0) throw new Error("missing Leads nav item");
  if (campIdx < 0) throw new Error("missing Campaigns nav item");
  if (leadsIdx > campIdx) {
    throw new Error("expected Leads to appear before Campaigns in navigationItems");
  }
});

// --- CC #UI-3-rev: Migrations ---

test("[#UI-3-rev] migration 025 adds campaigns.tags TEXT[] idempotently", () => {
  if (!/ADD COLUMN IF NOT EXISTS\s+tags/i.test(tagsMig)) {
    throw new Error("expected idempotent ADD COLUMN IF NOT EXISTS tags");
  }
  if (!/TEXT\[\]/i.test(tagsMig)) {
    throw new Error("expected TEXT[] type for tags column");
  }
  if (!/CREATE INDEX IF NOT EXISTS\s+idx_campaigns_tags/i.test(tagsMig)) {
    throw new Error("expected idempotent GIN index on tags");
  }
});

test("[#UI-3-rev] migration 026 adds campaigns.assigned_account_id UUID FK idempotently", () => {
  if (!/ADD COLUMN IF NOT EXISTS\s+assigned_account_id/i.test(acctMig)) {
    throw new Error("expected idempotent ADD COLUMN IF NOT EXISTS assigned_account_id");
  }
  if (!/UUID\s+REFERENCES\s+email_accounts\(id\)\s+ON DELETE\s+SET NULL/i.test(acctMig)) {
    throw new Error("expected UUID REFERENCES email_accounts(id) ON DELETE SET NULL");
  }
});

console.log(`\n${tests - failed}/${tests} passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
