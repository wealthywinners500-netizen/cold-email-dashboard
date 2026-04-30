# Unibox V1+b — design doc (Phase 0 output)

**Branch:** `feat/unibox-v1b-delete-unsubscribe`
**Worktree:** `dashboard-app/.claude/worktrees/competent-sanderson-4e0384`
**Author:** V7 CC autonomous session, 2026-04-30 (post V1+a deploy at `3137593`, docs at `ba8a88e`)

## 1. Schema findings

Verified directly against `supabase/migrations/005_unified_inbox.sql`, `007_lead_contacts.sql`, and `003_campaign_engine.sql`.

| Table | Column needed | Current state | Required change |
|---|---|---|---|
| `inbox_messages` | `deleted_at TIMESTAMPTZ` | has `is_deleted BOOLEAN DEFAULT FALSE` (legacy, unused at INSERT path) — no timestamp column | **ADD `deleted_at TIMESTAMPTZ`** (timestamp-based per spec; existing `is_deleted` left in place untouched) |
| `inbox_threads` | `deleted_at TIMESTAMPTZ` | has only `is_archived BOOLEAN` | **ADD `deleted_at TIMESTAMPTZ`** |
| `lead_contacts` | `unsubscribed_at TIMESTAMPTZ` | has `suppressed BOOLEAN DEFAULT FALSE` (different semantic — pre-send suppression rule) | **ADD `unsubscribed_at TIMESTAMPTZ`** (timestamp distinct from `suppressed`; auto-unsub flow sets only this column) |

Drift notes vs V7 spec:
- Spec referenced a `folder` column on `inbox_messages`; actual is `mailbox VARCHAR(100) DEFAULT 'INBOX'`. The current sync handler hard-codes `'INBOX'`, so no folder-aware deletion logic is needed.
- Spec assumed UID-based dedup. The actual `imap-sync.ts` dedups by `parsed.message_id` (RFC-822 Message-ID) at line 180-191. Both keys give equivalent deletion-respect semantics, but the simplest extension is to fold `deleted_at` into the existing dedup query.

## 2. Migration SQL (verbatim)

Next migration number: `022` (after `021_dbl_resweep.sql`).

File: `supabase/migrations/022_unibox_v1b_soft_delete_unsubscribe.sql`

```sql
-- Migration 022: Unibox V1+b — soft-delete columns + unsubscribe column
--
-- - inbox_messages.deleted_at: per-message soft delete; UI excludes; IMAP
--   sync respects (won't re-INSERT a UID we soft-deleted).
-- - inbox_threads.deleted_at: per-thread soft delete; cascaded from message
--   bulk delete in the API layer.
-- - lead_contacts.unsubscribed_at: set by classifier auto-unsub on STOP
--   classification, by manual unsubscribe button, or by future webhooks.
--   Send-path filter excludes any recipient whose lead_contacts row has
--   this column non-null.
--
-- Indexes are partial (predicate `WHERE deleted_at IS NULL` /
-- `WHERE unsubscribed_at IS NOT NULL`) to keep the indexed set small —
-- the common case is the bulk of rows have NULL on these columns.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE inbox_threads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_active
  ON inbox_messages (thread_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_threads_active
  ON inbox_threads (org_id, latest_message_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_unsubscribed
  ON lead_contacts (org_id, email)
  WHERE unsubscribed_at IS NOT NULL;
```

## 3. FK chain inbox_message → lead_contact

Direct email match scoped by org_id. Verified: `campaign_recipients` has no `lead_contact_id` FK column — it stores `email VARCHAR(255)` directly. So the simplest, unambiguous resolution is:

```
inbox_messages.from_email   (the contact's email)
  ↓ LOWER + scope by org_id
lead_contacts WHERE org_id = $1 AND LOWER(email) = LOWER($from_email)
```

Helper (added in `src/lib/email/contact-lookup.ts` — new file):

```ts
async function resolveLeadContactIdForMessage(
  supabase: SupabaseClient,
  orgId: string,
  fromEmail: string
): Promise<string | null> {
  const normalized = (fromEmail || '').trim().toLowerCase();
  if (!normalized) return null;
  const { data } = await supabase
    .from('lead_contacts')
    .select('id')
    .eq('org_id', orgId)
    .ilike('email', normalized)
    .maybeSingle();
  return data?.id ?? null;
}
```

**Ambiguity resolution:** `lead_contacts` has `UNIQUE(org_id, email)` (migration 007 line 35), so at most one row matches per org. No ambiguity possible.

## 4. Routing module change (verbatim)

File: `src/lib/inbox/tab-routing.ts`

### Before
```ts
export function isBouncedThread(thread: ThreadLike): boolean {
  return thread.latest_classification === 'BOUNCE';
}

export function isSpamThread(thread: ThreadLike, knownSenders: Set<string>): boolean {
  if (thread.latest_classification !== 'SPAM') return false;
  // ... external-participant check
}
```

### After
```ts
export function isBouncedThread(thread: ThreadLike): boolean {
  // V1+b: warm-up wins. Snov.io manages its own warm-up bounces; surfacing
  // them in Bounced double-counts and clutters the deliverability view.
  if (isWarmUpThread(thread)) return false;
  return thread.latest_classification === 'BOUNCE';
}

export function isSpamThread(thread: ThreadLike, knownSenders: Set<string>): boolean {
  // V1+b: same warm-up exclusion as Bounced.
  if (isWarmUpThread(thread)) return false;
  if (thread.latest_classification !== 'SPAM') return false;
  // ... external-participant check (unchanged)
}
```

`isAllThread` already calls `!isBouncedThread(thread)` and `!isSpamThread(thread, knownSenders)` — its membership is unchanged because warm-up was already excluded directly.

## 5. API endpoint plan

| Method + Path | Body | Response | Auth |
|---|---|---|---|
| `DELETE /api/inbox/threads/[threadId]` | — | `{ ok: true, thread_id, deleted_at }` | Clerk via `auth()`, scoped to org |
| `POST /api/inbox/threads/bulk-delete` | `{ thread_ids: number[] }` (max 500) | `{ ok: true, deleted: N }` or `{ error }` | same |
| `POST /api/lead-contacts/[id]/unsubscribe` | — (idempotent) | `{ ok: true, contact_id, unsubscribed_at }` | same |

Existing `GET /api/inbox/threads`, `GET /api/inbox/threads/[id]`, `PATCH /api/inbox/threads/[id]`, `GET /api/inbox/search/route.ts` all gain `.is('deleted_at', null)` filter.

Routes use the existing pattern — `auth()` from `@clerk/nextjs/server` → `getInternalOrgId()` → `createAdminClient()` → scope every query by `org_id`. JSON envelope `{ ok: true, ... }` on success, `{ error: '...' }` on fail with appropriate HTTP status.

## 6. UI surface plan

File: `src/app/dashboard/inbox/inbox-client.tsx`

1. **Per-row checkbox** in the thread list (left panel). State `selectedThreadIds: Set<number>`.
2. **Bulk-action toolbar** above the thread list, conditionally rendered when `selectedThreadIds.size > 0`:
   - "Delete selected (N)" — confirms then calls `POST /api/inbox/threads/bulk-delete`.
   - "Clear selection".
3. **Per-thread "Delete" action** in the existing per-row hover menu (next to Star/Archive). Uses Trash2 lucide icon.
4. **"Unsubscribe contact" button** in the right-panel thread header (next to subject/badge). Reads the from_email of the most recent inbound message (or thread.participants), looks up the lead_contact via a small helper API, and POSTs to the unsubscribe endpoint. Button disabled and re-labeled "Unsubscribed" if `unsubscribed_at` is already set.
5. After successful delete or bulk-delete, threads are filtered out of local state immediately (optimistic update). On unsubscribe, label flips to "Unsubscribed".
6. Confirmation dialogs use `window.confirm()` (no new shadcn-Dialog dependency required; matches the project's existing minimal-deps stance — DOMPurify, lucide are the only client utilities currently imported).

## 7. Worker handler changes (verbatim)

### 7.1 IMAP sync respect — `src/lib/email/imap-sync.ts` lines 180-191

**Before:**
```ts
if (parsed.message_id) {
  const { data: existing } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('message_id', parsed.message_id)
    .single();

  if (existing) {
    if (msg.uid > maxUid) maxUid = msg.uid;
    continue; // Skip duplicate
  }
}
```

**After:**
```ts
if (parsed.message_id) {
  const { data: existing } = await supabase
    .from('inbox_messages')
    .select('id, deleted_at')
    .eq('message_id', parsed.message_id)
    .maybeSingle();

  if (existing) {
    if (existing.deleted_at !== null) {
      console.log(
        `[Sync] Skipping deleted message_id ${parsed.message_id} (account ${accountId}, uid ${msg.uid})`
      );
    }
    if (msg.uid > maxUid) maxUid = msg.uid;
    continue; // Skip duplicate (live OR soft-deleted)
  }
}
```

The existing dedup already prevents recreating soft-deleted messages because the row still exists — but the explicit `deleted_at` log line gives operators visibility when the soft-delete-protect path actually fires.

### 7.2 Auto-unsub on STOP — `src/worker/handlers/sync-inbox.ts`

Add helper at top of file:
```ts
async function applyAutoUnsubscribe(
  supabase: SupabaseClient,
  orgId: string,
  fromEmail: string,
  classification: Classification,
  messageId: number
): Promise<void> {
  if (classification !== 'STOP') return;
  const normalized = (fromEmail || '').trim().toLowerCase();
  if (!normalized) return;

  const { data: contact } = await supabase
    .from('lead_contacts')
    .select('id, unsubscribed_at')
    .eq('org_id', orgId)
    .ilike('email', normalized)
    .maybeSingle();

  if (!contact) return;
  if (contact.unsubscribed_at) return; // idempotent

  const now = new Date().toISOString();
  await supabase
    .from('lead_contacts')
    .update({ unsubscribed_at: now })
    .eq('id', contact.id)
    .is('unsubscribed_at', null); // double-check idempotency

  await supabase.from('system_alerts').insert({
    org_id: orgId,
    alert_type: 'auto_unsubscribe',
    severity: 'info',
    title: `Auto-unsubscribed contact ${normalized}`,
    details: {
      contact_id: contact.id,
      message_id: messageId,
      classification,
      from_email: normalized,
      unsubscribed_at: now,
    },
  });
  console.log(`[AutoUnsub] STOP from ${normalized} → contact ${contact.id} unsubscribed`);
}
```

Call site in `handleClassifyReply` after the existing classification update + before `wireClassificationToSequenceEngine`:
```ts
await applyAutoUnsubscribe(
  supabase,
  message.org_id,
  message.from_email,
  result.classification as Classification,
  data.messageId
);
```

Same call in `handleClassifyBatch` — but note batch fetches don't currently select `from_email`. Will add `from_email` to the select projection at line 235.

### 7.3 Send-path filter — `distribute-campaign-sends.ts` `getPendingRecipients` lines 106-126

**Before:**
```ts
async function getPendingRecipients(
  supabase: ReturnType<typeof getSupabase>,
  campaignId: string,
  limit: number
): Promise<CampaignRecipient[]> {
  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('id, campaign_id, email, first_name, last_name, company_name, status, org_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(limit);
  // ...
}
```

**After:** two-step (PostgREST has no IN-subquery for excluded emails; cleanest is the simple JOIN-via-second-fetch pattern):
```ts
async function getPendingRecipients(
  supabase: ReturnType<typeof getSupabase>,
  orgId: string,
  campaignId: string,
  limit: number
): Promise<CampaignRecipient[]> {
  // V1+b: pull the org's unsubscribed emails first; exclude any recipient
  // whose email matches. Tiny set (< 100 typical) so a Set lookup is fine.
  const { data: unsub } = await supabase
    .from('lead_contacts')
    .select('email')
    .eq('org_id', orgId)
    .not('unsubscribed_at', 'is', null);
  const unsubSet = new Set((unsub || []).map((r) => String(r.email).toLowerCase()));

  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('id, campaign_id, email, first_name, last_name, company_name, status, org_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(limit + unsubSet.size); // pad in case some get filtered

  const filtered = (recipients || []).filter((r) => !unsubSet.has(String(r.email).toLowerCase()));
  return filtered.slice(0, limit) as CampaignRecipient[];
}
```

Plus add `campaign.org_id` argument at the call site (line 226-230).

### 7.4 Send-path filter — `process-sequence-step.ts` after line 76

After fetching the `recipient` row, before checking account limits, add:
```ts
// V1+b: hard stop if the contact has been unsubscribed since enqueue.
const recipientEmail = String(recipient.email || '').trim().toLowerCase();
if (recipientEmail) {
  const { data: contact } = await supabase
    .from('lead_contacts')
    .select('unsubscribed_at')
    .eq('org_id', orgId)
    .ilike('email', recipientEmail)
    .maybeSingle();
  if (contact?.unsubscribed_at) {
    console.log(
      `[Sequence] Skipping ${recipientEmail} — contact unsubscribed at ${contact.unsubscribed_at}`
    );
    await supabase
      .from('campaign_recipients')
      .update({ status: 'unsubscribed' })
      .eq('id', recipientId);
    return; // do not advance step, do not send
  }
}
```

## 8. Tests to add (≥6)

| File | What it pins | New cases |
|---|---|---|
| `src/lib/inbox/__tests__/tab-routing.test.ts` (extend) | `isBouncedThread` returns FALSE on warm-up + BOUNCE; `isSpamThread` returns FALSE on warm-up + SPAM; `matchesTab('bounced',...)` and `matchesTab('spam',...)` exclude warm-up. | +5 |
| `src/lib/email/__tests__/contact-lookup.test.ts` (new) | `resolveLeadContactIdForMessage` returns null for empty input; trims+lowercases the email. (Pure function — no Supabase round-trip in unit test, mock the supabase shape.) | 4 |
| `src/worker/handlers/__tests__/auto-unsubscribe.test.ts` (new) | `applyAutoUnsubscribe` short-circuits if classification != STOP; short-circuits if contact already unsubscribed; sets `unsubscribed_at` + writes `system_alerts` for new STOP. (Mock supabase shape.) | 3 |
| `tests/migrations/check-022.test.ts` (new — added to `tests/` if dir exists, else inline tsx) | After applying migration 022, the three new columns exist + the three new indexes exist. — DROPPED (no DB connection in test:gate0; verified live in Phase 5). | 0 |

Total: ≥12 new test cases across 3 new/extended files. Migration column-presence test deferred to Phase 5 live verification (test:gate0 is offline-only).

`test:gate0` count: **28 → 30** suites (auto-unsubscribe handler + contact-lookup).

## 9. Files to be touched (full list)

**New files:**
- `supabase/migrations/022_unibox_v1b_soft_delete_unsubscribe.sql`
- `src/lib/email/contact-lookup.ts`
- `src/app/api/inbox/threads/bulk-delete/route.ts`
- `src/app/api/lead-contacts/[id]/unsubscribe/route.ts`
- `src/lib/email/__tests__/contact-lookup.test.ts`
- `src/worker/handlers/__tests__/auto-unsubscribe.test.ts`

**Modified files:**
- `src/lib/inbox/tab-routing.ts` — warm-up exclusion in `isBouncedThread` + `isSpamThread`.
- `src/app/api/inbox/threads/route.ts` — `.is('deleted_at', null)` filter.
- `src/app/api/inbox/threads/[threadId]/route.ts` — `.is('deleted_at', null)` filter on GET/PATCH; new DELETE handler.
- `src/app/api/inbox/search/route.ts` — `.is('deleted_at', null)` filter.
- `src/app/dashboard/inbox/inbox-client.tsx` — checkbox column, bulk toolbar, delete actions, unsubscribe button.
- `src/lib/email/imap-sync.ts` — extend dedup to log `deleted_at` skips.
- `src/worker/handlers/sync-inbox.ts` — auto-unsub on STOP in both `handleClassifyReply` + `handleClassifyBatch`; add `from_email` to batch SELECT.
- `src/worker/handlers/distribute-campaign-sends.ts` — exclude unsubscribed recipients in `getPendingRecipients`.
- `src/worker/handlers/process-sequence-step.ts` — hard-stop on `unsubscribed_at` after recipient fetch.
- `src/lib/inbox/__tests__/tab-routing.test.ts` — extend with 5 warm-up exclusion cases.
- `package.json` — wire 2 new test files into `test:gate0`.

**NOT touched (out of scope or NO-GO):**
- `src/lib/provisioning/**` (saga, F-24 forbidden)
- `dashboard-app/.gitignore`, `src/lib/provisioning/serverless-steps.ts` (preserved-uncommitted on Dean's main tree)
- Per-contact unsubscribe-management UI (deferred — out of scope)
- IMAP server-side EXPUNGE (V2 scope)
- New pg-boss queue or cron schedule (none introduced)
- V1+a vocab + 6-tab + pacing + short-circuit (must remain intact — covered by saga-isolation + extended tab-routing tests)

## 10. Phase 0 conclusions

- **No structural blocker.** All three target columns are simple ADDs; FK chain is unambiguous via `lead_contacts(org_id,email)` UNIQUE.
- The existing message_id-based IMAP dedup naturally protects deleted messages from re-INSERT — adding `deleted_at` aware logging makes the contract explicit.
- The warm-up-wins fix from V1+a deploy report §4.1 (option B candidates) — going with **option A (warm-up wins)** since Dean's stated frustration was the double-count clutter; Snov.io has its own bounce visibility (the warm-up dashboard).
- STOP handler already adds to `suppression_list` + calls `handleOptOut` for campaign-attached messages. The new `applyAutoUnsubscribe` is additive — fires on every STOP regardless of campaign attachment, sets the new `unsubscribed_at` column.
- Phase 1 ready to begin.
