# CC #5b1.5 — handleImapError sidecar-aware + diagnostic context capture (DEPLOY REPORT)

**Date:** 2026-05-02
**Session:** Mac-local CC, Opus 4.7 + 1M, ultrathink ON
**Worktree:** `dreamy-lamarr-c74ae9`
**Branch:** `feat/imap-error-sidecar-aware-2026-05-02` (renamed from `claude/dreamy-lamarr-c74ae9`)
**PR:** [#45](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/45)
**Merge SHA:** `7e780db731ec070ba0adc4fb143c12f9ca8b741e`
**Worker post-deploy HEAD:** `7e780db` (== merge SHA)
**Worker `systemctl is-active`:** `active`

---

## 1. TL;DR

**🟢 GREEN.** Two-change scoped patch to `handleImapError` shipped + deployed:

1. **Sidecar-aware suppress in GENERIC catch-all branch** — sidecar-flagged accounts (per `USE_PANEL_SIDECAR_ACCOUNT_IDS`) hitting opaque generic IMAP errors at `cf >= 3` now create `severity='warning'` + `details.sidecar_protected=true` alerts but DO NOT cascade-disable. AUTH-failure / Mailbox-not-found / connection-lost branches unchanged for everyone.
2. **Capture imapflow error context** — new optional `context?: ImapErrorContext` parameter spreads `responseStatus`, `responseText`, `executedCommand`, `code`, `cause` into every alert's `details` JSONB. `imap-sync.ts` caller wraps the caught imapflow error fields (truncated to 500 chars). Backward-compat preserved.

**Production behavior change at merge:** ZERO. `USE_PANEL_SIDECAR_ACCOUNT_IDS` empty in prod = sidecar-aware path unreachable until CC #5b2 sets it. Context capture is purely additive.

**Why:** Closes the second cascade-disable path CC #5b1 missed. After CC #5b2 mass-reactivates, future "Command failed" alerts will surface real diagnostic data — root-cause material for a follow-up CC. CC #5b2's flag-flip is now safe across BOTH monitor paths.

---

## 2. Inputs verified (Phase 0 design)

- **`handleImapError` shape verified** (`src/lib/email/error-handler.ts:136-206`): 4-branch classification (AUTH / Connection-lost / Mailbox-not-found / Generic). Line numbers match prompt expectations exactly. No drift.
- **Caller enumerated** (`src/lib/email/imap-sync.ts:345`, single call site inside `syncAllAccounts`'s per-account `catch`).
- **imapflow error fields verified** against `node_modules/imapflow/lib/imap-flow.js:733-790` (NO/BAD throw site). Actual fields: `responseStatus`, `responseText`, `executedCommand` (NOT `command` as prompt assumed), `code`. Wrapper updated to use real names.
- **CC #5b1 baseline verified** (`main` HEAD = `961a395` = CC #5b1 merge before this PR).
- **No existing `error-handler.test.ts`** — created new at `src/lib/email/__tests__/error-handler.test.ts` (19 cases, source-grep dominant pattern matching CC #5b1's `smtp-manager-sidecar.test.ts`).
- **Phase 0 design doc:** [`reports/2026-05-02-imap-error-sidecar-aware-design.md`](2026-05-02-imap-error-sidecar-aware-design.md).

---

## 3. Files changed

| File                                            | Δ                                                |
|-------------------------------------------------|--------------------------------------------------|
| `src/lib/email/error-handler.ts`                | +84 / -8 (new interface, helper, sidecar guard, 6 context spreads) |
| `src/lib/email/imap-sync.ts`                    | +18 / -1 (caller wraps imapflow context fields) |
| `src/lib/email/__tests__/error-handler.test.ts` | new (+304 LOC, 19 tests)                         |
| `package.json`                                  | +1 (gate0 wiring: error-handler.test.ts)         |
| `reports/2026-05-02-imap-error-sidecar-aware-design.md`  | new (Phase 0 design doc)                |
| `reports/2026-05-02-imap-error-sidecar-aware-pr-body.md` | new (PR body)                           |

Total: 6 files, +881 / -17 (4 src/test/config files + 2 reports).

---

## 4. PR + merge SHA + Vercel deploy

- **PR:** [#45](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/45) — `feat(email): handleImapError sidecar-aware suppress + diagnostic context capture`
- **Opened:** 2026-05-02 13:20:08 UTC
- **Merged:** 2026-05-02 13:20:38 UTC (mergeStateStatus=UNSTABLE, MERGEABLE — Vercel preview was still PENDING; per prompt, UNSTABLE is acceptable to merge)
- **Merge SHA:** `7e780db731ec070ba0adc4fb143c12f9ca8b741e`
- **Vercel deploy:** triggered automatically on merge. (Deploy status will surface in GitHub status checks.)

---

## 5. Phase 5 smoke probes (verbatim)

### Probe 1 — Worker startup clean

**Command:** `ssh root@200.234.226.226 'journalctl -u dashboard-worker --since "2 min ago" | grep -iE "Worker|error-handler|imap|error" | head -40'`

**Output (post-restart, server-time UTC+2):**
```
May 02 15:21:04 mail1.partner-with-kroger.info npx[1120077]: [Worker] SIGTERM received, draining pg-boss (up to 5 min)...
May 02 15:21:04 mail1.partner-with-kroger.info npx[1120077]: [Worker] pg-boss drained cleanly, exiting.
May 02 15:21:04 mail1.partner-with-kroger.info systemd[1]: dashboard-worker.service: Deactivated successfully.
May 02 15:21:04 mail1.partner-with-kroger.info systemd[1]: Started dashboard-worker.service - Cold Email Dashboard Worker (pg-boss).
May 02 15:21:08 mail1.partner-with-kroger.info npx[1543522]: [Worker] Starting email worker...
May 02 15:21:09 mail1.partner-with-kroger.info npx[1543522]: [Worker] pg-boss started
May 02 15:21:12 mail1.partner-with-kroger.info npx[1543522]: [Worker] All queues created
May 02 15:21:14 mail1.partner-with-kroger.info npx[1543522]: [Worker] Legacy provision-server-pair handler DISABLED (...)
May 02 15:21:14 mail1.partner-with-kroger.info npx[1543522]: [Worker] pollProvisioningJobs cron DISABLED (...)
May 02 15:21:14 mail1.partner-with-kroger.info npx[1543522]: [Worker] Email worker is running. Waiting for jobs...
```

**Verdict:** PASS. Worker boots clean, all queues created, no errors related to error-handler.ts or this diff.

### Probe 2 — `imap-sync` cron fires next 5-min cycle, no regression

**Command:** `ssh root@200.234.226.226 'journalctl -u dashboard-worker --since "8 min ago" --no-pager | grep -iE "Worker|cron|imap|sync|monitor|sidecar" | tail -30'`

**Output (relevant tail):**
```
May 02 15:21:14 ... [Worker] Email worker is running. Waiting for jobs...
May 02 15:25:45 ... [Worker] Syncing all email accounts...
May 02 15:25:45 ... [Worker] Queuing ready sequence steps...
```

**Verdict:** PASS. The next `*/5 * * * *` tick (15:25:45 server-time, ~4.5 min after restart) fired cleanly — `Syncing all email accounts...` + `Queuing ready sequence steps...` — without any error referencing handleImapError, error-handler.ts, or the diff. No per-account `[IMAP]` log lines emitted because `syncAllAccounts` filters to `status='active'` accounts and finds zero (consistent with CC #5b2 forensic), so the inner for-loop body doesn't execute. Cron behavior matches pre-deploy exactly.

### Probe 3 — system_alerts contract: any new `imap_error` rows post-deploy carry the new context fields

**Command:** `psql $DATABASE_URL -c "SELECT alert_type, severity, (details ? 'responseStatus' OR ...) AS has_imapflow_context, details->>'sidecar_protected' AS sidecar_protected, created_at FROM system_alerts WHERE alert_type='imap_error' AND created_at > NOW() - INTERVAL '30 minutes' ORDER BY created_at DESC LIMIT 10;"`

**Output:**
```
 alert_type | severity | has_imapflow_context | sidecar_protected | created_at
------------+----------+----------------------+-------------------+------------
(0 rows)
```

**Verdict:** PASS — acceptable outcome (a) per prompt. 0 new `imap_error` rows in the last 30 minutes because 0 active accounts means imap-sync has nothing to poll (matches CC #5b2's pre-flagflip forensic). The context-capture path is exercised at next cron tick if/when an active account hits an imapflow error; until then the contract is verified by source-grep tests in Phase 3 + the typecheck-pass on Phase 1's interface.

### Probe 4 — Backward-compat for legacy 3-arg callers

Inherited from Phase 3 typecheck (`tsc --noEmit` returned 0 errors), confirming the new optional `context?: ImapErrorContext` parameter does not break the existing 3-arg call shape that `imap-sync.ts` (now updated to 4-arg) used to make. **Verdict:** PASS.

### Probe 5 — Saga-isolation post-deploy

**Command:** `git diff main^^...main --name-only | grep -E '(src/lib/provisioning/|provision-|pair-verify|rollback-)' || echo "OK"`

**Output:** `OK`

**Verdict:** PASS. No saga / provisioning / pair-verify / rollback files touched between merge SHA and `main^^`.

---

## 6. NO-GO compliance

- ✅ No file under `src/lib/provisioning/`
- ✅ No `src/worker/handlers/(provision-|pair-verify|rollback-)*` file touched
- ✅ `dashboard-app/.gitignore` not modified
- ✅ `src/lib/provisioning/serverless-steps.ts` not modified
- ✅ No DB migration
- ✅ No DNS records added/modified/removed
- ✅ No `email_accounts.status` updated by this session
- ✅ `git add -A` not used (specific files only)
- ✅ No secrets in transcript (psql query exported env via `grep -v '^#' .env | xargs` on worker, no local credential read)
- ✅ `USE_PANEL_SIDECAR_ACCOUNT_IDS` env var NOT set on worker by this session (CC #5b2's job)
- ✅ `/api/campaigns/[id]/send` not called
- ✅ `campaigns.status` not changed
- ✅ No imap errors manually triggered in production
- ✅ `smtp-connection-monitor.ts` UNTOUCHED
- ✅ `sidecar-health-monitor.ts` UNTOUCHED
- ✅ `imap-sync.ts` `syncAllAccounts` polling logic UNTOUCHED (the `.eq('status', 'active')` filter stays — Unibox keeps reading inboxes)
- ✅ `handleSmtpError` UNTOUCHED (verified by source-grep test #17)

---

## 7. Operational follow-ups (Dean queue)

1. **CC #5b2 — mass-reactivate + flag-flip — NOW UNBLOCKED.** Both monitor paths are sidecar-aware:
   - SMTP: `smtp-connection-monitor` skips `USE_PANEL_SIDECAR_ACCOUNT_IDS` (CC #5b1)
   - IMAP: `handleImapError` suppresses cascade-disable on opaque generic errors for sidecar accounts (THIS session)
   - imap-sync.ts polling: unchanged (Unibox keeps reading inboxes for sidecar accounts)
   - AUTH-failure / Mailbox-not-found cascades: preserved (real errors still disable)

2. **CC #5c — rollout to remaining 22 panels.** Pattern is now codified and tested.

3. **NEW: imapflow "Command failed" root-cause CC.** Schedule ~24h after CC #5b2 reactivates accounts. Once `system_alerts.details` carries rich `executedCommand` / `responseText` / `responseStatus` data on new imap_error alerts, a follow-up CC can identify the actual command + server response that's failing post-AUTH.

4. **CC #4.5 — DB org_id reconciliation.** Still queued.

---

## 8. Cost

- Token spend: ~$0 (1M context window, opus 4.7, single session)
- Compute: nominal (npm install + build + tests in worktree, single SSH deploy + restart)
- DB ops: 1 read query (system_alerts SELECT) — read-only

---

## 9. Lessons / notes

1. **Field-name correction vs prompt.** Prompt assumed imapflow error has `.command`; actual field is `.executedCommand` (verified against v1.2.18 NO/BAD throw site). Reading the actual library source before writing the wrapper saved a runtime defect that would have silently produced `details.command=undefined` in every alert.

2. **Source-grep contract tests scale.** No jest/vitest in this codebase. Following CC #5b1's `smtp-manager-sidecar.test.ts` pattern (manual `assert` + counter, source-grep against committed code) gave us 19 high-signal tests with no mocking complexity. The contract tests verify the COMMITTED source matches design intent — same ground truth that runs in production.

3. **Acceptable empty-result probes.** Probe 3's "0 rows is PASS" outcome was anticipated by the prompt because 0 active accounts means imap-sync has nothing to poll. The contract is verified at code level; runtime confirmation comes after CC #5b2 reactivates.

4. **Initial SSH denial recovered.** Phase 0's first SSH attempt was permission-denied, then later attempts succeeded — likely a first-touch permission prompt that the user approved between attempts. Made deploy possible without escalating to user.
