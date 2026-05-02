## Summary

CC #5b1 (V9, 2026-05-02) — two scoped, code-only changes that close the architectural gap CC #5b's Phase-0 HALT exposed.

Without these changes, every sidecar-routed account is fragile: `smtp-connection-monitor` (every 15 min) calls `testConnection()` from the worker IP `200.234.226.226` to the panel's port 587 — the EXACT legacy SMTP-AUTH path the sidecar exists to bypass. After 5 consecutive failures it sets `status='disabled'` + `disable_reason='smtp_connection_failures'`, cascade-disabling the sidecar account on whatever pre-existing legacy SMTP issues exist within ~75 min, regardless of sidecar health.

This PR ships the foundation CC #5b2 (next session) builds on. CC #5b2 sets the env vars during P20-S2 deploy + reactivation + flag-flip; this PR ONLY ships code that READS them.

## Changes

1. **`smtp-connection-monitor` is now sidecar-aware** — reads `USE_PANEL_SIDECAR_ACCOUNT_IDS` and skips those rows. Mirrors the parsing in `shouldUseSidecar()` exactly. Logs the skipped count so post-deploy probes can verify.

2. **NEW `sidecar-health-monitor` cron** — every 15 min, probes `https://<host>/admin/health` for each host in `SIDECAR_DEPLOYED_HOSTS` (comma-separated). On 3 consecutive failures inserts `system_alerts.alert_type='sidecar_unhealthy'` with 60-min dedup. **ALERTS ONLY** — does NOT auto-disable accounts. Sidecar liveness becomes a first-class signal independent of the legacy SMTP-AUTH probe.

## Production behavior change at merge

**ZERO.** Both env vars default empty → both code paths are no-ops:
- `USE_PANEL_SIDECAR_ACCOUNT_IDS` empty → `sidecarIds.has(...)` is always false → existing monitor behavior unchanged.
- `SIDECAR_DEPLOYED_HOSTS` empty → new cron logs `no-op` and returns immediately.

CC #5b2 sets the env vars on the worker during the P20-S2 deploy phase.

## Files changed

- `src/worker/handlers/smtp-connection-monitor.ts` — +25 LOC (helper + filter)
- `src/worker/handlers/sidecar-health-monitor.ts` — NEW (~190 LOC)
- `src/worker/index.ts` — +18 LOC (import + queueName + cron registration)
- `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` — +30 LOC (4 source-grep guards on monitor wiring)
- `src/worker/handlers/__tests__/sidecar-health-monitor.test.ts` — NEW (~210 LOC, 14 cases)
- `package.json` — wire new test into `test:gate0`
- `reports/2026-05-02-sidecar-monitor-compat-design.md` — Phase 0 design doc

## Saga-isolation

`git diff --name-only main...HEAD | grep -E '(src/lib/provisioning/|src/worker/handlers/(provision-|pair-verify|rollback-)|^\.gitignore$|src/lib/provisioning/serverless-steps\.ts$)'` → empty ✅

## Test plan

- [x] Typecheck clean (0 errors)
- [x] Build clean
- [x] `npm run test:gate0` GREEN end-to-end (incl. 14 new cases + 4 extended cases)
- [ ] Worker post-deploy: HEAD == merge SHA, `systemctl is-active` = active
- [ ] Probe 1: worker startup logs both crons registered, no errors
- [ ] Probe 2: smtp-connection-monitor cron run shows skipping 0 (env empty) + N active accounts tested unchanged + 0 new auto-disables
- [ ] Probe 3: sidecar-health-monitor cron run shows the no-op message
- [ ] Probe 4: 0 new `system_alerts.alert_type='sidecar_unhealthy'` rows
- [ ] Probe 5: saga-isolation grep empty post-merge

Auto-rollback authorized on ANY probe failure.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
