# Reoon Autonomous Trigger + Orphan Handler Rewrite — Design

**Author:** V8 CC autonomous session — 2026-04-30
**Branch:** `fix/reoon-autonomous-trigger-2026-04-30`
**V7 punch deltas closed by this PR:** #24 (verification_result persistence), #26 (orphan handler rewrite), #27 (real-email Reoon smoke).
**V7 punch still open:** #25 (tightened triage / catch_all prefix whitelist / spamtrap auto-suppression — separate session).

## 1. Problem statement

CC #1 (PR #32 / merge SHA `a1ba99d`) shipped the Outscraper /tasks API rewrite. Smoke list `7165de2b-f147-47e1-99a2-2c1862aa9d67` now has 21 lead_contacts rows with real emails — all sitting at `email_status='pending'`. Reoon mapper fix (PR #31, sha `7753a79`) is deployed but never validated end-to-end through the production worker path because:

1. `src/worker/handlers/verify-new-leads.ts` is broken in three places: filters on a non-existent column (`verification_status='unverified'` — actual column is `email_status`), uses a stale Reoon mapper that pre-dates PR #31, and writes to the non-existent column `verification_status`.
2. `/api/lead-contacts/verify` REST route works but is Clerk-session-gated — Dean wants the autonomous worker path, not a UI click.
3. `verification_result` JSONB persistence (V7 punch #24, audit §6c) was deferred — needed so future sessions can inspect "why was this risky" without re-verifying.

## 2. Phase 0 evidence

### 0a — pre-state of smoke target (REST query)

```
total=21, with_email=21, by_status={'pending': 21}
```

✅ Matches expectation: 21 rows, all with email, all pending. No drift on 0a.

### 0b — orgId resolution

```
[{"id":"org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q","name":"StealthMail","clerk_org_id":"org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq"}]
```

`organizations.id` (the internal UUID-like primary key, also the value of `lead_contacts.org_id`) is `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`. This is the trigger payload `orgId`. (The clerk_org_id has different middle/end characters — confirmed by cross-referencing `lead_contacts.org_id` on the smoke list.)

### 0c — Reoon sanity probe

`GET emailverifier.reoon.com/api/v1/verify?email=jmotherhsed@aol.com&key=…&mode=power` → HTTP 200, body:

```json
{"can_connect_smtp":true,"domain":"aol.com","email":"jmotherhsed@aol.com","has_inbox_full":false,"is_catch_all":false,"is_deliverable":false,"is_disabled":false,"is_disposable":false,"is_free_email":true,"is_role_account":false,"is_safe_to_send":false,"is_spamtrap":false,"is_valid_syntax":true,"mx_accepts_mail":true,"mx_records":["mx-aol.mail.gm0.yahoodns.net"],"overall_score":2,"status":"invalid","username":"jmotherhsed","verification_mode":"power"}
```

✅ HTTP 200, `status` field present and equal to `"invalid"`. `mapReoonStatus("invalid")` → `"invalid"` per `src/lib/leads/verification-service.ts:18`. Reoon's response shape is compatible with PR #31's mapper. Cost ≈ $0.005.

### 0d — migration count

Directory listing: `023_leads_v1a_lists.sql` is the latest. Mig 024 will be next. (REST `rpc` on `schema_migrations` is gated; directory truth is canonical for new migration numbering.)

### 0e — schema check (state drift discovered)

```
verification_status: column lead_contacts.verification_status does not exist  ← matches expectation (absent)
email_status, verified_at, verification_source, verification_result          ← all present
```

**State drift:** `verification_result` JSONB DEFAULT `'{}'` already exists. Origin: `supabase/migrations/012_hands_free_automation.sql:13` — added during the B16 hands-free automation work. The prompt's Phase 0e expectation ("verification_result absent") was wrong.

**Adjusted Phase 1a plan:** mig 024 keeps `ADD COLUMN IF NOT EXISTS` as an idempotent no-op (so the migration file remains a clear paper trail of the dependency the new handler relies on), plus the partial GIN index (genuinely new). NOT NULL constraint dropped — column is currently nullable with default `{}`, tightening it would require backfilling and is not needed for the handler to write JSONB correctly.

### 0f — Phase 0 GO

All sanity gates pass. Proceeding to Phase 1.

## 3. Implementation outline

### 3a. Migration 024

`supabase/migrations/024_lead_contacts_verification_result.sql`:

```sql
-- 2026-04-30: V7 punch #24 (audit §6c) — formalize verification_result persistence.
-- Column was already added in 012_hands_free_automation.sql; this migration is
-- idempotent (IF NOT EXISTS) and primarily adds the GIN index for future
-- "show me all risky rows whose Reoon raw response had X" queries.
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS verification_result JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_verification_result_keys
  ON lead_contacts USING gin (verification_result jsonb_path_ops)
  WHERE verification_result != '{}'::jsonb;
```

### 3b. Handler rewrite — `src/worker/handlers/verify-new-leads.ts`

Full rewrite. Key changes:

| Aspect | OLD | NEW |
|---|---|---|
| Payload type | `{orgId: string}` | `{orgId: string; lead_list_id?: string}` (optional list scoping) |
| Reoon call | local `verifyEmailWithReoon()` POST helper | imports `verifyEmail` from `@/lib/leads/verification-service` (POST→GET, canonical mapper, raw_result returned) |
| Filter column | `.eq('verification_status', 'unverified')` (non-existent) | `.eq('email_status', 'pending').not('email', 'is', null)` |
| List scope | none | `if (lead_list_id) query.eq('lead_list_id', lead_list_id)` |
| Limit | 500 | 5000 (matches API route cap) |
| DB writes | `verification_status, verification_result` (verification_status doesn't exist) | `email_status, verified_at, verification_source='reoon', verification_result` |
| Concurrency | sequential 100ms-spaced | `Promise.allSettled` chunks of 10 (matches verifyBatch's small-batch pattern) |
| Per-email error | mark 'unknown' | leave `email_status='pending'` (don't overstate evidence); log to console |
| Suppression | wrote suppression_list rows | dropped — V7 punch #25 separate scope |
| Final log | "X valid, Y invalid, Z unknown" | adds `risky` count + `pending` (untouched) count + lead_list_id |

Why use `verifyEmail` not `verifyBatch`: `verifyBatch` returns only `{email, email_status}` — no raw response. The new handler needs the raw response to populate `verification_result` JSONB. `verifyEmail` is the per-email export from the same module that returns `{email_status, raw_result}` and internally calls `mapReoonStatus`. We're consuming the canonical mapper without duplicating Reoon API logic.

### 3c. types.ts update

`src/lib/supabase/types.ts:864-961` lead_contacts Row/Insert/Update + `LeadContact` interface (1245-1276): add `verification_result: Record<string, unknown>` (Row) and `?: Record<string, unknown>` (Insert/Update + interface). Default `{}`. Type matches existing `custom_fields`.

### 3d. One-shot trigger script

`scripts/trigger-reoon-verify-list.ts`: imports `initBoss` from `@/lib/email/campaign-queue`, sends a `verify-new-leads` job with `{orgId, lead_list_id}`, prints job id, calls `boss.stop()`. Committed so future Reoon runs are reproducible.

### 3e. Worker registration

`src/worker/index.ts:320-328` — payload type is currently inline-defined as `{orgId: string}`. Widen to `{orgId: string; lead_list_id?: string}`. Backward-compatible.

## 4. Tests

`src/worker/handlers/__tests__/verify-new-leads.test.ts` — new file, follows the tsx-CLI assertion pattern from `verification-service.test.ts`. Tests:

1. Payload with `lead_list_id` filters by list (mock supabase chain).
2. Payload without `lead_list_id` does not filter by list.
3. Mixed Reoon statuses (`safe`, `risky`, `invalid`) map correctly via canonical `mapReoonStatus`.
4. `verification_result` JSONB is populated with raw Reoon response per row.
5. Missing `REOON_API_KEY` throws.
6. Reoon failure on individual email leaves that row at `email_status='pending'` (no overstatement).

Wired into `package.json` `test:gate0` script — appended after the existing `verification-service.test.ts` entry.

## 5. Verification plan (Phase 5 probes)

| Probe | Threshold | SQL/check |
|---|---|---|
| 1. Status shift | ≥18/21 rows ≠ 'pending' (≥85%) | `SELECT email_status, COUNT(*) FROM lead_contacts WHERE lead_list_id='7165de2b…' GROUP BY 1` |
| 2. Verified_at + source | ≥18/21 have `verified_at IS NOT NULL AND verification_source='reoon'` | `SELECT COUNT(*) … WHERE …` |
| 3. JSONB populated | ≥18/21 have non-empty verification_result + sample contains `status` field | `SELECT COUNT(*), email, verification_result … LIMIT 1` |
| 4. Worker errors | 0 reoon_error/worker_error in 15 min window | `SELECT COUNT(*) FROM system_alerts WHERE alert_type IN (…) AND created_at > NOW() - INTERVAL '15 min'` |

## 6. Cost estimate

- Phase 0c probe: ~$0.005 (1 email)
- Phase 5d trigger: ~$0.105 (21 emails @ ~$0.005)
- **Total: ~$0.11 — well under $0.20 cap.**

## 7. Rollback plan

- Migration 024 stays in place (additive, idempotent — column was already there).
- If any Phase 5 probe fails: `git revert -m 1 $MERGE_SHA && git push origin main && ssh worker pull + restart`.
- 21 `lead_contacts` rows untouched on rollback (revert is code-only; if the handler partially ran it's still "more verified than before" which is monotonic improvement).

## 8. NO-GO compliance reaffirmation

- ❌ src/lib/provisioning/* — untouched
- ❌ src/worker/handlers/(provision-|pair-verify|rollback-)* — untouched
- ❌ src/lib/leads/verification-service.ts — read-only consumer; no edits
- ❌ src/app/api/lead-contacts/verify/route.ts — untouched
- ❌ .gitignore / serverless-steps.ts — untouched
- ❌ Tightened triage (punch #25) — out of scope
- ❌ DELETEs — none planned
- ❌ Cost > $0.20 — capped
