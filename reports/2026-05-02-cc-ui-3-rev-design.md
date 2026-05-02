# CC #UI-3-rev — Design (2026-05-02)

**Prompt-author:** V10 Master Cowork session, 2026-05-02
**Branch:** `feat/ui-3-rev-instantly-layout-2026-05-02`
**Worktree:** `.claude/worktrees/heuristic-nash-e55e30`
**Main HEAD pre-work:** `5b5e0b2` (PR #52 docs merge)
**LOC budget:** 500 (hard ceiling 650). Estimated: ~280 LOC.

---

## 1. Worker baseline + main HEAD

- `origin/main` HEAD: `5b5e0b2` — PR #52 (CC #UI-3 deploy report). Last code change: `6a0a424` (PR #51, builder completion).
- Worker (200.234.226.226): not relevant to this CC; no handler/saga/sender-pipeline changes planned.

## 2. PR #51 file diff summary

PR #51 (`6a0a424`) shipped 4 of 5 audit-confirmed gaps. Files & LOC:

| Path | +/- |
|---|---|
| `package.json` | +1 -1 |
| `reports/2026-05-02-cc-ui-3-design.md` | +257 |
| `reports/2026-05-02-cc-ui-3-pr-body.md` | +68 |
| `src/app/api/lead-contacts/import-to-campaign/route.ts` | +3 |
| `src/app/dashboard/campaigns/[id]/__tests__/campaign-detail-client.test.ts` | +126 |
| `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` | +170 -8 |
| `src/components/modals/__tests__/recipients-upload-modal.test.ts` | +102 |
| `src/components/modals/__tests__/send-schedule-modal.test.ts` | +114 |
| `src/components/modals/recipients-upload-modal.tsx` | +243 |
| `src/components/modals/send-schedule-modal.tsx` | +310 |

**Verified shipped in `campaign-detail-client.tsx` (current 935-line file):**
- Start Campaign button (lines 226-244, calls `/api/campaigns/${id}/send` POST)
- Pause/Resume button (lines 203-224, PATCH `/api/campaigns/${id}` `{status}`)
- Schedule editor modal — Edit Schedule button at line 344-352, modal mount line 921-926
- Recipients upload modal — Add Recipients button line 552-558, mount line 928-932
- Subsequences edit + new buttons (lines 441-522)

**Verified NOT shipped by PR #51:**
- Email account picker — PR #51 commit message states: *"Sub-feature E (email account picker) HALTED — campaigns.assigned_account_id does not exist; that column lives on campaign_recipients + lead_sequence_state for sequence-engine round-robin."*
- Tags input — also not shipped.

## 3. Schema gaps — VERIFIED via direct pg query

Connected via Vercel-stored `DATABASE_URL` (env id `X2Xjg3qtO5sjIvqb`, port 6543 transaction-pooler). Result:
- `campaigns` has 37 columns (verified full list).
- `campaigns.tags` — **MISSING** ✓ (REST returns `column "campaigns.tags" does not exist`).
- `campaigns.assigned_account_id` — **MISSING** ✓ (REST returns `column "campaigns.assigned_account_id" does not exist`).
- `sending_schedule` — present (jsonb).
- 10 campaigns total (8 active, 2 archived). **0 in `sending` status** — safe baseline.

## 4. Migration numbering — CORRECTED

Prompt assumed migrations 027/028. Ground-truth: max migration is **024**. Next available:
- `025_add_campaigns_tags.sql`
- `026_add_campaigns_assigned_account_id.sql`

## 5. Threading wiring — ADAPTATION

Prompt §1.2 assumed `src/lib/email/threading.ts` exists with `buildReplyHeaders` export. **Ground-truth:**
- `src/lib/email/threading.ts` **does NOT exist**. The closest file is `src/lib/email/email-threader.ts` which exports `assignThread()` for **inbound** IMAP threading only (used in `imap-sync.ts:150`).
- Outbound threading is already wired **inline** at `src/worker/handlers/process-sequence-step.ts:158-166`:
  ```ts
  if (step.send_in_same_thread && state.last_message_id) {
    if (!finalSubject.toLowerCase().startsWith("re:")) finalSubject = `Re: ${finalSubject}`;
    threadingHeaders["In-Reply-To"] = state.last_message_id;
    threadingHeaders["References"] = state.last_message_id;
  }
  // applied at line 182 via Object.assign(extraHeaders, threadingHeaders)
  ```
- This is functionally equivalent to what `buildReplyHeaders` would have done. **§1.2 wire-fix is SKIPPED — there is no gap to close.** Document & move on.

## 6. Current 4-tab structure (line ranges in worktree's 935-line file)

| Tab | Trigger | Content lines |
|---|---|---|
| Overview | 252-257 | 278-376 (Stats grid + Schedule Info card with Edit Schedule button) |
| Sequences | 258-263 | 378-544 (Primary card + Subsequences section + Flow diagram) |
| Recipients | 264-269 | 546-646 (Add Recipients button + recipients table) |
| Analytics | 270-275 | 648-907 (stats cards + charts + recipient table) |

Header (lines 187-247): Title, badges, **Pause/Resume + Start Campaign buttons** (action cluster lives here pre-rev).

## 7. Target 5-tab structure

| New tab | Source | Notes |
|---|---|---|
| `analytics` (default) | Existing Analytics tab content (lines 648-907) | Unchanged content |
| `leads` | Existing Recipients tab content (lines 546-646) | Renamed label "Leads"; same content + same Add Recipients button |
| `sequences` | Primary sequence + flow diagram only (lines 378-439, 525-543) | **DELETE Subsequences section (lines 441-522, ~82 LOC)** |
| `schedule` | Schedule Info card (lines 339-375) | Move from Overview to dedicated tab; preserve Edit Schedule button + modal |
| `options` | Existing header buttons + new Tags input | Move Pause/Resume + Start from header (lines 202-245) into a card here. Add Tags input. Show name/region/store_chain/status as readable metadata. |

**Default tab:** `analytics` (matches Instantly's first tab).

**URL persistence:** `useSearchParams` + `router.replace(?tab=...)` ~15 LOC.

## 8. Subsequences deletion

Lines 441-522 (the entire Subsequences section block including header, "+ New Subsequence" button, mapped Card list with Edit buttons, triggerLabel logic). Net deletion ~82 LOC.

State `subsequences = sequences.filter(s => s.sequence_type === "subsequence")` (line 120) becomes unused — DELETE.

`composerState.sequenceType: "primary" | "subsequence"` — KEEP, but `setComposerState({...sequenceType: "subsequence"...})` calls disappear with the section. The "primary" path remains for editing the primary sequence.

## 9. Sidebar reorder (`src/app/dashboard/layout.tsx`)

Current order (verified lines 24-80): Overview, Servers, Email Accounts, Inbox, **Campaigns, Leads,** Follow-Ups, SMS, Provisioning, Settings, Admin.

Target: Overview, Servers, Email Accounts, Inbox, **Leads, Campaigns,** Follow-Ups, SMS, Provisioning, Settings, Admin (Leads and Campaigns swapped).

LOC: net 0 (re-ordering object literals).

## 10. Files to touch + LOC estimate

| Path | Δ LOC | Notes |
|---|---:|---|
| `supabase/migrations/025_add_campaigns_tags.sql` | +5 | NEW |
| `supabase/migrations/026_add_campaigns_assigned_account_id.sql` | +5 | NEW; future-use, no UI yet (account picker deferred to CC #UI-4 with sequence-engine refactor) |
| `src/lib/supabase/types.ts` | +2 | Add `tags: string[]` and `assigned_account_id: string \| null` to `Campaign` |
| `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` | net ~+50 / -82 (~+130 added inserts, -82 deletions) | 4→5 tab refactor |
| `src/app/dashboard/layout.tsx` | 0 net | Reorder Leads above Campaigns |
| `src/app/dashboard/campaigns/[id]/__tests__/campaign-detail-client.test.ts` | +30 | Extend with new-tab assertions + sidebar order + no-Subsequences |
| **Total** | ~280 LOC | Well under 500 ceiling |

## 11. Per-file rollback isolation

- **Migrations** are additive (`ADD COLUMN IF NOT EXISTS`). On rollback, columns persist (no data corruption); UI rollback removes any writes.
- **types.ts** rollback: just drop the 2 new properties.
- **campaign-detail-client.tsx** rollback: full file revert via `git revert -m 1 <merge_sha>`.
- **layout.tsx** rollback: revert.
- **test file** rollback: revert.

Each file is independently revertable — no cross-file dependencies that would force a cascading rollback.

## 12. Risks + mitigations (top 5)

1. **Account picker premise was wrong** — Prompt assumed PR #51 shipped account picker UI to "relocate". It did NOT. **Mitigation:** Skip account picker entirely. Ship the migration column for future use; document in PR body and report. CC #UI-4 will add the picker + sequence-engine consumer.
2. **Threading wire-fix premise was wrong** — `threading.ts` doesn't exist; threading IS already wired inline. **Mitigation:** Skip §1.2; document in design + PR body.
3. **Existing 8 active campaigns will get `tags=[]` default** — Migration 025 sets `DEFAULT '{}'`. No data loss; UI shows empty chip list. Backwards-compatible.
4. **Default tab change Overview→Analytics** could surprise users. **Mitigation:** URL `?tab=` param lets users bookmark a specific tab. Documented in deploy report.
5. **CC #UI-4 will rebuild Follow-Ups page** — current page exists. Subsequences-section deletion in Sequences tab does NOT touch follow-ups page. CC #UI-4 will surface subsequences cross-campaign there.

## 13. MXToolbox + DNS impact

**Untouched.** No DNS changes, no domain mutation, no MXToolbox-relevant behavior touched. Pure UI + 2 additive schema columns.

---

## Adaptations from prompt (corrections)

| Prompt assumption | Ground-truth | Action |
|---|---|---|
| Migrations 027 + 028 | Max migration is 024 | Use 025 + 026 |
| `threading.ts` exports `buildReplyHeaders`; not wired | File doesn't exist; outbound threading wired inline at process-sequence-step.ts:158-166 | Skip §1.2 wire-fix |
| PR #51 PATCHes `campaigns.tags` & `assigned_account_id` (silent breakage) | PR #51 explicitly halted account picker & did not ship tags input | Migrations are still useful (as future-use + new tags input UI); not "fixing silent breakage" because there isn't any |
| "Account picker shipped by PR #51 — relocate to Options tab" | Account picker NOT shipped by PR #51 | Skip account picker UI in this CC; defer to CC #UI-4 |

These adaptations preserve the spirit of LOCKED DECISIONS 1, 2, 3, 4, 5 (migrations + 5-tab layout + content distribution + subsequences-removal + sidebar reorder) while correcting the false premises in 6 (threading wire) and the account-picker assumption in 3.

## Smoke probe adaptations

- Probe 4 (`assigned_account_id` PATCH): kept — PATCH the migrated column even though no UI consumes it; verifies the migration landed.
- Probe 8 (Start button safety): unchanged — `email_send_log = 0` for smoke campaign is non-negotiable.
- Probe 7 (sidebar bundle grep): rely on Phase 2 source-grep test as planned.

## GO/NO-GO

GO — proceed to Phase 1 with the adaptations above.
