# Unibox UX overhaul — fix summary

**Branch:** `feat/unibox-ux-overhaul-2026-04-29`
**PR:** [https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/24](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/24)
**Commits:** `c183f18` feat → `b2f1148` fix(D2)
**Status:** open, unmerged, awaiting Dean review.

## 1. Phase 1 design doc

[`reports/2026-04-29-unibox-ux-design.md`](2026-04-29-unibox-ux-design.md) — 10 sections covering:

1. **Root-cause finding:** there is no 1-hour cap. The API has no time filter; the visible "~1 hour of email" is the page-1/per_page=50 default colliding with the 04-29 sync-flood (435 new threads). [`src/app/api/inbox/threads/route.ts:36-56`](../src/app/api/inbox/threads/route.ts#L36-L56) and [`inbox-client.tsx:116-138`](../src/app/dashboard/inbox/inbox-client.tsx#L116-L138).
2. Classifier vocabulary (verbatim) — 7 labels including SPAM already present; storage = `VARCHAR(50)`, no enum.
3. Warm-up signal evidence — Snov.io `- wsn` subject suffix matches **301/675 threads (44.6%)** in live data; 30/30 sample inspected, all warm-up.
4. Spam signal availability audit — DKIM column absent in schema, so conservative-AND falls to LLM-SPAM + sender-unknown.
5. Tab routing matrix.
6. Migration: NOT needed.
7. Files-to-touch enumeration.

## 2. Files changed (paths + line counts)

| File | Status | Δ |
|---|---|---|
| [`src/lib/inbox/tab-routing.ts`](../src/lib/inbox/tab-routing.ts) | **new** | +138 / 0 |
| [`src/lib/inbox/__tests__/tab-routing.test.ts`](../src/lib/inbox/__tests__/tab-routing.test.ts) | **new** | +268 / 0 |
| [`src/app/api/inbox/threads/route.ts`](../src/app/api/inbox/threads/route.ts) | edit | +89 / −24 |
| [`src/app/dashboard/inbox/inbox-client.tsx`](../src/app/dashboard/inbox/inbox-client.tsx) | edit | +218 / −108 |
| [`src/app/dashboard/campaigns/campaigns-client.tsx`](../src/app/dashboard/campaigns/campaigns-client.tsx) | edit | 0 / −1 |
| [`package.json`](../package.json) | edit | +1 / −1 |
| [`reports/2026-04-29-unibox-ux-design.md`](2026-04-29-unibox-ux-design.md) | **new** | +252 / 0 |

Total: 7 files, +966 / −134.

**Zero saga-territory edits** (verified post-commit by `dbl-resweep-saga-isolation.test.ts`: `files-changed=0` against base `origin/main`).
**Zero `.gitignore` edits** and **zero `serverless-steps.ts` edits** (preserved-uncommitted files on Dean's main tree, never touched by the worktree).

## 3. Tab routing matrix as deployed

| Tab | URL | PostgREST cheap-pass | JS-side tighten |
|---|---|---|---|
| **All** (default) | `/dashboard/inbox` | `subject NOT ILIKE '%- wsn%'` | excludes (LLM-SPAM AND no-known-external-participant) and excludes self-test (all participants are our accounts) |
| **Warm Up** | `/dashboard/inbox?tab=warm-up` | `subject ILIKE '%- wsn%'` | also catches self-test edge case |
| **Hot Leads** | `/dashboard/inbox?tab=hot-leads` | `latest_classification IN (OBJECTION, INTERESTED) AND subject NOT ILIKE '%- wsn%'` | none |
| **Spam** | `/dashboard/inbox?tab=spam` | `latest_classification = 'SPAM'` | requires no external participant to be in known_senders set (org_emails ∪ lead_contacts) |

**known_senders construction:** the API query fetches `email_accounts.email WHERE org_id = ?` plus `lead_contacts.email WHERE org_id = ?` (currently empty per memory) and unions them into a single Set<string> per request.

**Live counts (2026-04-29):**

| Tab | Count | Notes |
|---|---|---|
| All | 374 | non-warm-up, non-spam |
| Warm Up | 301 | Snov `- wsn` subjects |
| Hot Leads | 0 | classifier backfill not yet run; will populate as `handleClassifyBatch` flips OBJECTION/INTERESTED labels on the 318 unclassified `inbox_messages` |
| Spam | 0 | LLM has classified 0 as SPAM (357 AUTO_REPLY + 318 null + 0 SPAM); will populate after Spam-class hits |
| **Total** | **675** | partition exhaustive: 374 + 301 = 675 ✅ |

## 4. Tests added

[`src/lib/inbox/__tests__/tab-routing.test.ts`](../src/lib/inbox/__tests__/tab-routing.test.ts) — 33 cases, pure-function (no Supabase/network):

| Group | Cases | Key invariants |
|---|---|---|
| Warm Up | 6 | subject pattern (case-insensitive); cold-email reply NOT flagged; self-test routes here; null subject defaults to not-warm-up |
| Spam (conservative AND) | 5 | **LLM SPAM + KNOWN sender ⇒ NOT spam** (false-positive guard); single-signal must not fire; null classification can't be spam |
| Hot Leads | 5 | OBJECTION + INTERESTED route here; warm-up wins over engagement; spam wins over engagement |
| All (default view) | 4 | normal reply lives in All; warm-up + spam excluded; **SPAM-with-known-sender STAYS in All** so misclassified replies are findable |
| Bucket partition | 1 | every thread lives in exactly one of {All, Warm Up, Spam} (fixture corpus) |
| matchesTab dispatch | 4 | dispatch agrees with each predicate |
| parseTab safety | 4 | null → "all"; legacy URL values → "all"; unsafe input → "all" |
| postgrestHintsFor | 4 | warm-up uses ILIKE marker; hot-leads pins engagement set + excludes warm-up; spam pins classification=SPAM; all excludes warm-up subject |

Wired into `test:gate0` (25 → **26 suites**).

## 5. Pre-deploy verification (run inside the worktree)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm run test:gate0` | **26/26 suites PASS** (33/33 new tab-routing assertions; 25 prior intact) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| Production build | `npm run build` | **all routes built**, only the benign "Next.js inferred your workspace root" warning |
| Saga-isolation invariant | `tsx src/__tests__/dbl-resweep-saga-isolation.test.ts` | **PASS** — base=origin/main, files-changed=0 against saga territory |
| Live filter simulation | direct PostgREST against `inbox_threads` for org_id `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` | warm-up=301, NOT-warm-up=374; sums to 675 ✅ |

## 6. Post-deploy verification plan (Dean)

After merge + Vercel auto-deploy (UI-only changes; **no worker restart needed** — sync-inbox + classifier worker code is untouched):

1. Open [`/dashboard/inbox`](https://your-domain.com/dashboard/inbox).
2. Confirm 4 tabs visible: **All / Warm Up / Hot Leads / Spam**.
3. **All** loads first 50 of ~374 threads (was: top 50 of 675 including warm-up). Warm-up noise is gone.
4. Click **Warm Up** — expect ~301 threads, all with `- wsn` in subject (the Snov touches). The "Following up on the new project idea - wsn" / "Weekend BBQ - wsn" / "Operation Dinner - wsn" pattern.
5. Click **Hot Leads** — empty until classifier backfill produces OBJECTION/INTERESTED labels. (Out of scope; defer to a separate session that triggers `handleClassifyBatch`.)
6. Click **Spam** — empty until LLM flags one as SPAM. (Same backfill dependency.)
7. Set date "From" 2026-04-28 / "To" 2026-04-29 — only 04-28/29 threads shown. Clear → all-time view returns.
8. Direct-load `/dashboard/inbox?tab=hot-leads` — lands on Hot Leads. Active tab persists in URL.
9. "Load more" appears when total > 50; click loads next 50.
10. Open [`/dashboard/campaigns`](https://your-domain.com/dashboard/campaigns) — confirm no Snov column or Snov badge anywhere in the list (D2).

**Rollback:** UI/API only. `git revert <merge-commit>` + Vercel re-deploy. No DB change to undo, no worker action needed.

## 7. MEMORY.md proposed append (≤ 8 lines, dated)

```
*2026-04-29 — **Unibox UX overhaul shipped (PR #24 OPEN, UNMERGED).** Replaces 5-tab UX (All/Unread/Interested/Objections/Bounces) with locked 4-tab UX (All/Warm Up/Hot Leads/Spam). Root cause of "~1 hr of email visible": **no API cap exists** — page-1/per_page=50 default at `inbox-client.tsx:116-138` collides with the 04-29 sync-flood (435 new threads); top 50 ordered by `latest_message_date DESC` looks like a 1-hour window. Replaced with all-time default + HTML5 date-range picker (no new dep) + "Load more" pagination + URL-persisted active tab. **Tab routing as shipped:** All=NOT warm-up AND NOT spam (374 live); Warm Up=`subject ILIKE '%- wsn%'` OR all-participants-are-our-accounts (301 live, 44.6% of 675); Hot Leads=`latest_classification IN (OBJECTION,INTERESTED)` AND NOT warm-up AND NOT spam (0 live — backfill needed); Spam=conservative AND `latest_classification='SPAM' AND no external participant is a known sender` (0 live — DKIM signal absent in schema so the AND collapses to two-of-remaining + content per Dean's lock §1.4 fallback). Predicates extracted to `src/lib/inbox/tab-routing.ts` (138 LOC pure module); test suite `src/lib/inbox/__tests__/tab-routing.test.ts` pins 33 cases incl. multi-signal-AND spam invariant + bucket-partition exclusivity. test:gate0 25→26 suites. **D2 Snov UI cleanup:** dropped `snovio_id` from Campaign interface in `campaigns-client.tsx` (DB column stays). Files +7 / +966 / −134; PR #24 commits `c183f18` feat / `b2f1148` D2. Local: 26/26 gate0 PASS, typecheck 0 errors, build clean, saga-isolation `files-changed=0`. Reports: `dashboard-app/reports/2026-04-29-unibox-ux-design.md` + `dashboard-app/reports/2026-04-29-unibox-ux-fix-summary.md`. Hot Leads + Spam tabs sit ready; classifier backfill (`handleClassifyBatch` against the 318 unclassified inbox_messages) is the gate to populate them. Zero saga edits, zero `.gitignore`/serverless-steps.ts edits, zero auto-merge. Next: Dean review PR #24 → merge → Vercel auto-deploy (UI-only, no worker restart).*
```
