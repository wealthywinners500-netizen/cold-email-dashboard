/**
 * /api/follow-ups/subsequences route — source-grep contract.
 *
 * CC #UI-4 (2026-05-02): asserts the new GET endpoint org-scopes the query,
 * filters by sequence_type='subsequence', joins campaigns(name), and 401s
 * when no Clerk org is present.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(
  join(__dirname, "..", "route.ts"),
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

console.log("/api/follow-ups/subsequences route contract (CC #UI-4):");

test("exports GET handler", () => {
  if (!/export\s+async\s+function\s+GET\s*\(/.test(routeSrc)) {
    throw new Error("expected `export async function GET(`");
  }
});

test("queries campaign_sequences table", () => {
  if (!/\.from\("campaign_sequences"\)/.test(routeSrc)) {
    throw new Error('expected .from("campaign_sequences")');
  }
});

test("filters by sequence_type='subsequence'", () => {
  if (!/\.eq\("sequence_type",\s*"subsequence"\)/.test(routeSrc)) {
    throw new Error('expected .eq("sequence_type", "subsequence")');
  }
});

test("scopes by org_id", () => {
  if (!/\.eq\("org_id",\s*orgId\)/.test(routeSrc)) {
    throw new Error('expected .eq("org_id", orgId)');
  }
});

test("joins campaigns(name) for display", () => {
  if (!/campaigns\(name\)/.test(routeSrc)) {
    throw new Error("expected campaigns(name) in the select");
  }
});

test("returns 401 when no orgId", () => {
  if (
    !/Unauthorized/.test(routeSrc) ||
    !/status:\s*401/.test(routeSrc)
  ) {
    throw new Error("expected 401 + 'Unauthorized' for missing orgId");
  }
});

test("uses Clerk auth() to resolve orgId", () => {
  if (!/from\s+"@clerk\/nextjs\/server"/.test(routeSrc)) {
    throw new Error("expected import from @clerk/nextjs/server");
  }
});

test("orders by created_at desc (newest first)", () => {
  if (!/\.order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)/.test(routeSrc)) {
    throw new Error("expected .order(created_at, ascending: false)");
  }
});

console.log(`\n${tests - failed}/${tests} passed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("All /api/follow-ups/subsequences (CC #UI-4) tests passed.\n");
