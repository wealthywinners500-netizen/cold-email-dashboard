## Why

CC #5b2's flag-flip HALT (2026-05-02) named "IMAP AUTH failure" as the root cause of 100 `system_alerts.alert_type='imap_error'` rows. V9's panel-side `dovecot.log` forensic invalidated that diagnosis — every May-01 14:20–15:30 worker-IP IMAP session shows `Login: user=<...>, method=PLAIN, TLS` succeeding. The 100 alerts ALL carry `details.error="Command failed"`, which is **imapflow's generic post-AUTH command-failure** message — falling through `error-handler.ts` GENERIC catch-all branch and cascade-disabling at `consecutive_failures >= 3`.

CC #5b1 closed the SMTP-side cascade path (`smtp-connection-monitor.ts` skips `USE_PANEL_SIDECAR_ACCOUNT_IDS`). This PR closes the IMAP-side cascade path that CC #5b1 missed.

## Two changes

### 1. Sidecar-aware suppress in `handleImapError`'s GENERIC catch-all branch
- Reads `USE_PANEL_SIDECAR_ACCOUNT_IDS` (same env var as CC #5b1).
- Sidecar-flagged accounts hitting generic IMAP errors at `cf >= 3` now create a `severity='warning'` alert with `details.sidecar_protected=true`, but do NOT set `status='disabled'`.
- **AUTH-failure / Mailbox-not-found / connection-lost branches stay as-is for sidecar accounts** — real errors should still cascade. Sidecar can't fix wrong creds or missing mailboxes.
- Non-sidecar accounts: existing cascade-at-cf=3 behavior preserved (verified by test).

### 2. Capture imapflow error context in alert details
- New optional `context?: ImapErrorContext` parameter on `handleImapError`.
- Spreads `responseStatus`, `responseText`, `executedCommand`, `code`, `cause` into every alert's `details` JSONB.
- `imap-sync.ts` caller wraps the caught imapflow error fields (truncated to 500 chars).
- **Backward-compat preserved** — context is optional; existing 3-arg callers compile + run unchanged.
- After mass-reactivation (CC #5b2), future "Command failed" alerts will surface real diagnostic data — root-cause material for a follow-up CC.

### Field-name correction (vs prompt)
Prompt assumed `command`. Verified against `node_modules/imapflow/lib/imap-flow.js` (v1.2.18) NO/BAD throw site (line 738) — the actual field is `executedCommand`. Interface + caller use the correct name. Phase 0 design doc has full provenance.

## Behavior change at merge: ZERO
`USE_PANEL_SIDECAR_ACCOUNT_IDS` is empty in production. Until CC #5b2 sets it, the new sidecar-aware branch is unreachable. The new context capture is purely additive — alerts get more fields when imapflow errors fire, but nothing about classification or cascade logic changes.

## Files

| File                                            | Δ                          |
|-------------------------------------------------|----------------------------|
| `src/lib/email/error-handler.ts`                | +84 / -8 (new interface, helper, sidecar guard, 6 context spreads) |
| `src/lib/email/imap-sync.ts`                    | +18 / -1 (caller wraps imapflow context fields) |
| `src/lib/email/__tests__/error-handler.test.ts` | new (+254 LOC, 19 tests)   |
| `package.json`                                  | +1 (gate0 wiring)          |

## NOT touched (NO-GO compliance)
- `src/lib/provisioning/**` (saga F-24)
- `src/worker/handlers/(provision-*|pair-verify*|rollback-*)`
- `src/lib/email/smtp-manager.ts` (CC #5a v2 territory)
- `src/lib/email/imap-sync.ts` `syncAllAccounts` polling logic (the `.eq('status', 'active')` filter stays — Unibox needs it)
- `src/worker/handlers/smtp-connection-monitor.ts` (CC #5b1's territory)
- `src/worker/handlers/sidecar-health-monitor.ts` (CC #5b1's new file)
- `handleSmtpError` (different code path)
- DB schema, migrations, DNS, Hestia panels

## Saga-isolation grep result
```
$ git diff --name-only main...HEAD | grep -E '(src/lib/provisioning/|src/worker/handlers/(provision-|pair-verify|rollback-)|^\.gitignore$|src/lib/provisioning/serverless-steps\.ts$)'
OK: saga-isolated
```

## Test gate
- Build: clean
- Typecheck: 0 errors
- `npm run test:gate0`: all suites GREEN, including new `error-handler.test.ts` (19/19)
- New tests cover: sidecar parser parity with CC #5b1, signature backward-compat, all 4 branches spread context, GENERIC branch is sidecar-aware, sidecar suppress alert shape, AUTH/Mailbox-not-found unchanged, `handleSmtpError` byte-identical (out-of-scope guard), imap-sync caller wrapping shape

## Phase 5 smoke plan
On worker pull + restart:
- **P1** worker startup logs clean (no errors related to this diff)
- **P2** `imap-sync` cron fires next 5-min cycle without regression
- **P3** any new `imap_error` rows post-deploy carry the new context fields (or 0 new rows if no errors fired)
- **P4** backward-compat (inherited from typecheck)
- **P5** saga-isolation grep empty

## Auto-rollback
On FAIL of P1/P2/P3/P5: `git revert -m 1 <merge-sha>`, push, worker pull + restart. Skip Phase 6/7. Write FAILED report.

## Operational follow-ups (not in this PR)
- **CC #5b2 (now safe)** — mass-reactivate the 27 P20 accounts + flag-flip
- **CC #5c** — rollout to remaining 22 panels
- **NEW: imapflow "Command failed" root-cause CC** — schedule ~24h after CC #5b2 reactivates accounts; by then `system_alerts.details` will carry rich `executedCommand`/`responseText` data on any new failures
- **CC #4.5** — DB org_id reconciliation (still queued)

## References
- Phase 0 design doc: [`reports/2026-05-02-imap-error-sidecar-aware-design.md`](reports/2026-05-02-imap-error-sidecar-aware-design.md)
- CC #5b1 deploy: [`reports/2026-05-02-sidecar-monitor-compat-deploy.md`](reports/2026-05-02-sidecar-monitor-compat-deploy.md)
- CC #5b2 HALT: `keen-taussig-88e60b/reports/2026-05-02-sidecar-p20s2-flagflip-HALT.md`
- imapflow source: `node_modules/imapflow/lib/imap-flow.js:733-790` (NO/BAD throw site)
