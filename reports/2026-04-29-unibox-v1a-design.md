# Unibox V1+a — design doc (Phase 0 output)

**Branch:** `feat/unibox-v1a-vocab-6tabs-pacing`
**Worktree:** `dashboard-app/.claude/worktrees/exciting-jackson-2c8ad8`
**Author:** V7 CC session, 2026-04-30 (post PR #25 parser fix at `248fd17`)
**Predecessor PR:** #24 (4-tab UX) merged at `0679f1e`; #25 (parser fence strip) merged at `248fd17`.

## 1. Schema verification

Verified directly against [`supabase/migrations/005_unified_inbox.sql`](../supabase/migrations/005_unified_inbox.sql).

| Table | Column | Type | Notes |
|---|---|---|---|
| `inbox_messages` | `classification` | VARCHAR(50) | nullable, no CHECK constraint, no enum |
| `inbox_messages` | `classification_confidence` | DECIMAL | nullable |
| `inbox_messages` | `reply_only_text` | TEXT | nullable |
| `inbox_messages` | `body_text` | TEXT | nullable |
| `inbox_messages` | `from_email` | VARCHAR(255) | NOT NULL |
| `inbox_messages` | `subject` | TEXT | nullable |
| `inbox_threads` | `latest_classification` | VARCHAR(50) | nullable, no CHECK |
| `email_accounts` | `email` | (existing, used by routing) | — |
| `system_alerts` | `alert_type` | VARCHAR | column is `alert_type`, not `kind` (V7 spec wording was inaccurate) |

**Drift notes vs V7 spec:**
- Spec referenced `from_address`; actual is `from_email`.
- Spec referenced `inbox_threads.classification`; actual is `inbox_threads.latest_classification`.
- Spec referenced `confidence`; actual is `classification_confidence`.
- Spec mentioned a `classified_at:NOW()` column for the short-circuit; **no such column exists**. Will not be added (out of scope).
- `system_alerts.kind` (V7) → real column is `alert_type`.

**No migration needed.** The column type `VARCHAR(50)` accepts any new label string; PR #24 design doc §3 already confirmed "ADD labels OK; existing must remain valid".

## 2. Files to touch

| File | Why |
|---|---|
| [`src/lib/email/reply-classifier.ts`](../src/lib/email/reply-classifier.ts) | Add `HOT_LEAD` to `Classification` union; refine INTERESTED definition; add HOT_LEAD definition. Remove unused `classifyBatch` (only caller is handleClassifyBatch, refactored below). |
| [`src/worker/handlers/sync-inbox.ts`](../src/worker/handlers/sync-inbox.ts) | Empty-text short-circuit + handler-side rate-limit pacing helper + 429 retry-once + classifier_error system_alerts surface. Refactor `handleClassifyBatch` from parallel-batch-of-10 to sequential paced loop. Same short-circuit + pacing in `handleClassifyReply`. |
| [`src/lib/inbox/tab-routing.ts`](../src/lib/inbox/tab-routing.ts) | Tab union expanded to 6 (`all`/`warm-up`/`interested`/`hot-leads`/`bounced`/`spam`). Add `isInterestedThread`, `isBouncedThread`. Update `isHotLeadThread` to `('HOT_LEAD','OBJECTION')`. Update `isAllThread` to also exclude bounced. Update `matchesTab` + `postgrestHintsFor`. Add `classificationNotEq` field to PostgrestTabHints (for All to filter out BOUNCE). |
| [`src/app/api/inbox/threads/route.ts`](../src/app/api/inbox/threads/route.ts) | Wire new `classificationNotEq` hint. Run JS-side `matchesTab` tighten on **all** 6 tabs (not just All/Warm-Up/Spam) for correctness across the full predicate stack. |
| [`src/app/dashboard/inbox/inbox-client.tsx`](../src/app/dashboard/inbox/inbox-client.tsx) | `FILTER_TABS` array → 6 entries. Add `HOT_LEAD` color in `CLASSIFICATION_COLORS`. URL persistence already generic (uses `Tab` type). |
| [`src/lib/inbox/__tests__/tab-routing.test.ts`](../src/lib/inbox/__tests__/tab-routing.test.ts) | Extend with cases for new tabs (INTERESTED, HOT_LEAD/OBJECTION on hot-leads, BOUNCE on bounced); update bucket-partition invariant to count over all 6 buckets minus the engagement subsets. |
| `src/lib/email/__tests__/reply-classifier-vocab.test.ts` (new) | Pure-function test of the system-prompt shape: assert SYSTEM_PROMPT mentions HOT_LEAD + new INTERESTED wording; assert `Classification` union includes HOT_LEAD. |
| `src/worker/handlers/__tests__/sync-inbox-pacing.test.ts` (new) | Pure-function test of the throttle helper + empty-text short-circuit predicate. No Supabase, no Anthropic. |
| [`package.json`](../package.json) | Wire 2 new tests into `test:gate0` (26 → 28 suites). |

**NOT touched (out of scope or NO-GO):**
- `src/lib/provisioning/**` (F-24 forbidden)
- `src/worker/handlers/provision-*.ts`, `pair-verify*.ts`, `rollback-*.ts`, `dbl-resweep.ts`, `list-registrar-domains.ts`, `health-check.ts` (saga step handlers)
- `dashboard-app/.gitignore`, `src/lib/provisioning/serverless-steps.ts` (uncommitted main-tree edits, preserved by worktree)
- Delete-email / unsubscribe (V1+b scope)

## 3. Routing matrix

| Tab | URL | PostgREST cheap-pass | JS-side tighten (matchesTab) |
|---|---|---|---|
| **All** (default) | `/dashboard/inbox` or `?tab=all` | `subject NOT ILIKE '%- wsn%'` AND `latest_classification != 'BOUNCE'` | excludes warm-up + spam (multi-signal AND) + bounced |
| **Warm Up** | `?tab=warm-up` | `subject ILIKE '%- wsn%'` | self-test catch (all-participants-our-accounts) |
| **Interested** | `?tab=interested` | `latest_classification = 'INTERESTED' AND subject NOT ILIKE '%- wsn%'` | excludes warm-up + spam (idempotent) |
| **Hot Leads** | `?tab=hot-leads` | `latest_classification IN ('HOT_LEAD','OBJECTION') AND subject NOT ILIKE '%- wsn%'` | excludes warm-up + spam |
| **Bounced** | `?tab=bounced` | `latest_classification = 'BOUNCE'` | none |
| **Spam** | `?tab=spam` | `latest_classification = 'SPAM'` | conservative AND: no external participant in `known_senders` |

**All membership rule (locked, V7 §"Tab routing"):**
> All = NOT (Warm Up OR Spam OR Bounced). Includes Interested, Hot Leads, AUTO_REPLY, NOT_INTERESTED, STOP.

So Interested + Hot Leads are **subsets** of All (visible under All AND under their own tab) — same pattern as PR #24's Hot Leads-as-subset-of-All. This is intentional; Bounced and Warm Up are partition-exclusive from All.

## 4. Vocab changes

### Before (current `src/lib/email/reply-classifier.ts:14-21`)

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

System prompt (lines 28-40):
```
- INTERESTED: The recipient expresses interest, asks questions, requests more info, wants to meet/call, or asks for pricing
- NOT_INTERESTED: ...
- OBJECTION: ...
- AUTO_REPLY: ...
- BOUNCE: ...
- STOP: ...
- SPAM: ...
```

### After (V1+a)

```ts
export type Classification =
  | 'INTERESTED'
  | 'HOT_LEAD'
  | 'NOT_INTERESTED'
  | 'OBJECTION'
  | 'AUTO_REPLY'
  | 'BOUNCE'
  | 'STOP'
  | 'SPAM';
```

System prompt redefinitions (verbatim, locked):
```
- INTERESTED: The recipient asks for general info or pricing, but does NOT ask substantive qualifying questions. First-touch soft positive.
- HOT_LEAD: The recipient asks specific qualifying questions about pricing depth, contract terms, turnaround time, typical clients, decision-makers, or next steps. Engaged with substance, ready for direct follow-up.
- OBJECTION: (unchanged)
- NOT_INTERESTED, AUTO_REPLY, BOUNCE, STOP, SPAM: (unchanged)
```

JSON-fence stripping + bare-JSON instruction at lines 38-40 (PR #25) is preserved verbatim.

## 5. Rate-limit pacing approach

**Target:** ~30 messages/min sustained — well under Anthropic's 50 req/min default cap on `claude-haiku-4-5-20251001`.

**Implementation:** module-scope timestamp in `src/worker/handlers/sync-inbox.ts`.

```ts
let lastClassifierCallAt = 0;
const PACING_MS = 2000;
const PACING_JITTER_MS = 200;

async function pacedClassifyReply(
  text: string,
  subject: string | undefined,
  orgId: string,
  supabase: SupabaseClient
): Promise<ClassificationResult> {
  // Throttle: ensure ≥2000ms since last call (+ up to 200ms jitter to spread burst).
  const elapsed = Date.now() - lastClassifierCallAt;
  if (elapsed < PACING_MS) {
    await new Promise((r) =>
      setTimeout(r, PACING_MS - elapsed + Math.random() * PACING_JITTER_MS)
    );
  }
  lastClassifierCallAt = Date.now();

  try {
    return await classifyReply(text, subject);
  } catch (err) {
    const msg = (err as Error).message || '';
    const is429 = msg.includes('429') || msg.toLowerCase().includes('rate');
    if (is429) {
      await new Promise((r) => setTimeout(r, 5000));
      lastClassifierCallAt = Date.now();
      try {
        return await classifyReply(text, subject);
      } catch (err2) {
        await supabase.from('system_alerts').insert({
          org_id: orgId,
          alert_type: 'classifier_error',
          severity: 'warning',
          title: 'Classifier rate-limited after retry',
          details: { error: (err2 as Error).message?.substring(0, 500) },
        });
        return { classification: 'AUTO_REPLY', confidence: 0.1 };
      }
    }
    console.error('[Classifier] Error:', err);
    return { classification: 'AUTO_REPLY', confidence: 0.1 };
  }
}
```

**Rationale for handler-side, not classifier-side:** spec §1.2 mandates it. Also keeps `reply-classifier.ts` pure (no I/O state) and lets the empty-text short-circuit live alongside the throttle in one auditable file.

## 6. Empty-text short-circuit logic

**Condition:** `(reply_only_text trimmed empty) AND (body_text trimmed empty)`.

**Action:** persist `{classification: 'AUTO_REPLY', classification_confidence: 0.95}` directly. Skip LLM call entirely.

```ts
function isEmptyMessage(replyOnlyText: string | null, bodyText: string | null): boolean {
  return (!replyOnlyText || replyOnlyText.trim() === '') &&
         (!bodyText || bodyText.trim() === '');
}
```

Confidence 0.95 (vs 0.1 parse-failure or 0.3 generic-fallback) signals to the dashboard that this is a *deterministic* AUTO_REPLY (Snov warm-up ping), not an LLM-uncertain one. This lets future filtering (V2 thread context) treat the two cases differently.

**Counts (live as of 2026-04-29 per PR #24 §3):** ~318 unclassified inbox_messages; PR #25 deploy classified 148 of 543 with real labels (27%) — the other 395 were empty-text Snov pings sitting at AUTO_REPLY/0.1 fallback. Of the post-rebuild 543:
- ~195 expected to hit empty-text short-circuit → AUTO_REPLY/0.95 (no LLM call, instant)
- ~348 expected to go through LLM with new vocab → at 30 msg/min ≈ ~12 min of paced LLM calls

## 7. Re-drain plan

```sql
-- Clear ALL classifications (V7 spec §6).
UPDATE inbox_messages
SET classification = NULL,
    classification_confidence = NULL
WHERE TRUE;

-- Also clear thread roll-up so the new labels rebuild via classify-batch.
UPDATE inbox_threads
SET latest_classification = NULL
WHERE TRUE;
```

(Capture pre + post counts for the report.)

Trigger via:
```bash
ssh root@200.234.226.226 'cd /opt/dashboard-worker && npx tsx -e "..."'
```
or `psql ... INSERT INTO pgboss.job (name, data) VALUES ('classify-batch', '{}');`.

Watch `pgboss.job` state transitions + `inbox_messages WHERE classification IS NULL` count + `system_alerts WHERE alert_type='classifier_error' AND created_at > NOW()-INTERVAL '30 minutes'`.

**Expected runtime:** ~12-15 min sustained (195 short-circuit instant + 348 paced @ 30/min).

**Halt threshold:** > 5% jobs failed (>~17 stuck failed). Surface in report; do NOT auto-rollback (re-classification is idempotent).

## 8. Tests to add

| File | What it pins |
|---|---|
| `src/lib/email/__tests__/reply-classifier-vocab.test.ts` (new) | (a) `Classification` union includes `HOT_LEAD`; (b) SYSTEM_PROMPT contains the new INTERESTED wording ("does NOT ask substantive qualifying questions"); (c) SYSTEM_PROMPT contains the new HOT_LEAD wording ("substantive qualifying questions"). 3 cases. |
| `src/worker/handlers/__tests__/sync-inbox-pacing.test.ts` (new) | (a) `isEmptyMessage` returns true for empty/whitespace inputs, false otherwise (8 micro-cases); (b) throttle sleeps ≥2000ms between consecutive calls (5 calls take >8000ms); (c) first call after a long idle gap does not block. 3 test groups. |
| `src/lib/inbox/__tests__/tab-routing.test.ts` (extend) | (a) INTERESTED tab predicate fires only on classification='INTERESTED' and not warm-up/spam; (b) HOT_LEAD + OBJECTION both route to hot-leads; (c) BOUNCE routes to bounced AND is excluded from All; (d) parseTab accepts new tab values + rejects legacy "hot-leads"-typo + still defaults to all on garbage; (e) updated 6-bucket exclusivity invariant: every thread lives in exactly one of {Warm Up, Bounced, Spam, All}. ~12 new cases on top of existing 33. |

`test:gate0` count: **26 → 28** suites.

## 9. Migration: NOT needed

- `inbox_messages.classification` is `VARCHAR(50)` with no CHECK constraint, no enum.
- `inbox_threads.latest_classification` ditto.
- Adding `HOT_LEAD` (9 chars) fits well under the 50-char column width.
- No new index, view, or trigger needed.

If V1+b later adds a CHECK constraint, that would become migration `022_classifier_vocab.sql`. Not in this scope.

## 10. Phase 0 conclusions

- No structural blocker found.
- All locked decisions implementable at code layer; no new infra.
- The 4-tab routing module from PR #24 is a clean substrate to extend to 6.
- The classifier vocab change is type-safe (TypeScript union) + behaviorally backward-compatible (existing labels unchanged).
- Re-drain is safe (UPDATE-NULL + classify-batch handler is idempotent).
- Phase 1 ready to begin.
