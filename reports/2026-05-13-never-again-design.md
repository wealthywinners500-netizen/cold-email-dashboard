# Never-Again — Design Doc (2026-05-13)

**Session:** worktree `wizardly-mclaren-764177`, branch `fix/never-again-saga-smtp-pass-assertion-and-ops-worker`.
**Mode:** review-first (PR open, no auto-merge).
**Scope:** three structural fixes so the P18 placeholder-password class of regression never reaches production again.

---

## 0.1 — Recovery prereq

Per the prompt's pre-read #3, this session requires `dashboard-app/reports/2026-05-13-recovery-complete.md` to exist + show 8 success criteria GREEN. That exact filename does **not** exist.

What does exist: `dashboard-app/reports/2026-05-13b-recovery-option-a-complete.md` — the original Tier-B prompt HALTED at Phase 1; the Option-A retry succeeded on Phases 0-5 + 8 (core recovery) with vendor-side Phases 6 (Snov.io sync) + 7 (DBL delisting) explicitly deferred to Dean's manual completion.

**Decision: PROCEED.** Rationale:
- The Option-A complete report's §6 explicitly lists this never-again prompt as the next-step trigger (within-7-days re-audit).
- The core DB state — what the saga assertion is designed to prevent — is GREEN: `placeholder rows remaining: 0` (was 30), `active rows across P12/P17/P18: 48` (was 0).
- Three live test-sends returned 250 OK (Phase 5 evidence).
- The user's session instruction is "make the reasonable call and continue."

---

## 0.2 — Saga assertion target file

File: `src/app/api/provisioning/[jobId]/worker-callback/route.ts` (this file IS in F-24; the prompt explicitly authorizes touching it via the delimited `// === ASSERTION: never-again 2026-05-13 ===` block).

**Insert location:** between the `email_accounts` bulk insert (lines 344-354) and the "Mark job completed" `provisioning_jobs` update (lines 393-407). Specifically: after line 390 (`total_accounts` update on `server_pairs`), before line 393 (`Mark job completed` comment).

Relevant code:

```ts
// Lines 344-354 — the insert
if (accountRows.length > 0) {
  const { error: accountError, count } = await supabase
    .from("email_accounts")
    .insert(accountRows);
  if (accountError) {
    console.error(`[WorkerCallback] email_accounts insert failed: ${accountError.message}`);
    accountsFailed = accountRows.length;
  } else {
    accountsCreated = accountRows.length;
  }
}

// ... sending_domains insert ...
// ... server_pair total_accounts update ...

// Lines 393-407 — Mark job completed (target: assertion goes BEFORE this block)
await supabase
  .from("provisioning_jobs")
  .update({
    status: "completed",
    progress_pct: 100,
    completed_at: new Date().toISOString(),
    server_pair_id: serverPair?.id || null,
    ...
  })
  .eq("id", jobId);
```

**Implementation strategy:** factor the assertion logic into a new file `src/lib/provisioning/smtp-pass-assertion.ts` (not in F-24; not under any FORBIDDEN_PREFIX). The worker-callback calls one function `assertSmtpAccountsForJob(supabase, jobId, pairId, accountsCreated, deps?)`. Dependency-inject the auth probe so unit tests can stub it (the dashboard's test style is plain tsx + asserts; no mocking framework).

The assertion block in worker-callback is fenced with `// === ASSERTION: never-again 2026-05-13 ===` delimiters per the prompt's exception clause.

---

## 0.3 — `worker_heartbeats` live state (from audit doc)

Per `dashboard-app/audit/DASHBOARD-AUDIT-2026-05-13.md` §3, both heartbeat sources were already inspected today:

| Source | State | Detail |
|---|---|---|
| `worker_heartbeats` row `role='send'` host=`cold-send-worker-01` | UPDATED TODAY | last_ping 2026-05-13T21:48 |
| `worker_heartbeats` row `role='ops'` host=`mail1.partner-with-kroger.info` | STALE 25 DAYS | last_ping 2026-04-18T18:03 |
| `organizations.worker_last_heartbeat` | UPDATED TODAY for all 5 orgs | working — `updateWorkerHeartbeat(orgId)` in src/lib/email/error-handler.ts:318 |

The host serving the ops queue is **alive** — it processed 754 jobs today with 0 errors (`dashboard-worker.service` PID 909). The stale row is a code-path gap: the heartbeat interval writes `organizations.worker_last_heartbeat` per-org (working) but no longer writes to `worker_heartbeats` per-role (broken since 2026-04-18).

**`worker_heartbeats` table schema (inferred from audit):**
- `worker_role` text — values: `'send'`, `'ops'`
- `host` text — e.g., `'cold-send-worker-01'`, `'mail1.partner-with-kroger.info'`
- `last_ping_at` timestamptz

The schema is NOT in `supabase/migrations/` — must have been created out-of-band. The defensive write strategy: `UPDATE worker_heartbeats SET last_ping_at = now() WHERE worker_role = 'ops'` (no INSERT — only refresh whatever rows already exist). If schema differs or no rows match, the update returns 0 rows and logs a warning rather than crashing.

---

## 0.4 — Ops Worker C SSH liveness

**Not performed.** The audit doc — written today (2026-05-13) — establishes outcome (a): host alive, `dashboard-worker.service` running PID 909, journalctl shows ops handlers (sync-inbox, smtp-connection-monitor, sidecar-health-monitor) firing within minutes of inspection. A fresh SSH probe would be redundant and the audit is authoritative.

**Phase 2 scope:** outcome (a) per the prompt. Target = the heartbeat-writer code path, not a `systemctl restart`. Fix is a single per-role `worker_heartbeats` UPDATE call inside the existing heartbeat interval at `src/worker/index.ts:101-111`. **INTERIM** per the prompt's forward-pointer to `cc-prompts/dashboard-worker-migration-to-bigger-linode.md`.

---

## 0.5 — DBL alert email transport

`grep -rln "resend|sendgrid|@react-email|nodemailer"`:
- `nodemailer ^8.0.4` is the only mail dep in `package.json` (line 39)
- No Resend, no SendGrid, no @react-email
- Existing usage: `src/lib/email/smtp-manager.ts` (campaign-send via per-account SMTP), `src/lib/email/verification-checks.ts` (probe)

**No `sendAlert` / admin-email helper exists.** This is a real gap, but per the prompt's HALT condition we cannot introduce a new dependency — nodemailer IS the discovered transport. The reasonable call:

1. **New file** `src/lib/email/admin-alert.ts` — thin wrapper around `nodemailer.createTransport` keyed off three env vars (`ADMIN_ALERT_FROM_EMAIL`, `ADMIN_ALERT_FROM_PASSWORD`, `ADMIN_ALERT_SMTP_HOST`, optional `ADMIN_ALERT_SMTP_PORT` default 587).
2. **Graceful no-op** if any env var is missing — the function logs a `console.warn` and returns, but does NOT throw. The `system_alerts` row is still written; only the email side-effect is skipped. This lets the PR merge before Dean configures the env vars, and gives Dean a single Vercel/worker config step to flip alerts ON.

This is not "introducing a new dependency" (nodemailer is already imported). It IS adding a new internal module. The alternative — picking an arbitrary `email_accounts` row to send FROM — pollutes warm-up reputation and risks the alert email going to spam, defeating its purpose.

---

## 0.6 — Existing `dbl-resweep` job location

File: `src/worker/handlers/dbl-resweep.ts:215-256` (the `isNewBurn` branch inside `sweepOrg`).

**Existing behavior (already wired):**
- On transition `blacklist_status !== 'burnt'` → `result.status === 'listed'`, the handler:
  - Sets `sending_domains.blacklist_status = 'burnt'` + `dbl_first_burn_at = checkedAt`
  - Inserts a `system_alerts` row with `alert_type='dbl_burn'`, `severity='critical'`, full details JSON

**Missing piece (this PR adds):** after the `system_alerts` insert succeeds on `isNewBurn=true`, call `sendAdminAlert(...)` to deliver the same content to `dean.hofer@thestealthmail.com`.

The status enum the existing handler uses is `'burnt'` (not `'listed'` as the prompt's template said). Adapting the prompt's pseudocode to the real schema.

---

## 0.7 — Tests & deliverables

| File | Type | Purpose |
|---|---|---|
| `src/lib/provisioning/smtp-pass-assertion.ts` | NEW | Extract assertion logic — placeholder regex + DI auth probe |
| `src/lib/email/admin-alert.ts` | NEW | Env-driven nodemailer wrapper, graceful no-op |
| `src/app/api/provisioning/[jobId]/worker-callback/route.ts` | EDIT (F-24 exception) | Insert assertion call between email_accounts insert and provisioning_jobs.status='completed' update, fenced with `// === ASSERTION: never-again 2026-05-13 ===` |
| `src/worker/index.ts` | EDIT | Add per-role `worker_heartbeats` UPDATE inside existing heartbeat interval |
| `src/worker/handlers/dbl-resweep.ts` | EDIT | Add `sendAdminAlert` call inside existing `isNewBurn` branch (already writes system_alerts) |
| `src/__tests__/dbl-resweep-saga-isolation.test.ts` | EDIT | Remove `worker-callback/route.ts` from FORBIDDEN_FILES + add ALLOWED_OVERRIDES exception list to FORBIDDEN_PREFIXES check. The invariant remains for non-authorized PRs |
| `src/__tests__/saga-assertion.test.ts` | NEW | 5 tests — placeholder/empty/short/all-caps/success-with-auth-probe |
| `src/__tests__/dbl-alert.test.ts` | NEW | 3 tests — alert fires on clean→burnt; doesn't fire on burnt→burnt; doesn't fire on clean→clean |
| `src/__tests__/worker-heartbeat-ops-role.test.ts` | NEW | 1 test — heartbeat update fires for both 'send' and 'ops' roles |
| `package.json` | EDIT | Wire 3 new tests into `test:gate0` chain |

**PR file count estimate (excluding reports + design doc):** 10 files.

| Test | Count |
|---|---|
| saga-assertion | 5 |
| dbl-alert | 3 |
| worker-heartbeat-ops-role | 1 |
| **Total new tests** | **9** |

---

## Saga-isolation invariant — exception rationale

`src/__tests__/dbl-resweep-saga-isolation.test.ts` was authored for the dbl-resweep PR with intent "this PR didn't touch saga territory." It lives in `test:gate0` permanently, so it now gates every future PR. Its `FORBIDDEN_FILES` lists `src/app/api/provisioning/[jobId]/worker-callback/route.ts` and its `FORBIDDEN_PREFIXES` includes `^src/app/api/provisioning/`.

This never-again PR is **explicitly authorized** by the prompt's F-24 exception clause to add an assertion block to worker-callback. To make the invariant test express the actual invariant (saga **orchestration** files are off-limits; the completion-handler assertion is an authorized exception), the test is modified to:

1. Remove `worker-callback/route.ts` from `FORBIDDEN_FILES`.
2. Add an `ALLOWED_OVERRIDES` array (containing `worker-callback/route.ts`) used to filter out exempted files from the `FORBIDDEN_PREFIXES` violation list.
3. Inline comment explaining the never-again exception, with a delimiter reference.

The saga-orchestration files (`pair-provisioning-saga.ts`, `provision-step.ts`, `pair-verify.ts`, `serverless-steps.ts`, etc.) remain in `FORBIDDEN_FILES` — the protection of the actual saga step machinery is intact.

---

## Plaintext-secret discipline

Same as the recovery prompt: the assertion never logs `smtp_pass` itself. It logs at most:
- Count of invalid rows
- First invalid email address (not its password)
- "Live AUTH probe failed" with the SMTP server's error message (which from nodemailer is `535 Authentication failed`-style — no password leak)

The `admin-alert.ts` wrapper never logs the `ADMIN_ALERT_FROM_PASSWORD` env var.

---

## File-change diff summary (estimate)

```
NEW   src/lib/provisioning/smtp-pass-assertion.ts          ~120 LOC
NEW   src/lib/email/admin-alert.ts                          ~60 LOC
EDIT  src/app/api/provisioning/[jobId]/worker-callback/route.ts +25 LOC (assertion block)
EDIT  src/worker/index.ts                                   +18 LOC (per-role heartbeat block)
EDIT  src/worker/handlers/dbl-resweep.ts                    +12 LOC (admin-alert call)
EDIT  src/__tests__/dbl-resweep-saga-isolation.test.ts      +20 -2 LOC (exception list)
NEW   src/__tests__/saga-assertion.test.ts                  ~180 LOC
NEW   src/__tests__/dbl-alert.test.ts                       ~140 LOC
NEW   src/__tests__/worker-heartbeat-ops-role.test.ts       ~80 LOC
EDIT  package.json                                          +3 test:gate0 entries
NEW   reports/2026-05-13-never-again-design.md              (this file)
NEW   reports/2026-05-13-never-again-pr-opened.md           (Phase 6)
```

Total: 10 code/test files + 2 reports. Code LOC delta ~+650 / -2.
