# CC #UI-4 — Phase 0 Design Doc

**Date:** 2026-05-02 (V10)
**Branch:** `feat/ui-4-subsequence-crud-followups-2026-05-02`
**Worker baseline:** unchanged (no worker edits this CC)
**Main HEAD pre-session:** `02fe39a` (PR #55 — CC #UI-3.5 deploy report)

---

## 1. Gap Confirmation (§0.2 results)

| Check | Expected | Actual | Status |
|---|---|---|---|
| A: subsequence refs in `follow-ups-client.tsx` | 0 | 0 | ✓ Gap real |
| B: `/api/follow-ups/subsequences/` exists | ABSENT | ABSENT | ✓ Endpoint to create |
| C: `campaign-detail-client.tsx` subsequence refs | ≤1 | 0 | ✓ Fully removed by CC #UI-3-rev |
| D: `SequenceComposerModal` accepts `sequenceType` | YES | YES (CC #UI-2 shipped) | ✓ Wiring exists |
| E: DELETE endpoint for sequences | exists or scope-add ~30 LOC | EXISTS (with active-leads guard) | ✓ Reusable |

**No HALT triggered.** Slight deviation from prompt expectation §0.2.C (expected breadcrumb=1, found 0) — fewer subsequence refs than predicted is *less* work, not more, and not a HALT condition.

## 2. Existing follow-ups page tab structure

`follow-ups-client.tsx` (380 LOC) renders:
- A `Tabs` component with `<TabsList className="grid w-full grid-cols-3 bg-gray-800">`
- 3 `<TabsTrigger>` entries: `group-a`, `group-b`, `group-c`
- 3 `<TabsContent>` panels with table layouts
- `useRealtimeRefresh("follow_ups")` hook
- Empty state when `followUps.length === 0` (renders early-return)

**Insertion point for Subsequences tab:**
- Change `grid-cols-3` → `grid-cols-4`
- Add `<TabsTrigger value="subsequences">` after group-c
- Add `<TabsContent value="subsequences">` panel after group-c content
- Empty-state early-return must NOT short-circuit when followUps=0 but subsequences>0 — adjust to render subsequences-only mode

## 3. New file paths + LOC budget

| Path | Action | LOC est. |
|---|---|---|
| `src/app/api/follow-ups/subsequences/route.ts` | NEW | ~50 |
| `src/components/sequence/campaign-picker.tsx` | NEW | ~80 |
| `src/app/dashboard/follow-ups/follow-ups-client.tsx` | EDIT | +200 / -10 |
| `src/app/dashboard/follow-ups/page.tsx` | EDIT | +12 / -5 |
| `src/lib/supabase/queries.ts` | EDIT | +25 (new fn) |
| `src/components/modals/sequence-composer-modal.tsx` | EDIT | +60 / -10 |
| Tests (3 files) | NEW | ~150 |
| Reports (3) | NEW | n/a |
| **Total source** | | **~570 LOC** ≤ 600 budget |

## 4. Routing/wiring matrix

| User action | Code path | Endpoint hit |
|---|---|---|
| Open `/dashboard/follow-ups` | `page.tsx` server-fetches `getOrgSubsequences()` + `getCampaigns()` alongside `getFollowUps()` | n/a (server) |
| Click "Subsequences" tab | `setActiveTab("subsequences")` in client component | n/a |
| Click "+ New Subsequence" | `setComposerOpen(true)` + `setEditingSubseq(null)` | n/a |
| Modal renders w/ `campaignId={null}, sequenceType="subsequence"` | Modal renders `<CampaignPicker>` at top | n/a |
| Pick campaign + fill + submit | Modal POSTs to `/api/campaigns/<picked>/sequences` | POST `/api/campaigns/[id]/sequences` |
| Click Edit on row | `setEditingSubseq(row)` + open modal w/ `campaignId={row.campaign_id}` | n/a |
| Modal in edit: picker is `disabled={true}` | Lock prevents campaign re-attach | n/a |
| Save edit | PATCHes `/api/campaigns/<id>/sequences/<seqId>` | PATCH `/api/campaigns/[id]/sequences/[seqId]` |
| Click Delete on row | confirm dialog → `fetch(..., {method:"DELETE"})` | DELETE `/api/campaigns/[id]/sequences/[seqId]` |

## 5. Verbatim before/after — `SequenceComposerModalProps`

**Before** (sequence-composer-modal.tsx:47-55):
```ts
interface SequenceComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  mode: ComposerMode;
  sequenceType?: SequenceType;
  existingSequence?: CampaignSequence;
  onSuccess?: (seq: CampaignSequence) => void;
}
```

**After**:
```ts
interface SequenceComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string | null;          // CC #UI-4: nullable for org-scoped subsequence creation flow
  mode: ComposerMode;
  sequenceType?: SequenceType;
  existingSequence?: CampaignSequence;
  campaigns?: Array<{ id: string; name: string; status: string }>;  // CC #UI-4: feeds <CampaignPicker> when campaignId=null
  onSuccess?: (seq: CampaignSequence) => void;
}
```

`pickedCampaignId` internal state initializes from `props.campaignId` and feeds `endpointFor(mode, pickedCampaignId, ...)`. Validation rejects submit when `pickedCampaignId === null`.

## 6. Tests to add

### `src/app/dashboard/follow-ups/__tests__/follow-ups-client.test.ts` (NEW)
- File contains `value="subsequences"` (new tab trigger)
- File contains `grid-cols-4` (tab list expanded)
- File contains `+ New Subsequence` button label
- File imports `SequenceComposerModal`
- Subsequences list maps over `subsequences` prop
- Delete handler URL: `/api/campaigns/${...}/sequences/${...}` with `method: "DELETE"`
- Edit handler sets `editingSubseq` state

### `src/app/api/follow-ups/subsequences/__tests__/route.test.ts` (NEW)
- File contains `export async function GET`
- File queries `campaign_sequences` with filter on `sequence_type`
- File returns 401 on no orgId
- File filters by `org_id`

### `src/components/modals/__tests__/sequence-composer-modal.test.ts` (NEW)
- File imports `CampaignPicker`
- Modal conditionally renders `CampaignPicker` when `campaignId === null && sequenceType === 'subsequence'`
- Modal passes `disabled` prop to picker based on edit mode
- Submit URL constructed from `pickedCampaignId` (not `props.campaignId`)

## 7. Migration needed

**N.** No schema changes. `campaign_sequences.campaign_id` stays NOT NULL. CC #UI-5 will migrate to nullable + add `applies_to_*` columns.

## 8. Persona note

Persona is required by `validateComposerInput()` at `sequence-composer-helpers.ts:83-85` for primary sequences AND `sequence-composer-helpers.ts:111-113` for subsequences. Field is unused functionally per V10 grep — not consumed by sequence-engine.ts. Schema unchanged this CC. Modal already prompts for it inside `<SubsequenceTriggerEditor>`. Will add help text only inside that editor (NOT modifying the editor — adding via parent context block in modal). DECISION: leave validation rule + UX as-is since `<SubsequenceTriggerEditor>` already shows persona input; no scope creep needed.

## 9. MXToolbox-impact assertion

**Untouched.** Zero changes to:
- `src/lib/email/`
- `src/lib/provisioning/`
- `panel-sidecar/`
- worker handlers
- DNS records
- SMTP config
- Sender pipeline

Saga isolation expected to grep empty.

## 10. Risks + mitigations (top 5)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Empty-state early-return in `follow-ups-client.tsx` short-circuits before subsequences render | Refactor early-return to require BOTH `followUps.length===0 && subsequences.length===0` |
| 2 | CampaignPicker fetches campaigns separately and races with modal mount | Pass campaigns list down as prop from server-side `page.tsx` (one fetch, no race) |
| 3 | Modal's `endpointFor()` helper requires non-null campaignId; passing null breaks | Resolve `pickedCampaignId` *before* calling `endpointFor`; validation gate prevents submission when null |
| 4 | DELETE endpoint blocks deletion of subsequences with active leads | Acceptable — defensive; surface as toast error to user |
| 5 | Existing CC #UI-2 subsequence smoke artifact (`smoke-subseq` row) appears in list | Acceptable — it's a real test row; user can delete via new UI |

## 11. Dean verification steps (post-deploy)

Documented in deploy report; mirror Phase 7.1 of the prompt.

---

**Phase 0 GREEN.** Proceeding to Phase 1.
