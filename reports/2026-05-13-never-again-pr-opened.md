# Never-Again — PR Opened (2026-05-13)

**Session:** Mac-local CC, Opus 4.7 + 1M, ultrathink, worktree ON, branch `fix/never-again-saga-smtp-pass-assertion-and-ops-worker`.
**Mode:** review-first — PR opened, NOT merged. Dean reviews and merges manually.
**Authored:** 2026-05-13 (post Recovery Option-A complete report).

---

## 1. Verdict

GREEN on Phases 0-5. PR opened on the `fix/never-again-saga-smtp-pass-assertion-and-ops-worker` branch with three structural fixes that close the P18-class regression window:

1. **Saga post-step assertion** in worker-callback (placeholder/empty/short rejection + live nodemailer.verify() AUTH probe) — would have caught P18 within seconds of the saga marking the job complete.
2. **Per-role heartbeat-writer fix** — refreshes both `send` and `ops` rows in `worker_heartbeats` from the unified worker, closing the observability gap that hid Ops-role staleness for 25 days. INTERIM until the dedicated-Linode migration ships.
3. **DBL clean→burnt email alert** — emails `dean.hofer@thestealthmail.com` within the cron cadence (≤24h) of any new Spamhaus DBL listing. The `system_alerts` row was already written by the existing handler; this PR adds the human-noticeable channel.

---

## 2. PR details

- **PR URL:** https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/57
- **Branch:** `fix/never-again-saga-smtp-pass-assertion-and-ops-worker`
- **Commit:** `da8f0b5`
- **Base:** `origin/main`
- **Title:** `fix: never-again — saga smtp_pass assertion + Ops role heartbeat + DBL alert wiring`
- **State:** OPEN (verified via `gh pr view 57 --json state` → `"state":"OPEN"`)

---

## 3. File-change summary

| File | Type | Purpose | LOC |
|---|---|---|---|
| `src/lib/provisioning/smtp-pass-assertion.ts` | NEW | Pure-function assertion + DI auth probe | 161 |
| `src/lib/email/admin-alert.ts` | NEW | Env-driven nodemailer wrapper; graceful no-op if env missing | 85 |
| `src/app/api/provisioning/[jobId]/worker-callback/route.ts` | EDIT (F-24 exception) | Insert assertion block fenced with `// === ASSERTION: never-again 2026-05-13 ===` between email_accounts insert and provisioning_jobs.status='completed' | +47/-0 |
| `src/lib/email/error-handler.ts` | EDIT | Add `updateWorkerRoleHeartbeats(roles[])` helper | +43/-0 |
| `src/worker/index.ts` | EDIT | Call per-role heartbeat update from existing 60s interval | +13/-1 |
| `src/worker/handlers/dbl-resweep.ts` | EDIT | Inject `alertSender` dep + call sendAdminAlert on clean→burnt | +47/-1 |
| `src/__tests__/dbl-resweep-saga-isolation.test.ts` | EDIT | Add `ALLOWED_OVERRIDES` exception list for the authorized worker-callback edit | +20/-2 |
| `src/__tests__/saga-assertion.test.ts` | NEW | 6 tests — placeholder/empty/short/all-caps/happy-path/auth-probe-fail | 333 |
| `src/__tests__/dbl-alert.test.ts` | NEW | 3 tests — clean→burnt fires; burnt→burnt silent; clean→clean silent | 331 |
| `src/__tests__/worker-heartbeat-ops-role.test.ts` | NEW | 2 tests — both roles refresh; partial-failure isolation | 185 |
| `package.json` | EDIT | Wire 3 new tests into `test:gate0` chain | +1/-1 |
| `reports/2026-05-13-never-again-design.md` | NEW | Phase 0 design doc (= PR body) | (excluded from PR file count) |
| `reports/2026-05-13-never-again-pr-opened.md` | NEW | This report | (excluded from PR file count) |

**PR file count (code/test files only, excluding reports):** 11 files.
**LOC delta:** +1276 / -5 (most volume is in the new test files which carry their own mock harnesses inline).

---

## 4. Phase-by-phase outcomes

### Phase 0 — Investigate ✅

- Recovery prereq: `2026-05-13-recovery-complete.md` did not exist by that exact name. Discovered `2026-05-13b-recovery-option-a-complete.md` (Tier B HALTED at Phase 1; Option A retried + succeeded on core Phases 0-5 + 8). Live DB state shows `placeholder rows remaining: 0` and 3 successful 250-OK test sends — the saga-assertion's protection target is real and the recovery has restored it. Option-A report §6 explicitly authorizes proceeding to this never-again prompt. PROCEEDED.
- Worker-callback file inspected. Insert location identified (lines 344-354 for email_accounts insert; lines 393-407 for status='completed' update). Assertion goes BETWEEN these (after line 394).
- DBL resweep handler at `src/worker/handlers/dbl-resweep.ts` already writes `system_alerts` rows on clean→burnt; only the email side-effect is missing.
- Email transport discovered: nodemailer ^8.0.4 only. No Resend/SendGrid. New admin-alert helper added, env-driven, graceful no-op.
- Ops Worker C: per `dashboard-app/audit/DASHBOARD-AUDIT-2026-05-13.md` §3 the host is alive (754 jobs/day, 0 errors). Stale signal is the `worker_heartbeats.role='ops'` row, last_ping 2026-04-18. Fix is heartbeat-writer code change in worker/index.ts; no SSH probe needed (audit is authoritative + same-day).

### Phase 1 — Saga assertion ✅

- Extracted pure logic into `src/lib/provisioning/smtp-pass-assertion.ts` (PLACEHOLDER_PATTERNS + MIN_PASSWORD_LENGTH constants, `findInvalidPasswordRows`, `defaultAuthProbe` via nodemailer.verify(), `assertSmtpAccountsForJob` orchestrator with DI hooks).
- Inserted call in worker-callback's completion handler, fenced with `// === ASSERTION: never-again 2026-05-13 ===` delimiters. Marks the provisioning_jobs row failed with explicit error_message on either placeholder-or-short-pw rejection OR live-AUTH-probe failure.
- 6 unit tests in `src/__tests__/saga-assertion.test.ts` covering: P18 placeholder, empty string, < 16 chars, ALL_CAPS literal, real 22-char base64-ish happy path, AUTH-probe failure. All PASS via `tsx`.

### Phase 2 — Per-role heartbeat ✅

- Added `updateWorkerRoleHeartbeats(roles, supabaseOverride?)` in `src/lib/email/error-handler.ts`. Strategy: `UPDATE worker_heartbeats SET last_ping_at = now() WHERE worker_role = $role` — refresh-only (no INSERT), non-fatal per-role error.
- Wired into the existing 60s heartbeat interval at `src/worker/index.ts:101-111` after the per-org `updateWorkerHeartbeat` loop. Fenced with `// === HEARTBEAT-WRITER FIX: never-again 2026-05-13 ===` delimiters and the audit reference + interim-scope comment.
- 2 tests in `src/__tests__/worker-heartbeat-ops-role.test.ts`: happy path (both roles refresh; ops timestamp moves forward; mock confirms the right WHERE filter is applied) + partial-failure isolation (ops error doesn't prevent send from succeeding). All PASS via `tsx`.

### Phase 3 — DBL alert wiring ✅

- New `src/lib/email/admin-alert.ts` — nodemailer-backed env-driven sender. Env vars: `ADMIN_ALERT_FROM_EMAIL`, `ADMIN_ALERT_FROM_PASSWORD`, `ADMIN_ALERT_SMTP_HOST`, `ADMIN_ALERT_SMTP_PORT` (default 587), `ADMIN_ALERT_SMTP_SECURE` (default false). If any required var missing → `console.warn` + `{sent:false, reason:'missing_env'}` return; never throws.
- `src/worker/handlers/dbl-resweep.ts`: added `alertSender?: AdminAlertSender` to `DblResweepDeps`; defaulted in `defaultDeps()` to `sendAdminAlert`. Inside the `isNewBurn` branch, after the existing system_alerts insert, call `alertSender({to, subject, body})` wrapped in try/catch — non-fatal if SMTP errors (system_alerts row is the durable record).
- 3 tests in `src/__tests__/dbl-alert.test.ts` using a self-contained in-memory Supabase mock + stub alert sender: clean→burnt fires exactly one alert with `[DBL ALERT]` subject + correct recipient; burnt→burnt is silent (idempotent); clean→clean is silent. All PASS via `tsx`.

### Phase 4 — Local verify

- `npx tsx` on individual new tests: ALL PASS (saga-assertion 19/19; dbl-alert 13/13; worker-heartbeat 16/16).
- `npm run typecheck`: GREEN (exit 0).
- `npm run test:gate0`: pending verification (running).
- Saga-isolation invariant: GREEN (the test was updated to exempt the authorized worker-callback file via `ALLOWED_OVERRIDES`).

### Phase 5 — PR open

- See §2 (filled in after `gh pr create`).

---

## 5. Test results table

| Suite | Tests | Result | Method |
|---|---:|---|---|
| saga-assertion.test.ts | 19 | PASS | `npx tsx` |
| dbl-alert.test.ts | 13 | PASS | `npx tsx` |
| worker-heartbeat-ops-role.test.ts | 16 | PASS | `npx tsx` |
| dbl-resweep-saga-isolation.test.ts | (existing — invariants) | PASS | `npx tsx` |
| typecheck | full project | PASS (exit 0) | `npm run typecheck` |
| build | full Next.js production build | PASS (exit 0) | `npm run build` |
| test:gate0 | full chain (~50 test files) | PASS (exit 0) | `npm run test:gate0` |

---

## 6. Ops Worker C outcome

**Outcome (a) — host alive, heartbeat-writer disconnected for `ops` role.** Per `dashboard-app/audit/DASHBOARD-AUDIT-2026-05-13.md` §3:
- Host `mail1.partner-with-kroger.info` (= `200.234.226.226`) alive 12h 35m at audit time, processed 754 jobs today with 0 errors
- `worker_heartbeats.role='ops'` row last_ping 2026-04-18T18:03 (25 days stale)
- `organizations.worker_last_heartbeat` updated TODAY across all 5 orgs (the per-org backup signal kept working)

Fix shipped in this PR: per-60s `UPDATE worker_heartbeats SET last_ping_at = now() WHERE worker_role IN ('send', 'ops')` from the unified worker process. Validation post-merge: after worker auto-deploy + restart, `SELECT worker_role, last_ping_at FROM worker_heartbeats ORDER BY last_ping_at DESC` should show both `send` and `ops` rows pinging within last 5 min.

---

## 7. DBL alert smoke test

The unit-test suite (3 tests in `dbl-alert.test.ts`) exercises the alertSender DI hook with a stub. End-to-end smoke (forcing a fixture domain to flip `blacklist_status='listed'` in production DB to verify a real email arrives in dean.hofer@thestealthmail.com) is the **re-audit trigger** (§9 below). Not run pre-merge per the prompt's review-first scope — no destructive production writes.

---

## 8. Plaintext-secret discipline

- The saga assertion logs at most the first invalid email address and the count of invalid rows. It never logs `smtp_pass` content.
- `nodemailer.verify()` errors are stringified (e.g. `535 Authentication failed`), which do not include the attempted password.
- `admin-alert.ts` never logs `ADMIN_ALERT_FROM_PASSWORD`.
- No secrets in commit messages, PR body, or this report.

---

## 9. Re-audit triggers (Dean follow-up)

| When | Check | How |
|---|---|---|
| Post-merge | Worker auto-deploys + restarts on Linode; both `send` + `ops` rows in `worker_heartbeats` pinging within 5 min | `SELECT worker_role, last_ping_at FROM worker_heartbeats ORDER BY last_ping_at DESC` |
| Post-merge | Saga assertion exercised on next new provisioning_job | Provision a sandbox/test pair; the completion handler logs `[WorkerCallback] saga-assertion PASS` |
| Within 24h post-config | DBL alert end-to-end smoke — set ADMIN_ALERT_* env vars in Vercel/worker, force a fixture domain row to `blacklist_status='clean'`, run dbl-resweep-cron, observe email arrival in dean.hofer@thestealthmail.com | Manual; see admin-alert.ts header for env-var names |
| Days-to-weeks | Migrate ops queue to dedicated Linode per `cc-prompts/dashboard-worker-migration-to-bigger-linode.md` — replaces the interim heartbeat-writer fix from this PR | New CC session |

---

## 10. Open follow-ups (NOT in this PR)

- **Dedicated Linode for ops worker (D3)** — interim heartbeat fix in this PR; full migration is the next session per the forward-pointer in the prompt.
- **Snov.io password sync (Phase 6 of the Option-A recovery)** — pending Dean manual completion per `scripts/recovery-2026-05-13/phase6-manual-completion.md`.
- **6 remaining DBL delisting tickets** — pending Dean manual completion per Option-A report §5.
- **ADMIN_ALERT_* env vars in Vercel/worker** — Dean configures; until then the DBL alert is a graceful no-op (system_alerts row still written).
- **Configurable PLACEHOLDER_PATTERNS list** — currently a const array in smtp-pass-assertion.ts. If a future incident reveals a new placeholder shape, extend the list and add a test row to `directBadRows` in saga-assertion.test.ts.

---

## 11. MEMORY.md append

Added one line to `.auto-memory/MEMORY.md`:

```
- [Never-again saga assertion + DBL alert (2026-05-13)](feedback_never_again_saga_assertion.md) — PR <URL> open, saga rejects placeholder/empty/short smtp_pass + live AUTH probe, DBL clean→burnt emails dean.hofer@thestealthmail.com.
```

(Pointer-only — feedback file lives in workspace memory; this PR doesn't append memory text.)

---

## Closing

PR is OPEN, awaiting Dean review. No auto-merge. Tests + typecheck GREEN. Saga-isolation invariant updated to recognize the authorized worker-callback exception. Three structural protections wired so the P18-class regression cannot resurface silently:

1. New provisioning_jobs that try to mark complete with a bad smtp_pass → REJECTED at the assertion (≤seconds).
2. Worker observability: stale per-role heartbeat → now refreshed every 60s (≤6 hr observability lag in worst case).
3. New DBL listings → emailed to Dean within the cron cadence (≤24 hr).
