/**
 * SendScheduleModal — source-grep contract tests.
 *
 * CC #UI-3 (2026-05-02): no jest/vitest harness; pattern matches
 * sequence-composer-helpers.test.ts — read the .tsx source as text and assert
 * field shape + payload contract without rendering React.
 *
 * Engine-shape contract: this modal MUST write `send_between_hours`, `days`,
 * `timezone`, `max_per_day`, `per_account_per_hour` because that's what
 * sequence-engine.ts:693 + campaign-queue.ts:58-63 read. Writing the prompt's
 * `{hours.{start,end}, daily_limit, days_of_week}` shape would silently break
 * throttling.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(
  join(__dirname, "..", "send-schedule-modal.tsx"),
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

console.log("SendScheduleModal source-grep contract:");

test("renders <input type=\"time\"> for start/end hours", () => {
  const matches = modalSrc.match(/<input\s+type="time"/g);
  if (!matches || matches.length < 2) {
    throw new Error(`expected ≥2 time inputs, got ${matches?.length ?? 0}`);
  }
});

test("renders a <select> for timezone", () => {
  if (!/timezone/i.test(modalSrc) || !/<select/.test(modalSrc)) {
    throw new Error("expected a timezone <select> element");
  }
});

test("renders <input type=\"number\"> for max_per_day", () => {
  if (!/<input\s+type="number"/.test(modalSrc)) {
    throw new Error("expected a number input");
  }
  if (!/max_per_day/.test(modalSrc)) {
    throw new Error("expected max_per_day field");
  }
});

test("PATCH submit body uses engine-shape sending_schedule", () => {
  if (!/method:\s*"PATCH"/.test(modalSrc)) {
    throw new Error("expected PATCH method");
  }
  if (!/sending_schedule/.test(modalSrc)) {
    throw new Error("expected sending_schedule body field");
  }
});

test("schedule shape uses send_between_hours not hours.{start,end}", () => {
  if (!/send_between_hours/.test(modalSrc)) {
    throw new Error("modal must write send_between_hours (engine shape)");
  }
});

test("schedule shape uses days not days_of_week", () => {
  if (!/\bdays\b/.test(modalSrc)) {
    throw new Error("modal must write days (engine shape)");
  }
  // strip comments before checking — the file documents the rejected shape
  const codeOnly = modalSrc.replace(/\/\/[^\n]*/g, "");
  if (/days_of_week\s*:/.test(codeOnly)) {
    throw new Error("modal code must NOT write days_of_week (prompt shape — engine reads `days`)");
  }
});

test("schedule shape uses max_per_day not daily_limit", () => {
  if (!/max_per_day/.test(modalSrc)) {
    throw new Error("modal must write max_per_day (engine shape)");
  }
});

test("validates end > start hour", () => {
  if (!/end\s*<=\s*start|end hour must be after/i.test(modalSrc)) {
    throw new Error("expected start/end hour validation");
  }
});

test("validates at least one day selected", () => {
  if (!/days\.length\s*===\s*0|at least one sending day/i.test(modalSrc)) {
    throw new Error("expected day-required validation");
  }
});

test("PATCH endpoint is /api/campaigns/[id]", () => {
  if (!/\/api\/campaigns\/\$\{campaignId\}/.test(modalSrc)) {
    throw new Error("expected PATCH /api/campaigns/${campaignId}");
  }
});

console.log(`\n${tests - failed}/${tests} passed (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
