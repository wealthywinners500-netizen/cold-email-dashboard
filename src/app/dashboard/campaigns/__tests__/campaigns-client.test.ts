/**
 * CampaignsClient — source-grep contract tests.
 *
 * CC #UI-3.5 (2026-05-02): asserts the campaigns LIST page wires row clicks
 * to navigate to /dashboard/campaigns/[id] (5-tab detail page shipped by
 * CC #UI-3 + #UI-3-rev) while preserving the rename-only edit modal via an
 * explicit Pencil-icon button with e.stopPropagation().
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(
  join(__dirname, "..", "campaigns-client.tsx"),
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

console.log("CampaignsClient source-grep contract (CC #UI-3.5):");

test("imports useRouter from next/navigation", () => {
  if (!/import\s+\{\s*useRouter\s*\}\s+from\s+"next\/navigation"/.test(clientSrc)) {
    throw new Error("expected `import { useRouter } from \"next/navigation\"`");
  }
});

test("calls useRouter() inside the component", () => {
  if (!/const\s+router\s*=\s*useRouter\(\)/.test(clientSrc)) {
    throw new Error("expected `const router = useRouter()` hook call");
  }
});

test("row onClick navigates to /dashboard/campaigns/[id]", () => {
  if (!/router\.push\(`\/dashboard\/campaigns\/\$\{campaign\.id\}`\)/.test(clientSrc)) {
    throw new Error("expected router.push(`/dashboard/campaigns/${campaign.id}`)");
  }
});

test("imports Pencil from lucide-react", () => {
  if (!/import\s+\{[^}]*\bPencil\b[^}]*\}\s+from\s+"lucide-react"/.test(clientSrc)) {
    throw new Error("expected Pencil to be imported from lucide-react");
  }
});

test("edit button preserves modal trigger (setEditingCampaign + setModalOpen)", () => {
  if (!/setEditingCampaign\(campaign\)/.test(clientSrc)) {
    throw new Error("expected setEditingCampaign(campaign) on the explicit Edit button");
  }
  if (!/setModalOpen\(true\)/.test(clientSrc)) {
    throw new Error("expected setModalOpen(true) on the explicit Edit button");
  }
});

test("edit button calls e.stopPropagation() so it does not trigger row nav", () => {
  if (!/e\.stopPropagation\(\)/.test(clientSrc)) {
    throw new Error("expected e.stopPropagation() on the Pencil edit button");
  }
});

test("edit button has a11y attributes (aria-label)", () => {
  if (!/aria-label="Edit campaign"/.test(clientSrc)) {
    throw new Error("expected aria-label=\"Edit campaign\" on the Pencil button");
  }
});

test("row-level onClick no longer opens the modal directly (regression guard)", () => {
  // The row's onClick must reference router.push, NOT setEditingCampaign + setModalOpen.
  // Find the <tr ... key={campaign.id} onClick={...}> block and verify its handler shape.
  const rowMatch = clientSrc.match(
    /<tr\s+key=\{campaign\.id\}\s+onClick=\{\(\)\s*=>\s*\{([\s\S]*?)\}\}/
  );
  if (!rowMatch) {
    throw new Error("could not locate the <tr key={campaign.id} onClick={...}> block");
  }
  const handlerBody = rowMatch[1];
  if (!/router\.push/.test(handlerBody)) {
    throw new Error("row onClick handler must call router.push (navigation, not modal)");
  }
  if (/setEditingCampaign/.test(handlerBody) || /setModalOpen/.test(handlerBody)) {
    throw new Error(
      "row onClick handler must NOT call setEditingCampaign/setModalOpen — that belongs on the Pencil button"
    );
  }
});

console.log(`\n${tests - failed}/${tests} passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
