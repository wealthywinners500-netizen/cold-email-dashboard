# Unibox V1+b — deploy report

**Branch:** `feat/unibox-v1b-delete-unsubscribe`
**PR:** [https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/28](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/28) (MERGED)
**Author:** V7 CC autonomous session, 2026-04-30 (post V1+a deploy at `3137593`, docs at `ba8a88e`)

## 1. Commit / merge / deploy SHAs

| Stage | SHA |
|---|---|
| Pre-merge `origin/main` | `ba8a88e` (PR #27 merge — V1+a deploy report docs) |
| Feature commit | `d514ea4` |
| Merge SHA | **`002e649d4a3980eb45c4eb1488089fc521d8e93e`** |
| Worker post-deploy HEAD | **`002e649d4a3980eb45c4eb1488089fc521d8e93e`** ✓ |

Worker host: `root@200.234.226.226` (`/opt/dashboard-worker`).
`systemctl is-active dashboard-worker` → **active**.

Boot journal post-restart at 16:59:54 UTC clean: pg-boss SIGTERM drained, `[Worker] Starting email worker...`, `[Worker] pg-boss started`, `[blacklist-proxy] Listening on :3001`. Pre-existing per-account IMAP errors (auth/connection) unrelated to this change.

## 2. Smoke-test results (post-deploy)

Run via `npx tsx scripts/v1b-smoke.ts` on the deployed worker, against live Supabase. Synthetic fixtures inserted, asserted against, then rolled back.

| Probe | Description | Result |
|---|---|---|
| 1 | Soft-delete persists (inbox_thread + cascade to messages) | **PASS** — thread_id=700, deleted_at populated, excluded from API filter |
| 2 | Sync respects deleted_at (message_id dedup catches deleted) | **PASS** — IMAP loop logs "Skipping deleted message_id <…>" then continues |
| 3 | Manual unsubscribe + idempotency | **PASS** — first call sets unsubscribed_at, second call (guarded `.is('unsubscribed_at', null)`) does NOT overwrite |
| 4 | Auto-unsub on STOP via `applyAutoUnsubscribe` | **PASS** — applied=true, lead_contacts.unsubscribed_at populated, system_alerts row created with alert_type=auto_unsubscribe + severity=info, second STOP returns applied=false |
| 5 | Send-path filter excludes unsubscribed contacts | **PASS** — 3 fixtures (1 unsubscribed) → filter returns exactly the 2 active emails |

**17/17 probe assertions passed.** Rollback executed cleanly (1 system_alert + 1 inbox_message + 1 inbox_thread + 5 lead_contacts removed, no orphan rows).

## 3. Migration applied

Number: **022** (`022_unibox_v1b_soft_delete_unsubscribe.sql`).

Applied via `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f …` on the worker. Output:

```
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
```

Post-migration verification:

| Column | Type | Nullable |
|---|---|---|
| `inbox_messages.deleted_at` | `timestamp with time zone` | YES |
| `inbox_threads.deleted_at` | `timestamp with time zone` | YES |
| `lead_contacts.unsubscribed_at` | `timestamp with time zone` | YES |

| Index | Status |
|---|---|
| `idx_inbox_messages_active` (partial: `WHERE deleted_at IS NULL`) | created |
| `idx_inbox_threads_active` (partial: `WHERE deleted_at IS NULL`) | created |
| `idx_lead_contacts_unsubscribed` (partial: `WHERE unsubscribed_at IS NOT NULL`) | created |

Migration is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## 4. Tab counts (post-deploy)

Captured against `inbox_threads` (698 rows) for `org_id=org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` via the V1+b 6-tab predicates from [src/lib/inbox/tab-routing.ts](../src/lib/inbox/tab-routing.ts):

| Tab | Pre-V1+b (V1+a) | Post-V1+b | Δ | Notes |
|---|---|---|---|---|
| **All** | 25 | **25** | 0 | unchanged (warm-up + bounced + spam already excluded from All) |
| **Warm Up** | 657 | **657** | 0 | unchanged (subject `- wsn` + self-test) |
| **Interested** | 0 | **0** | 0 | live INTERESTED messages all sit on warm-up subjects (smoke-test confirmed labels fire) |
| **Hot Leads** | 0 | **0** | 0 | same |
| **Bounced** | 19 | **16** | **−3** | warm-up wins: 3 BOUNCE rows had `- wsn` subjects |
| **Spam** | 20 | **0** | **−20** | warm-up wins: ALL 20 SPAM-classified threads were Snov warm-up |

**Partition check (post-V1+b):** `Warm Up + Bounced + Spam + All = 657 + 16 + 0 + 25 = 698 ✓` — exact match against the 698-row total.

V1+a partition discrepancy was 23 (sum was 721 vs total 698). V1+b moved exactly 23 threads out of Bounced+Spam back into the Warm Up tab where they belong (3 from Bounced + 20 from Spam = 23). The double-count is gone.

The Spam-tab drop from 20 → 0 is the most striking number: every single SPAM-classified thread in the live data was a Snov warm-up message that the LLM classified as spam (likely because warm-up content sometimes looks pitch-y to the model). Treating those as warm-up rather than spam matches Dean's stated UX expectation — Snov runs its own anti-spam handling on warm-up traffic.

## 5. system_alerts new in window

Window: 2026-04-30T16:59:00Z (worker restart) → now (~30 min).

```
imap_error  critical  71
```

**Zero new alerts of any V1+b type** (zero `auto_unsubscribe`, zero `auto_unsubscribe_error`, zero `bulk_delete_error`). The 71 `imap_error/critical` rows are pre-existing per-account IMAP connection failures (auth/TLS/peer) that have been firing throughout V1+a and earlier — unrelated to this change.

The smoke test produced exactly 1 `auto_unsubscribe` alert during Probe 4, which the rollback step deleted before exit. Live STOP traffic will start populating this alert type as soon as a STOP-classified inbox message lands on a known lead_contact.

## 6. Operational follow-ups (still pending — unchanged from V1+a)

- **DATABASE_URL rotation** (Task #19, standalone — not blocking).
- **V2 thread-context** (Task #21) — after Snov migration.
- **Skill #15 CC-prompt-author** (Task #15).
- **Lead-gen UI build** (Task #8).
- **Per-contact unsubscribe-management UI** (deferred from V1+b — out of scope; today the only UI surface for `unsubscribed_at` is the per-thread "Unsubscribe" button + the auto-unsub on STOP).
- **IMAP server-side EXPUNGE** (V2) — soft-delete only ships server-side EXPUNGE in a future iteration.

## 7. MEMORY.md proposed append (≤ 8 lines, dated)

```
*2026-04-30 — **Unibox V1+b shipped (PR #28 MERGED, sha=002e649).** Migration 022 adds inbox_messages.deleted_at / inbox_threads.deleted_at / lead_contacts.unsubscribed_at (timestamptz) + 3 partial indexes. Soft-delete only — no DELETE FROM rows; UI excludes via .is('deleted_at', null) on every inbox query, IMAP sync respects via the existing message_id dedup query (now logs "[Sync] Skipping deleted message_id" on hit). New API: DELETE /api/inbox/threads/[id], POST /api/inbox/threads/bulk-delete (max 500), POST /api/inbox/threads/[id]/unsubscribe-contact (resolves contact via from_email of last inbound msg + lead_contacts(org_id,email) UNIQUE + ilike), POST /api/lead-contacts/[id]/unsubscribe. Auto-unsub on STOP: handleClassifyReply + handleClassifyBatch run applyAutoUnsubscribe (idempotent — short-circuits if classification!=STOP, no contact, or already unsubscribed); writes system_alerts.alert_type=auto_unsubscribe/severity=info on apply. Send-path filter: distribute-campaign-sends.getPendingRecipients excludes unsubscribed emails via in-process Set; process-sequence-step.ts hard-stops at the send tick if contact unsubscribed mid-window (sets campaign_recipients.status='unsubscribed', no send, no advance). UI: per-row checkbox + bulk toolbar (delete selected) + per-row Trash button + thread-header Delete + Unsubscribe buttons; tab change clears bulk selection. Warm-up exclusion (V1+a deploy report §4.1 fix): isBouncedThread + isSpamThread short-circuit when isWarmUpThread fires. test:gate0 28→30 suites; new tests = contact-lookup (4 cases) + auto-unsubscribe (5 cases) + 5 added warm-up exclusion cases on tab-routing. Saga-isolation: 19 files-changed, all PASS, zero saga / serverless-steps.ts / .gitignore touches. **Tab counts (post-deploy):** All 25 / Warm Up 657 / Interested 0 / Hot Leads 0 / Bounced 19→16 / Spam 20→0 — perfect partition 657+16+0+25=698, double-count of 23 threads from V1+a fully resolved. **Smoke**: 17/17 assertions PASS (5 probes — soft-delete persists, sync respects deleted_at, manual unsub idempotent, auto-unsub on STOP via applyAutoUnsubscribe end-to-end including system_alerts write, send-path filter excludes 1 of 3 fixtures); rollback clean. Worker on sha=002e649, systemctl=active. Reports: dashboard-app/reports/2026-04-30-unibox-v1b-design.md + 2026-04-30-unibox-v1b-deploy.md.*
```
