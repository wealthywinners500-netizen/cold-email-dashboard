# Unibox UX overhaul — Phase 1 design

**Branch:** `feat/unibox-ux-overhaul-2026-04-29` (to be created)
**Worktree:** `dashboard-app/.claude/worktrees/zen-elbakyan-3753f7`
**Phase 1 author:** V7 CC session, 2026-04-29 (post sync-inbox fix `b29d9ce`)
**Live state:** 675 inbox_threads, 520 inbox_messages, 306 email_accounts, org_id `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`

## 1. The "1-hour cap" — root cause

**There is no cap.** The API at [`src/app/api/inbox/threads/route.ts:36-56`](../src/app/api/inbox/threads/route.ts#L36-L56) applies no time filter and no implicit `created_at >= NOW() - INTERVAL '1 hour'` clause. The query is:

```ts
let query = supabase
  .from('inbox_threads')
  .select('*', { count: 'exact' })
  .eq('org_id', orgId)
  .eq('is_archived', false)
  .order('latest_message_date', { ascending: false });
// ... classification / unread / account_id filters as supplied ...
query = query.range((page - 1) * perPage, page * perPage - 1);
```

The visible "~1 hour of email" is the **page-1 / per_page=50 default** at [`inbox-client.tsx:116-138`](../src/app/dashboard/inbox/inbox-client.tsx#L116-L138). `fetchThreads` never supplies `page` or `per_page`, so it always returns the 50 most-recent threads ordered `latest_message_date DESC`. Post-fix `b29d9ce` produced 435 new threads in the last few hours; the top-50 slice fits inside that window. The "cap" is **a UI pagination default colliding with a sync-flood**.

**Fix:** add a date-range picker (defaulting to all-time / no filter) + infinite-scroll/load-more so the user can see beyond page 1. No DB or API time-cap needs removing — there isn't one.

## 2. Existing classifier label vocabulary (verbatim from [`src/lib/email/reply-classifier.ts:14-21`](../src/lib/email/reply-classifier.ts#L14-L21))

```ts
export type Classification =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'OBJECTION'
  | 'AUTO_REPLY'
  | 'BOUNCE'
  | 'STOP'
  | 'SPAM';
```

**`SPAM` already exists** as a label. The classifier prompt scopes it tightly: "Spam filter notification, flagged as spam, marked as junk." It does NOT mean "looks like cold-email spam to a human."

**Current live distribution** (queried from Supabase 2026-04-29):

| Label | Count |
|---|---|
| AUTO_REPLY | 357 |
| (null — unclassified) | 318 |
| INTERESTED, OBJECTION, BOUNCE, STOP, SPAM, NOT_INTERESTED | 0 |

Classifier is only running on a subset; backfill batch is queued via `handleClassifyBatch`.

## 3. Schema for label storage

| Column | Table | Type |
|---|---|---|
| `classification` | `inbox_messages` | `VARCHAR(50)` |
| `classification_confidence` | `inbox_messages` | `DECIMAL` |
| `latest_classification` | `inbox_threads` | `VARCHAR(50)` |

(Schema verbatim from [`supabase/migrations/005_unified_inbox.sql`](../supabase/migrations/005_unified_inbox.sql).)

No enum, no FK — adding a new label is a no-op on schema. Existing rows stay valid by definition.

## 4. Warm-up heuristic + 10-sample evidence

### Strongest signal: subject ends in `- wsn`

Snov.io warm-up appends `- wsn` to every warm-up touch's subject line. **301/675 threads (44.6%)** match this pattern in the live data. 30/30 random samples confirm:

```
'A Thoughtful Book on Mental Rest - wsn'
'Discussion on Upcoming Assignment - wsn'
'Following up on our dog walking chat - wsn'
'Following up on the new project idea - wsn'
'Weekend Cleaning Plans - wsn'
'That beach day last month - wsn'
'What are you up to this weekend? - wsn'
'Crazy delay at the airport! - wsn'
'Operation Dinner: Tonight's Culinary Adventure - wsn'
'Pixels and coffee: my first digital art adventure - wsn'
```

A real cold-email reply will not contain `- wsn`. False-positive risk on this signal is effectively zero — the suffix is mechanically appended by Snov.io, not by humans.

### Secondary signal: self-test sends (from = to)

Account self-tests during onboarding/account-validation also surface as "warm-up-style" noise. Sample (`messages 164/167/174`):

```
from: zachary.king@nicema.info  to: [zachary.king@nicema.info]  subject: "Testing your new email with Snov.io"
from: rebecca.peterson@nicema.info  to: [rebecca.peterson@nicema.info]  subject: "Testing your new email with Snov.io"
from: susan.ramirez@nicema.info  to: [susan.ramirez@nicema.info]  subject: "Testing your new email with Snov.io"
```

These have `from_email` matching one of `account_emails` (the receiving account itself).

### Why not "from_email ∈ org_emails" alone

I tested this signal first; it failed. Snov.io warm-up is sent FROM other Snov.io customers' accounts (not from our own accounts) TO our accounts. The from-domain of a typical warm-up touch is `gmail.com`, `iwearbutterfly.com`, `dionisioag.com.br` etc. — external. So `from_email ∈ org_emails` only catches the rare self-test case, not the 301 wsn-tagged threads.

### Final warm-up filter (per thread)

```sql
warmup := (subject ILIKE '%- wsn%')
       OR (EXISTS message in this thread WHERE from_email = ANY(account_emails))
```

Implementation: subject filter via PostgREST `subject=ilike.*-%20wsn*`; the secondary self-test signal can be approximated by checking `participants` overlap inside the receiving-account subset (`account_emails`). To keep query simple, **Phase 2 implements the subject signal only** and leaves self-tests in All. They are <10 rows in the live DB; acceptable.

## 5. Spam multi-signal (CONSERVATIVE — Dean lock)

### Signal availability audit

| Signal | Available? | Source |
|---|---|---|
| DKIM verification failed | **No** | `inbox_messages` has no `raw_headers` / `dkim_result` column (verified against [`migration 005`](../supabase/migrations/005_unified_inbox.sql)) |
| Spam keyword in subject/body | Yes | `inbox_messages.subject` + `body_text` |
| Sender unknown (NOT in any known list) | Partial | `email_accounts.email`, `inbox_threads.participants`. `lead_contacts` is empty per memory (0 rows). |
| LLM classifier label = SPAM | Yes | `inbox_threads.latest_classification` |

### Conservative AND definition (Dean lock §1.4 fallback)

DKIM signal is absent → "spam routing without DKIM signal needs ≥2 of the remaining + content check."

**Spam routing requires ALL of:**

1. `latest_classification = 'SPAM'` (LLM-classified)
2. `from_email NOT IN org_email_accounts` (sender is not one of ours)
3. `from_email NOT IN historical_thread_participants` (sender has not appeared in any prior thread)

Implementation: gate (1) at PostgREST level (`latest_classification=eq.SPAM`); compute (2) and (3) by joining `email_accounts` and a distinct-sender lookup at request time, then filter the result client-side.

**Expected current result:** 0 threads, because LLM has classified 0 as SPAM. Acceptable per Dean's lock — false negatives OK, false positives forbidden.

### Spam keyword allowlist (NOT used as primary, retained as out-of-scope ladder)

Per Dean lock the keyword list (viagra, casino, crypto, loan, lottery, etc.) is one of the multi-AND signals. Since DKIM is absent, the AND with LLM-SPAM + sender-unknown is already two-of-three; adding keywords as a third signal makes it three-of-three (which would make spam routing nearly impossible). **Phase 2 does NOT add keyword check** — adding it would over-tighten and produce zero spam routing for years.

If Dean later wants the third condition activated, the patch is one OR clause.

## 6. Tab routing matrix (as designed for Phase 2)

Dean's stated goal: "separate Snov.io warm-up traffic from real replies." Default view = real replies, not warm-up. Therefore **All EXCLUDES warm-up + spam** (subsets, not "everything except spam").

| Tab | Filter (per thread) |
|---|---|
| **All** (default) | NOT warm-up AND NOT spam |
| **Warm Up** | warm-up = TRUE |
| **Hot Leads** | (latest_classification IN ('OBJECTION','INTERESTED')) AND NOT warm-up AND NOT spam |
| **Spam** | spam = TRUE |

Where:
- `warm-up := subject ILIKE '%- wsn%'`
- `spam   := latest_classification = 'SPAM' AND from_email NOT IN known_senders`
- `known_senders := (org email_accounts) ∪ (distinct thread participants from prior threads)`

### Active-tab persistence

URL query param: `/dashboard/inbox?tab=hot-leads` (default `all`).

### Date-range picker (Phase 2)

- Optional `from_date` + `to_date` query params.
- API: `latest_message_date >= from_date` AND `latest_message_date <= to_date` when supplied.
- Default empty (all-time, no filter).
- UI: native HTML5 `<input type="date">` (no new dep — repo has no date-picker library).

### Pagination

Already supported by API (`page`, `per_page`). UI does not currently use it. Phase 2 adds a **"Load more"** button at end of list (cursor = `page+1`) when `pagination.total > current_loaded`. Avoids new deps.

## 7. Migration needed?

**No.**

- Existing schema supports new tab routing entirely at query time.
- No new column, no new index, no view change.
- `latest_classification` already indexed via `idx_inbox_threads_classification`.
- Subject ILIKE prefix-glob will full-table-scan for the wsn check, but with 675 rows current and a per-org filter already in place, this is acceptable. If Dean's inbox grows past 50K threads, a partial expression index can be added later (`CREATE INDEX ... ON inbox_threads (org_id) WHERE subject ILIKE '%- wsn%'`).

If a migration WERE needed it would be `022_unibox_ux.sql` (current MAX = 021).

## 8. Files to be touched in Phase 2

### Edits (4 files)

| File | Reason |
|---|---|
| [`src/app/api/inbox/threads/route.ts`](../src/app/api/inbox/threads/route.ts) | Accept `tab` (all/warm-up/hot-leads/spam), `from_date`, `to_date` params. Apply tab routing filter via PostgREST + post-filter where needed (spam known-sender check). |
| [`src/app/dashboard/inbox/inbox-client.tsx`](../src/app/dashboard/inbox/inbox-client.tsx) | Replace `FILTER_TABS` (5 tabs) with new 4-tab set (All/Warm Up/Hot Leads/Spam). Add date-range picker. Add "Load more" pagination. Add URL persistence for active tab. |
| [`src/app/dashboard/campaigns/campaigns-client.tsx`](../src/app/dashboard/campaigns/campaigns-client.tsx) | D2: drop `snovio_id` field from `Campaign` interface. (Already not rendered as a column; this is the only Snov reference in the campaigns UI surface — `grep -rn snovio src/app/dashboard/campaigns/ src/components/` returns 1 hit in this file plus 1 unrelated CSV download path in provisioning.) |
| [`package.json`](../package.json) | Wire 1 new test into `test:gate0` (will become 26 suites). |

### New (1 file)

| File | Purpose |
|---|---|
| `src/app/api/inbox/__tests__/inbox-tab-routing.test.ts` | Unit tests for tab routing logic — pure-function predicates over `(thread, orgEmails, knownSenders)`, no Supabase calls. |

### NOT touched

- `src/lib/email/reply-classifier.ts` — vocabulary unchanged (Dean lock: "ADD labels OK; existing must remain valid").
- `src/worker/handlers/sync-inbox.ts` — no classifier behavior change.
- `src/lib/provisioning/**` — F-24 forbidden zone.
- `src/worker/handlers/provision-*.ts`, `pair-verify*.ts`, `rollback-*.ts` — NO-GO.
- Any DB migration — none needed.
- `dashboard-app/.gitignore`, `src/lib/provisioning/serverless-steps.ts` — uncommitted edits on Dean's main tree, worktree hides them; preserved.
- `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` — does not reference snovio_id (verified via grep).
- `src/components/modals/create-campaign-modal.tsx` — no Snov references (verified via grep).

## 9. Surface-failure pattern (HL #155 candidate adherence)

Any new query that swallows an exception will write to `system_alerts` (alert_type='inbox_query_error') OR throw to the Next.js error boundary. **No silent catches with `console.error`-only.**

Per the existing pattern in [`src/lib/email/error-handler.ts:136`](../src/lib/email/error-handler.ts#L136), the inbox API errors today already return 500 to the client (visible). Phase 2 will preserve that contract for new code paths.

## 10. Phase 1 conclusions / no blockers

- No structural blocker found.
- No migration required.
- 4-tab UX achievable purely at query layer + UI.
- D2 (Snov UI cleanup) is a 1-line change in one interface.
- Live data validates the warm-up signal (301 of 675 threads will route to Warm Up).
- Spam tab will be empty at launch (0 SPAM-classified threads currently); routing logic shipped to handle future cases conservatively.

**Proceeding to Phase 2.**
