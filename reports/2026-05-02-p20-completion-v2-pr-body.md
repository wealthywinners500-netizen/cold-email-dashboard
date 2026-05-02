## Summary

Belt-and-suspenders cross-file invariant tests pinning the sidecar
contract that CC #5b1 + CC #5b1.5 established across 5 files
(smtp-manager.ts, error-handler.ts, smtp-connection-monitor.ts,
sidecar-health-monitor.ts, worker/index.ts). The substantive change in
this session is OPERATIONAL (Phase 5 of CC #5b2-v2): P20-S2 sidecar
deploy + worker `.env` flag-flip + mass reactivation of all 27 P20
accounts + 6-message smoke + 3 stability gates. Phase 5 happens
post-merge, against the deployed worker, and is documented in the
deploy report.

## What this PR adds

- `src/__tests__/sidecar-cross-file-invariants.test.ts` (new, 76 LOC,
  6 tests): pins env-var consistency across the 3 sender-pipeline
  sites; pins both crons (`smtp-connection-monitor` + `sidecar-health-monitor`)
  registered + scheduled at `*/15` cadence on `worker/index.ts`; pins
  the `getSidecarAccountIds` helper-name contract between
  `error-handler.ts` and `smtp-connection-monitor.ts`.
- `package.json`: wires the new test into `test:gate0`.
- `reports/2026-05-02-p20-completion-v2-design.md` (new): Phase 0 design
  doc — 9 ground-verify checks all green, smoke account selections,
  operational change manifest, phase-by-phase auto-rollback recipes,
  MXToolbox-impact assertion. (Reports/ docs only — does not affect
  build artifacts.)
- `reports/2026-05-02-p20-completion-v2-pr-body.md` (new, this file).

## What this PR does NOT change

- Zero source code under `src/lib/`, `src/worker/handlers/`, or
  `src/lib/email/` is modified. No saga / provisioning / pair-verify /
  rollback files touched. Saga-isolation grep returns empty.
- Worker behavior at merge: identical to pre-merge. The new test runs
  in `test:gate0` only, not in the running worker.
- No DB migration. No public DNS edits. No `email_accounts.status`
  updates by THIS PR.

## Why the substantive work happens AFTER merge

CC #5b1 (PR #44) + CC #5b1.5 (PR #45) shipped the runtime infra: skip
filter on `smtp-connection-monitor` + `sidecar-health-monitor` cron +
`handleImapError` sidecar-aware suppress + diagnostic context capture.
Both env vars (`USE_PANEL_SIDECAR_ACCOUNT_IDS`,
`SIDECAR_DEPLOYED_HOSTS`) ship empty by default — exactly so the worker
behavior is unchanged at merge. CC #5b2-v2 is the first session that
flips them to non-empty values:

1. P20-S2 sidecar deploy (mirror of CC #5a v2's S1 install)
2. Worker `.env` modification (3 vars added; `.env.bak.cc5b2v2` baseline saved)
3. Mass UPDATE on 27 P20 `email_accounts` rows: `disabled` → `active`
4. Multi-account smoke: 3 direct-curl from S2 + 3 worker→sidecar via 3 distinct sending domains
5. Three 5–16-min stability gates: smtp-cm cycle, sidecar-health cycle, imap-sync cycle

The smoke includes the FIRST production-validation of CC #5b1.5's
`handleImapError` sidecar-aware suppress: when imap-sync polls the 27
reactivated accounts and (likely) hits the historical "Command failed"
imapflow errors, the suppress logic must produce
`severity='warning'` + `details.sidecar_protected='true'` alerts WITH
rich imapflow context (`responseStatus` / `responseText` /
`executedCommand` / `code` / `cause`) and MUST NOT cascade-disable any
of the 27. If the suppress doesn't behave that way at runtime, Phase 5c
auto-rolls-back per `dashboard-app/reports/2026-05-02-p20-completion-v2-design.md`
§10.

After this PR merges + Phase 5 runs GREEN, P20 is the FIRST pair
production-ready for an in-app campaign launch. Launch hold remains
Dean's discretion (separate from technical readiness).

## Test plan

- [ ] `npm run test:gate0` passes (43 test files, +1 new from this PR)
- [ ] `npm run typecheck` returns 0 errors
- [ ] `npm run build` succeeds
- [ ] Saga-isolation grep against the merge diff returns empty
- [ ] CC #5b2-v2 Phase 5 deploy report fires GREEN against the deployed worker (separate verification, post-merge)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
