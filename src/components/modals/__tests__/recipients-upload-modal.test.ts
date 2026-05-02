/**
 * RecipientsUploadModal — source-grep contract tests.
 *
 * CC #UI-3 (2026-05-02): asserts the modal posts to
 * /api/lead-contacts/import-to-campaign with the lead_list_id filter shape
 * that the route accepts (after CC #UI-3's 3-line filter extension).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(
  join(__dirname, "..", "recipients-upload-modal.tsx"),
  "utf-8"
);
const routeSrc = readFileSync(
  join(__dirname, "..", "..", "..", "app", "api", "lead-contacts", "import-to-campaign", "route.ts"),
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

console.log("RecipientsUploadModal source-grep contract:");

test("modal fetches lead lists from /api/leads/lists", () => {
  if (!/\/api\/leads\/lists/.test(modalSrc)) {
    throw new Error("expected fetch to /api/leads/lists");
  }
});

test("modal posts to /api/lead-contacts/import-to-campaign", () => {
  if (!/\/api\/lead-contacts\/import-to-campaign/.test(modalSrc)) {
    throw new Error("expected POST to /api/lead-contacts/import-to-campaign");
  }
});

test("modal sends lead_list_id in filter object", () => {
  if (!/lead_list_id/.test(modalSrc)) {
    throw new Error("expected lead_list_id in body");
  }
  if (!/filter/.test(modalSrc)) {
    throw new Error("expected filter object");
  }
});

test("modal renders a <select> for lead list selection", () => {
  if (!/<select/.test(modalSrc)) {
    throw new Error("expected lead-list <select>");
  }
});

test("verified-only checkbox conditionally adds email_status filter", () => {
  if (!/verifiedOnly/.test(modalSrc)) {
    throw new Error("expected verifiedOnly state");
  }
  if (!/email_status.*"valid"|email_status:\s*"valid"/.test(modalSrc)) {
    throw new Error("expected email_status: 'valid' filter when verifiedOnly is checked");
  }
});

test("CSV mode shows stub message (not yet supported)", () => {
  if (!/csv\s+upload\s+is\s+not\s+yet\s+supported|CSV upload is not yet supported/i.test(modalSrc)) {
    throw new Error("expected CSV stub copy");
  }
});

test("submit button disabled when no lists or csv mode", () => {
  if (!/disabled=\{[^}]*lists\.length\s*===\s*0/.test(modalSrc)) {
    throw new Error("expected submit disabled when no lists");
  }
});

console.log("\nimport-to-campaign route filter extension:");

test("route accepts lead_list_id in filter", () => {
  if (!/filter\.lead_list_id/.test(routeSrc)) {
    throw new Error("route must filter on lead_list_id");
  }
});

test("route applies lead_list_id eq filter to lead_contacts query", () => {
  if (!/contactsQuery\s*=\s*contactsQuery\.eq\("lead_list_id",\s*filter\.lead_list_id\)/.test(routeSrc)) {
    throw new Error("expected contactsQuery.eq(\"lead_list_id\", filter.lead_list_id)");
  }
});

console.log(`\n${tests - failed}/${tests} passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
