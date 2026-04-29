# Phase 9.1 — Audit-prompt patches proposal (11 items)

**Generated:** 2026-04-28 (V4 streamlined finish, Phase 9.1)
**Status:** PROPOSAL ONLY — workspace-root prompt files are operational artifacts, not auto-applied per Phase 9 scope. CC writes the diffs; Dean (or a future Cowork session) applies.
**Scope:** patches to `CC_PROMPT_FULL_AUDIT_2026-04-29.md` + `HANDOFF_2026-04-29-PHASE-3-1-COMPLETE.md` + the V2/V3/V4 reviewer handoffs + the Phase 5a audit report.

## Summary table

| # | Source file(s) | Trigger | Severity | Type |
|---|---|---|---|---|
| 1 | CC_PROMPT (lines 49, 457) | F-24 + 16-file FORBIDDEN_FILES const | accuracy | s/13/16/ |
| 2 | CC_PROMPT (line 603) | F-25 (Wave 4.2.c route discovery) | accuracy | s/pairs/servers/ |
| 3 | CC_PROMPT (line 317) + HANDOFF_PHASE_3_1 (lines 130, 148) | F-9 (Phase 3.1.5 plaintext discovery) | factual | replace decoder section |
| 4 | CC_PROMPT (line 442) | F-22 (Wave 4.1.c) | clarification | annotate |
| 5 | reports/audit/2026-04-29-phase-5a-p19-verdict.md (line 55) | Dean call (preserve-protected, not DBL-burnt) | factual | drop speculation |
| 6 | HANDOFF_V2-REVIEWER + COWORK_V3_REVIEWER + HANDOFF_AUDIT-IN-FLIGHT + HANDOFF_V4-DIAGNOSIS | sha typo `fa7` vs `f7a` | accuracy | s/c1cc0bf96fa7ed54a/c1cc0bf96f7aed54a/g |
| 7 | CC_PROMPT (lines 59, 658, 682, 689, 705, 777-779) | gate-test framework expanded to 23 inline && chain | accuracy | s/16 ... gates/23 ... chain/ |
| 8 | CC_PROMPT (line 137) | actual schema is `pair_id`, not `server_pair_id` | accuracy | s/server_pair_id/pair_id/ in pair_verifications context only |
| 9 | CC_PROMPT (Phase 8.1 area — needs V4-paste-back follow-on) | F-1 fix (Phase 8.1) — pooler mode | new guidance | INSERT pooler-mode-per-consumer-surface section |
| 10 | CC_PROMPT (Hard Rule #5 elaboration / Phase 8 area) | Phase 8.3 FK surprise on system_alerts | new guidance | INSERT pre-DELETE FK enumeration probe |
| 11 | CC_PROMPT_AUDIT_RESUME_2026-04-29-PHASE-5c-V4-STREAMLINED.md (pre-flight script) | this session's pre-flight measurement bug | accuracy | replace ad-hoc shell regex with deterministic source |

---

## Patch 1 — Saga file count (13 → 16)

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md`
**Anchors:** lines 49, 457

The audit prompt cites "13 saga files" but the FORBIDDEN_FILES const in `src/__tests__/dbl-resweep-saga-isolation.test.ts` enumerates 16 paths. Discovered Wave 4.2.b.

**Line 49 — Hard rule #1:**
```diff
-1. **Saga isolation invariant** — NEVER touch the 13 saga files locked by `src/__tests__/dbl-resweep-saga-isolation.test.ts`.
+1. **Saga isolation invariant** — NEVER touch the 16 saga files locked by `src/__tests__/dbl-resweep-saga-isolation.test.ts` (read FORBIDDEN_FILES const dynamically; do not hardcode the count).
```

**Line 457 — Wave 4.2.b spec:**
```diff
-`git diff p16-golden-saga-2026-04-23 main -- <13 saga files>` (the exact list locked by `dbl-resweep-saga-isolation.test.ts`).
+`git diff p16-golden-saga-2026-04-23 main -- <16 saga files>` (read the exact list from `FORBIDDEN_FILES` in `dbl-resweep-saga-isolation.test.ts`; do not hardcode count).
```

---

## Patch 2 — Dashboard route /dashboard/pairs/[id] → /dashboard/servers/[id]

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md`
**Anchor:** line 603

F-25 (Wave 4.2.c): the actual route is `/dashboard/servers/[id]` not `/dashboard/pairs/[id]`. The `/dashboard/pairs` index route may also not exist as a top-level path.

```diff
-Specifically: `/dashboard`, `/dashboard/pairs`, every `/dashboard/pairs/[id]`, `/dashboard/admin`, `/dashboard/admin/dbl-monitor`, `/dashboard/billing`, `/dashboard/account`.
+Specifically: `/dashboard`, `/dashboard/servers`, every `/dashboard/servers/[id]`, `/dashboard/admin`, `/dashboard/admin/dbl-monitor`, `/dashboard/billing`, `/dashboard/account`. (Per Wave 4.2.c discovery — the route is `/servers/`, not `/pairs/`. The audit prompt's `/pairs/` framing is from older planning docs.)
```

---

## Patch 3 — F-9 smtp_pass plaintext clarification

**Sources:**
1. `CC_PROMPT_FULL_AUDIT_2026-04-29.md` line 317 (Phase 3.1 STARTTLS preflight)
2. `HANDOFF_2026-04-29-PHASE-3-1-COMPLETE.md` lines 130, 148

F-9 / HL #150 candidate: `email_accounts.smtp_pass` is **plaintext at rest** (saga writes the already-decrypted `serverPassword` directly per `worker-callback/route.ts:335` + `execute-step/route.ts:748`). The helper `smtp-pass-reader.ts` reads `ssh_credentials.password_encrypted`, NOT `email_accounts.smtp_pass`.

**CC_PROMPT line 317:**
```diff
-Decrypt `smtp_pass` via the saga's `src/lib/provisioning/smtp-pass-reader.ts` helper (HL #133 / #138). Do NOT roll a new decoder.
+Read `smtp_pass` directly from `email_accounts` — it is **plaintext at rest** (saga writes already-decrypted serverPassword via worker-callback/route.ts:335 + execute-step/route.ts:748). Do NOT use `smtp-pass-reader.ts` here — that helper reads `ssh_credentials.password_encrypted` (AES-256-GCM), which is a *different* column. F-9 + HL #150 candidate from Phase 3.1.5.
```

**HANDOFF_PHASE_3_1 line 130:**
```diff
-The encryption format is AES-256-GCM with `ENCRYPTION_KEY` from the worker VPS's `.env`. The saga's helper at `src/lib/provisioning/smtp-pass-reader.ts` (HL #133/#138) is the canonical decryption path for `email_accounts.smtp_pass`.
+The encryption format is AES-256-GCM with `ENCRYPTION_KEY` from the worker VPS's `.env`, BUT this format applies to `ssh_credentials.password_encrypted` only. **`email_accounts.smtp_pass` is plaintext at rest** (saga writes the already-decrypted value). The helper at `src/lib/provisioning/smtp-pass-reader.ts` reads `ssh_credentials.password_encrypted`, despite its name. (F-9 + HL #150 candidate; Phase 3.1.5 verified by 5-row sample.)
```

**HANDOFF_PHASE_3_1 line 148:** same correction logic — adjust the "Decrypt each `password_encrypted`" wording to make clear it does NOT apply to `email_accounts.smtp_pass`.

---

## Patch 4 — F-22 commandForIgnoringBuildStep clarification

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md`
**Anchor:** line 442

F-22 (Wave 4.1.c): `commandForIgnoringBuildStep=null` was flagged but is the correct state during active development. Setting is *conditionally* engaged (set during launch freeze, unlocked during active dev).

```diff
-`commandForIgnoringBuildStep` setting state.
+`commandForIgnoringBuildStep` setting state. **Note:** this setting is conditionally engaged — `null` is correct during active development; `"exit 0"` is set only during launch-freeze windows (per the 2026-04-23 golden-snapshot-execution recipe). Do NOT flag a `null` value as a finding without checking whether a freeze is active.
```

---

## Patch 5 — Phase 5a verdict prose: drop "3 sd dropped per HL #4" speculation

**Source:** `dashboard-app/reports/audit/2026-04-29-phase-5a-p19-verdict.md` (audit-branch only, committed at `9e605c6`)
**Anchor:** line 55

V4 reviewer flagged: the speculation that "3 sd were Spamhaus-DBL-burnt at preserve-wave time and dropped per HL #4" is unsupported. P19 has 12 sd by Dean's intentional design at preserve-wave time.

```diff
-12 domains is anomalous vs the typical 10/pair. Per-pair convention is 5 sd × 2 servers = 10 (e.g. P11+P12 each have 5×2=10). P19's 12 reflects that Pair 4 (10 sd) + Pair 7 (5 sd) = 15 sd intended for cutover, but only 12 of those 15 made it into P19's preserve-wave insert. The 3 missing are likely sd that were already Spamhaus-DBL-burnt at preserve-wave time and dropped per HL #4 ("burnt domains never go to a healthy pair").
+12 domains is by design. Per-pair convention is 5 sd × 2 servers = 10 (e.g. P11+P12 each have 5×2=10). P19's 12 sd reflects Dean's intentional choice at preserve-wave time — the migration target was scoped to a specific subset of Pair 4 + Pair 7's existing sending_domains. Do NOT speculate that the count diverges from a "typical" 10 due to DBL drops; the 12 is the intended number for the cutover.
```

---

## Patch 6 — Sha typo `fa7` → `f7a`

**Sources (4 files):**
1. `HANDOFF_2026-04-29-V2-REVIEWER-COMPLETE.md`
2. `COWORK_V3_REVIEWER_PROMPT.md`
3. `HANDOFF_2026-04-29-AUDIT-IN-FLIGHT.md`
4. `HANDOFF_2026-04-29-V4-DIAGNOSIS-COMPLETE.md`

The typo `c1cc0bf96fa7ed54a...` (`fa7` mid-string) appears in 4 workspace-root files. The canonical sha is `c1cc0bf96f7aed54a5e74c0f5cf20cb693263de1` (`f7a` mid-string). Each file should be globally s-and-r'd.

```diff
-c1cc0bf96fa7ed54a5e74c0f5cf20cb693263de1
+c1cc0bf96f7aed54a5e74c0f5cf20cb693263de1
```

`CC_PROMPT_FULL_AUDIT_2026-04-29.md` and `HANDOFF_2026-04-29-PHASE-3-1-COMPLETE.md` already have the correct spelling — no change needed in those.

---

## Patch 7 — Test count 16 → 23 inline `&&` chain in `test:gate0`

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md`
**Anchors:** lines 59, 658, 682, 689, 705, 777-779

The audit prompt assumes 16 separate `src/__tests__/*.test.ts` files run as gates. The actual gate framework is a **23-inline-`&&`-chain** in the `test:gate0` script in `package.json` (verified via `node -e "console.log(require('./package.json').scripts['test:gate0'].split('&&').length)"`).

**Line 59 — Hard rule #11:**
```diff
-runs the 16 `src/__tests__/*.test.ts` gates after each fix
+runs the 23-step `npm run test:gate0` chain after each fix (inline && chain in package.json scripts; not a directory glob — read scripts['test:gate0'] for the canonical list)
```

**Line 658:**
```diff
-Test impact: <which of the 16 gates would re-run>
+Test impact: <which of the 23 inline test:gate0 steps would re-run>
```

**Line 682:**
```diff
-Re-run all 16 `src/__tests__/*.test.ts` gates — must be green pre-fix-loop.
+Re-run `npm run test:gate0` (23 inline steps) — must be green pre-fix-loop.
```

**Line 689:**
```diff
-4. Re-run 16 test gates. ALL must stay green.
+4. Re-run `npm run test:gate0` (23 inline steps). ALL must stay green.
```

**Line 705:**
```diff
-All 16 `src/__tests__/*.test.ts` gates stay green.
+All 23 inline steps in `npm run test:gate0` stay green.
```

**Lines 777-779:**
```diff
-- Start: <sha> | <16/16 gates>
-- After Phase 8: <sha> | <16/16 gates>
-- End: <sha> | <16/16 gates>
+- Start: <sha> | <23/23 gate0 chain>
+- After Phase 8: <sha> | <23/23 gate0 chain>
+- End: <sha> | <23/23 gate0 chain>
```

---

## Patch 8 — Schema column `pair_verifications.server_pair_id` → `pair_id`

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md`
**Anchor:** line 137

The audit prompt's 0.4 baseline probe references `pair_verifications.server_pair_id`. Actual schema column is `pair_id`. (Note: `provisioning_jobs.server_pair_id` IS the correct column name; only `pair_verifications` has the rename.)

```diff
-`pair_verifications?select=server_pair_id,status,run_at&order=run_at.desc&limit=20` — record current state for each pair
+`pair_verifications?select=pair_id,status,run_at,checks&order=run_at.desc&limit=20` — record current state for each pair (column is `pair_id`, NOT `server_pair_id`; that latter form lives on `provisioning_jobs` only)
```

Also worth adding `checks` to the select since the JSONB checks array IS the diagnostic payload.

---

## Patch 9 (NEW) — Pooler mode is per-consumer-surface, not per-project

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md` (Phase 8.1 / DATABASE_URL guidance area) AND `CC_PROMPT_AUDIT_RESUME_2026-04-29-PHASE-5c-V4-STREAMLINED.md` (V4 paste-back §"8.1 — F-1 DATABASE_URL on Vercel")

Discovered Phase 8.1 (this session). The V4 paste-back's "use the worker .env value as canonical" is **wrong** for the Vercel surface. Worker uses session-mode pooler (port 5432, long-lived daemon, LISTEN/NOTIFY); Vercel serverless invocations need transaction-mode pooler (port 6543, pool releases at transaction boundary). Same host/user/password/db, only port differs by consumer surface.

**Proposed INSERT into the Phase 8.1 spec area (CC_PROMPT, near where DATABASE_URL is discussed):**

```markdown
**Pooler mode is per-consumer-surface, not per-project (HL #153 candidate; Phase 8.1 discovery).**

Same Supabase Supavisor cluster supports two pooler modes:
| Surface | Port | Mode | Why |
|---|---|---|---|
| Worker daemon (long-lived process) | 5432 | session | needs LISTEN/NOTIFY for pg-boss consume; supports prepared statements + session state |
| Vercel API routes / serverless | 6543 | transaction | short-lived; pool releases at txn boundary; supports thousands of concurrent invocations |

When propagating `DATABASE_URL` from one consumer to another, **derive port by surface**. Worker `.env` value (5432) DOES NOT work on Vercel — symptom is `MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size`, surfaced as a generic 500 / `enqueue_failed` from the Pair Verify route. Same DB, same auth, just wrong port.

Do NOT roll your own connection string components, but DO derive the port by-surface from the canonical worker value.
```

Also INSERT the same content as a minor note in V4-STREAMLINED.md §8.1 — the line `Reference call (illustrative — execute via subprocess with value piped from worker SSH...)` should be annotated:

```diff
+ # NOTE (Phase 8.1 discovery): worker .env is session-mode (port 5432).
+ # Vercel needs transaction-mode (port 6543). Same host/user/password/db, only port differs.
+ # Swap port BEFORE PATCH: `tx_url = src_url.replace(':5432', ':6543')` (urlparse-based for safety).
```

---

## Patch 10 (NEW) — Pre-DELETE FK enumeration via pg_constraint

**Source:** `CC_PROMPT_FULL_AUDIT_2026-04-29.md` (Phase 8.3 / Hard Rule #5 area)

Discovered Phase 8.3 (this session). The audit prompt's per-row gate spec for Phase 8 DELETEs only enumerated `inbox_messages` as the defense-in-depth check. `system_alerts` was not surfaced — Postgres rolled back atomically (zero damage), but cost a HALT cycle.

**Proposed INSERT into Hard Rule #5 elaboration area (CC_PROMPT around line 53):**

```markdown
**Standard pre-DELETE FK probe (HL #154 candidate; Phase 8.3 discovery).**

Before any production DELETE, enumerate ALL FK constraints referencing the target table — don't trust an inherited gate spec. Standard query:

```sql
SELECT conname, conrelid::regclass AS referencing_table,
       pg_get_constraintdef(oid) AS clause
FROM pg_constraint
WHERE confrelid = 'public.<target_table>'::regclass AND contype = 'f';
```

For each referrer:
- If clause contains `ON DELETE SET NULL` or `ON DELETE CASCADE`: safe — Postgres handles automatically.
- If clause contains `ON DELETE RESTRICT` or no ON DELETE clause (default RESTRICT): **handle in same transaction** — either NULL the FK column (if nullable) or cascade-DELETE the dependent rows. Document trade-off.
- Capture pre-DELETE row counts on every referrer for the target IDs.

The Phase 8.3 attempt to DELETE 12 collision `email_accounts` failed on `system_alerts_account_id_fkey` (default RESTRICT). 4 other FK referrers (`campaign_recipients`, `email_send_log`, `lead_sequence_state`, `inbox_messages`) had safe clauses + zero rows for the 12 IDs, so weren't blocking.
```

---

## Patch 11 (NEW) — Pre-flight saga-drift gate's shell regex is fragile

**Source:** `CC_PROMPT_AUDIT_RESUME_2026-04-29-PHASE-5c-V4-STREAMLINED.md` (V4 paste-back §"Pre-flight checks")

Discovered this session. The V4-STREAMLINED pre-flight script extracts FORBIDDEN_FILES via:
```bash
SAGA_FILES=$(git -C "$WORKTREE" show 00b3260:src/__tests__/dbl-resweep-saga-isolation.test.ts \
  | grep -oE "'[^']*'" | grep -E "^'(src/|supabase/|migrations/)" | tr -d "'")
```

This regex extracts inconsistently (CC's first run reported 16 files, but missed the per-file diff loop reporting 0 drift when actual was 1). The per-file diff is the actual gate, but the count line is misleading.

**Proposed REPLACEMENT** (more deterministic):
```diff
-SAGA_FILES=$(git -C "$WORKTREE" show 00b3260:src/__tests__/dbl-resweep-saga-isolation.test.ts \
-  | grep -oE "'[^']*'" | grep -E "^'(src/|supabase/|migrations/)" | tr -d "'")
+# Use a Node one-liner that imports the test file's FORBIDDEN_FILES const directly.
+# Falls back to npx jest --listTests if the const isn't directly importable.
+SAGA_FILES=$(node -e "
+  const src = require('fs').readFileSync('src/__tests__/dbl-resweep-saga-isolation.test.ts','utf8');
+  const m = src.match(/const FORBIDDEN_FILES = \[([\s\S]*?)\];/);
+  const arr = m[1].match(/'([^']+)'/g).map(s => s.slice(1,-1));
+  console.log(arr.join('\n'));
+")
+# Or even simpler: just run the gate test, which exits 0 on success
+# and prints the violation list on failure:
+# npx tsx src/__tests__/dbl-resweep-saga-isolation.test.ts
```

**Also recommended:** when reporting saga drift in HALT messages, use TWO separate measurements per Dean's wording standard:
- "F-24 baseline holds (tag..HEAD on saga = 1, auto-fix.ts only)"
- "Audit isolation invariant holds (main..HEAD on saga = 0)"

The "drift = 0" framing is ambiguous between the two.

---

## Application notes

- Patches 1, 2, 4, 7, 8 are accuracy fixes — apply directly without controversy.
- Patch 3 + 5 are factual corrections discovered by this audit — important to land before the next rehearsal of these phases.
- Patch 6 is a typo sweep across 4 files — cheap and clean.
- Patches 9, 10, 11 are NEW additions — discovered Phase 8 of this audit. The next iteration of the audit prompt SHOULD have these baked in.
- Patch 5 specifically targets a *committed* audit report (under `reports/audit/`); could be applied in this audit's branch (it's a branch-local report) but per Phase 9 scope is left as proposal-only here. Apply during Phase 9.7 if Dean prefers.

CC does not auto-apply any of these patches. Workspace-root prompt files are operational artifacts; apply via Dean review or follow-on Cowork session.
