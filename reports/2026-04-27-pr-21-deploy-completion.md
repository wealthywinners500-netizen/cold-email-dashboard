# PR #21 deploy completion — weekly post-launch DBL re-sweep

**Date:** 2026-04-27
**PR:** [#21](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/21) — `feat: weekly post-launch DBL re-sweep job + admin monitor panel`
**Squash-merge sha (main):** `00b3260de60e3df27e8140e424b7664f4700a5d0`
**Worker HEAD post-pull (`/opt/dashboard-worker` on 200.234.226.226):** `00b3260`
**Migration:** `021_dbl_resweep` applied to Supabase prod (`ziaszamgvovjgybfyoxz`)
**Status:** **GREEN — deploy successful, dbl-resweep is live and operational.**

---

## ⚠️ Immediate-action P0 finding for Dean

The Phase 5 smoke sweep — the very first run of the new feature — surfaced **10 real DBL burns** on two production pairs. These are real Spamhaus DBL listings (DQS return code `127.0.1.2` = "spam domain"; SURBL + URIBL companion zones empty, so DQS is unambiguous), not false positives. The feature worked; the burns existed before today and were caught for the first time by this sweep.

**10 burns summary** (full details in `dbl_sweep_runs` row `fe5214f5-c1c5-4752-bb49-0c9408ed0789` and as critical `system_alerts`):

| Pair | NS domain | Burnt sending_domains |
|---|---|---|
| #16 | `mareno.info` | `nelita.info`, `suleong.info` |
| #18 | `partnerwithkroger.store` | `krogerpromopartners.info`, `krogerpromotions.info`, `krogerreach.info`, `localgrocerymarketing.info`, `krogerretailreach.info`, `krogerstoreadvertising.info`, `localgrocerymarketingpro.info`, `marketmygrocery.info` |

All 10 are now flipped to `blacklist_status='burnt'` in `sending_domains`, with `dbl_first_burn_at` stamped at the sweep timestamp, and 10 critical `system_alerts` rows inserted (alert_type=`dbl_burn`, severity=`critical`).

**Recommended next-action triage** (Dean's call per-incident, NOT the system's): for each of the 10 domains, decide drop / delist-via-Spamhaus-form / wait. Pair 18 (`partnerwithkroger.store`) has 8 of its sending domains burnt — that pair is in serious trouble and should probably be paused before any warmup-day-1 traffic.

---

## Phase 1 — Migration applied to prod

- Migration `021_dbl_resweep.sql` applied via Management API SQL endpoint (`npx supabase db query --linked --file ...`) at 2026-04-27.
- `supabase db push` was NOT used — the CLI tracker (`supabase_migrations.schema_migrations`) was empty for migrations 001-020, so push would have tried to re-run all of them. Full diagnosis + Option C path captured in [reports/2026-04-27-migration-tracking-repair.md](2026-04-27-migration-tracking-repair.md).
- Tracker row for `version='021'` inserted via `INSERT ... ON CONFLICT (version) DO NOTHING`. Future `db push` recognizes 021.
- Schema diff:
  - `sending_domains`: 9 → 12 columns (+`last_dbl_check_at`, `dbl_check_history` default `[]`, `dbl_first_burn_at`)
  - New table `dbl_sweep_runs` with 4 RLS policies + 2 indexes
- Pre/post snapshots: [reports/2026-04-27-pre-migration-021-schema.md](2026-04-27-pre-migration-021-schema.md), [reports/2026-04-27-post-migration-021-schema.md](2026-04-27-post-migration-021-schema.md)

## Phase 2 — Saga contract test GREEN against post-migration prod

- `RUN_LIVE_CONTRACT_TESTS=1` against post-migration prod schema: **10 / 10 assertions pass**. Throwaway pair + cascaded synthetic sending_domain row both deleted by the test's `finally` block; zero residue.
- Saga's literal three-field INSERT shape `(pair_id, domain, primary_server_id)` round-trips unchanged. New columns populate with declared defaults.
- Full evidence: [reports/2026-04-27-saga-contract-validation.md](reports/2026-04-27-saga-contract-validation.md)
- One in-deploy fix needed: commit `48ee53a` corrected a fixture bug in the contract test (commit `486c7a0` had only supplied 4 of 8 NOT NULL columns on `server_pairs`). RFC 5737 reserved IPs + `*.invalid` hostnames now used for the throwaway pair.

## Phase 4 — Worker deploy on 200.234.226.226

- Pre-pull worker HEAD: `6f9b317`
- Post-pull worker HEAD: `00b3260` (fast-forward, 17 files updated)
- `systemctl restart dashboard-worker`: executed manually via `.command` script (Cowork permission gate blocked direct CC `systemctl` call — standard workaround). Service became `Active: active (running)` at `2026-04-27 20:33:06 CEST`. Journal shows clean startup with `[Worker] All queues created` + `[Worker] Email worker is running. Waiting for jobs...`
- pg-boss queues verified directly via Management API SQL:
  - **23/23 expected queues present** (21 prior saga queues + 2 new: `dbl-resweep`, `dbl-resweep-cron`)
  - `pgboss.schedule` row for `dbl-resweep-cron` confirmed: cron=`0 13 * * 1`, timezone=`UTC` (Mondays 13:00 UTC ≈ 09:00 ET)
- **Saga preservation post-deploy:** all prior saga handlers (`provision-step`, `pair-verify`, `warm-up-increment-cron`, `process-sequence-step`, `sync-all-accounts`, `server-health-check`, etc.) registered cleanly post-restart. No regression.

## Phase 5 — Production smoke test

- **5.1 Trigger:** INSERT into `pgboss.job (name='dbl-resweep-cron', data='{}', retry_limit=0, retry_delay=0)` — id `bdcdf268-946e-4168-b126-e9a342745103`. Note: pg-boss v12 uses snake_case (`retry_limit`, `retry_delay`); the CLI db-push path remains blocked, so the Management API SQL endpoint was used.
- **5.2 Sweep run:** `dbl_sweep_runs` row `fe5214f5-c1c5-4752-bb49-0c9408ed0789` — `status=completed`, `trigger_source=cron`, started 18:36:36 UTC, completed 18:37:01 UTC (~25s elapsed for 78 domains across 8 pairs).
- **5.3 Clouding exclusion honored:**
  - Active pairs with `provisioning_job_id IS NOT NULL` (saga-generated): **8** ← matches `pairs_scanned=8` ✓
  - Active Clouding-imported pairs (pair_number 1, 2, 3, 11, 12, 19): **6 — none scanned by cron, as designed.**
- **5.4 Pair A all clean:** 9/9 sending_domains on `cbc887de-4b86-49aa-a233-08958a7a03ae` returned `blacklist_status='clean'` with `last_dbl_check_at` within the sweep window (18:36:38–18:36:40 UTC). Pair A is healthy.
- **5.5 Alert path correct:** 10 critical `system_alerts` rows inserted for the 10 newly-listed domains on Pairs 16/18 (see P0 callout above). Idempotency held — Pair A's 9 clean domains generated zero alerts.

## Saga-preservation gates (final state)

| Gate | Result |
|---|---|
| Saga isolation invariant test | GREEN |
| Grep gate | `✓ No saga files modified` |
| `npm run typecheck` | exit 0 |
| `npm run test:gate0` | exit 0 (24 prior tests + 2 new tests = all green) |
| Live contract test (post-migration) | 10/10 assertions GREEN |
| All prior saga handlers register post-restart | GREEN (23/23) |
| Worker `dashboard-worker.service` | `active (running)` |
| Migration tracker for `021` | applied + tracked |
| Pair A sending_domains | 9/9 clean |
| Clouding-imported pairs | 0 scanned by cron (as designed) |

## Worker-identity clarification (2026-04-27, Dean)

`200.234.226.226` is the active dashboard worker. Its `hostname` returns `mail1.partner-with-kroger.info` — legacy from when the box was originally a Hestia mail server (Clouding's `newserver9`) before being repurposed as the SaaS dashboard worker. The hostname was never updated to reflect the repurposing. The Linode worker at `172.104.219.185` (`cold-send-worker-01-attempt2`) is a SEPARATE, FUTURE workstream for email sending (post-campaign-build) and is OUT OF SCOPE for this PR.

## Open items for the next Cowork continuation review session

1. **Triage the 10 production DBL burns** surfaced by the first sweep (Pair 16, Pair 18) — Dean's per-incident call.
2. **Migration tracker drift.** 001-020 not tracked in `supabase_migrations.schema_migrations`. Needs a "rename duplicate-version files + comprehensive repair" PR. See [reports/2026-04-27-migration-tracking-repair.md](reports/2026-04-27-migration-tracking-repair.md) §5.
3. **Duplicate-version migration files** (008/008, 009/009, 012/012) — root cause of the migration-tracker friction. Rename one of each pair to an unused slot.
4. **Missing 015 / 016 files** (campaigns_v2 work). Files are absent from this branch's history; tracker doesn't expect them either. Resolve as part of item 2's PR.
5. **Hostname/purpose mismatch** on `200.234.226.226`. Either `hostnamectl set-hostname dashboard-worker-01` on the host, or document explicitly in `project_server_deployment.md`.
6. **IMAP cert errors** in worker journal (`IP: 45.79.111.103 is not in the cert's list`). Pre-existing background sync errors against an upstream IMAP server. Unrelated to dbl-resweep.
7. **Lesson learned for future PR prompts.** The 5-halt sequence on PR #21 was painful but each halt surfaced a real production-side issue (drift, ambiguity, real bug). None of the halts could have been safely improvised through. Worth capturing as an HL: *"When deploying against a database with documented historical drift, expect 3-5 halts and budget time accordingly. Don't try to predict-and-fix all the friction in advance — surface and decide each one as it comes."*
8. **Lesson learned for test authoring.** Commit `486c7a0`'s fixture bug (missing NOT NULL columns) surfaced 5 halts deep into the deploy. Any test that touches live tables must be authored against the live NOT NULL constraint set, not from memory of the migration files. Add a pre-flight "schema constraint check" step to any future test-writing CC prompt.

---

## Final commit SHAs

| Item | sha |
|---|---|
| Squash-merge commit on main | `00b3260de60e3df27e8140e424b7664f4700a5d0` |
| Worker `/opt/dashboard-worker` HEAD | `00b3260` |
| Last commit on `feat/dbl-resweep-2026-04-27` (pre-merge) | `0c54012` |
| First feat commit (initial PR work) | `8975454` |
| Saga sha snapshot | `0ed23d8` |
| Saga isolation invariant test | `a288e90` |
| Saga contract test (initial draft) | `486c7a0` |
| Clouding exclusion hardening | `6565b95` |
| Pre-PR-open evidence | `671c40d` |
| Test fixture fix (in-deploy) | `48ee53a` |
| Phase-1+2 deploy evidence reports | `0c54012` |
