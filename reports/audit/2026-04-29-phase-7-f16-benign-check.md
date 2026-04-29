# Phase 7-collapsed — F-16 pgboss benign-check

**Generated:** 2026-04-28 (post-Phase-5b, V4 streamlined finish)
**Source:** worker VPS 200.234.226.226 — `psql $DATABASE_URL` against pg-boss schema

## Verdict — F-16 demotes from P1-conditional to **P2 (BENIGN — TTL artifact)**

The audit prompt's decision rule was: if `keep_until_default` (TTL) is set, demote to P2.

`pgboss.queue` row for `poll-provisioning-jobs` has both TTL knobs configured:
- `expire_seconds = 900` (15-min active timeout)
- `retention_seconds = 1209600` (14-day retention)
- `deletion_seconds = 604800` (7-day deletion grace)
- `policy = standard` / `retry_limit = 2`

Steady state: 21,522 jobs in `created` state. Oldest job age = **14 days 22 hours** — exactly at the `retention_seconds` boundary. Job creation rate ≈ 1/min (21.5K / 14d / 1440 min ≈ 1.07/min). The count is bounded by retention, not growing.

## Deeper observation (not a finding — backlog item)

`poll-provisioning-jobs` is the ONLY queue stuck in `created`. Every other pg-boss queue shows `completed` work (`smtp-connection-monitor` 736 completed, `sync-all-accounts` 2292 completed, `provision-step` 117 completed, `queue-sequence-steps` 2213 completed, etc.). Worker is alive (`systemctl is-active dashboard-worker = active`, started Mon 2026-04-27 20:33:06 CEST), processing other queues normally.

The cron is firing into a void: no worker handler is registered for the `poll-provisioning-jobs` queue name. Jobs never reach `active` or `completed`. Effective behavior: cron emits jobs every minute, retention sweeps them at the 14-day boundary, work the queue is supposed to trigger never happens.

This is a deploy/config issue, not a data integrity issue. **Surface in Phase 9 post-audit backlog as a worker-side investigation item** — out of Phase 8 scope per Dean's streamline directive.

## Worker DATABASE_URL value (Phase 8.1 input)

`/opt/dashboard-worker/.env` `DATABASE_URL` resolves to:
- host: `aws-1-us-east-2.pooler.supabase.com`
- port: **5432** (session mode), NOT 6543 (transaction mode)
- db: `postgres`
- user: `postgres.<project-ref-and-tenant>` (masked)

**Phase 8.1 Vercel-add MUST use this value verbatim** — pg-boss is sensitive to pooler mode and session-mode is what the worker tested under.
