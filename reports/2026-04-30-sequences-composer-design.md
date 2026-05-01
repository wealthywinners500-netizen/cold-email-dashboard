# Sequences Composer UI — Phase 0 Design + HALT Surface (2026-04-30)

**Session:** CC #2 (V8 sequences-composer)
**Branch:** `claude/thirsty-bohr-d62b4b` (worktree)
**Status:** **HALT — re-scope required.** Spec assumed greenfield; ground-truth shows 1,311 LOC of pre-existing campaigns UI plus 857 LOC of pre-existing sequence/modal components (2,168 LOC total).

---

## §0. The HALT trigger (verbatim from prompt)

> "Greenfield assumption — verify in Phase 0: no existing `/dashboard/campaigns` UI surface. If Phase 0 finds substantial pre-existing UI (>200 LOC), HALT and re-scope to 'complete the missing pieces' instead of 'build greenfield.'"

> "HALT-on-scope-creep: if Phase 0 estimates more than 1000 LOC total touched, surface and split into CC #2a/#2b."

Both apply. Surfacing to V8.

---

## §1. Existing surface inventory (file-by-file LOC)

### Dashboard pages — `src/app/dashboard/campaigns/`
| File | LOC | What it does |
|---|---|---|
| `page.tsx` | 14 | Server component: `getCampaigns()` → `<CampaignsClient>` |
| `loading.tsx` | 17 | Loading skeleton |
| `campaigns-client.tsx` | 480 | List view: stats cards, recharts bar+pie, filters by region/status, full table. Uses `<CreateCampaignModal>` for create+edit+delete. Uses `useRealtimeRefresh("campaigns")`. |
| `[id]/page.tsx` | 56 | Server component: parallel fetch of `getCampaigns`, `getSequences`, `getLeadSequenceStates`, `getCampaignStats`, `getCampaignAnalytics`, `getDailySendVolume`, `getCampaignRecipientsForAnalytics` → `<CampaignDetailClient>` |
| `[id]/loading.tsx` | 41 | Loading skeleton |
| `[id]/campaign-detail-client.tsx` | 703 | 4-tab UI: Overview / Sequences / Recipients / Analytics. Sequences tab renders `<SequenceStepEditor readOnly={true}>` per sequence + `<SequenceFlowDiagram>`. Recharts everywhere. |
| **Subtotal** | **1,311** | |

### Components — `src/components/`
| File | LOC | What it does |
|---|---|---|
| `sequence/sequence-step-editor.tsx` | 321 | **The composer.** Step nav, A/B/C/D variant tabs, subject + body textareas, merge-field buttons (`{{first_name}}`, etc), add/delete steps, add variant. Fully wired both read AND write — but only ever called with `readOnly={true}` today. |
| `sequence/sequence-flow-diagram.tsx` | 109 | Visualization of primary→subsequence flow |
| `sequence/subsequence-trigger-editor.tsx` | 205 | Trigger UX for subsequences (Reply Classified / No Reply / etc) — **already exists**, scope-out per prompt |
| `modals/create-campaign-modal.tsx` | 222 | Create+edit+delete modal for `campaigns` table. Posts to `/api/campaigns` and `/api/campaigns/[id]`. Captures `name`, `region`, `store_chain`, `status`. |
| **Subtotal** | **857** | |

### Worker + lib (untouchable per NO-GO)
- `src/lib/email/sequence-engine.ts`, `src/worker/handlers/queue-sequence-steps.ts`, `src/worker/handlers/process-sequence-step.ts` — all exist; do NOT modify.

### API endpoints (read-only contract per NO-GO)
- `GET/POST /api/campaigns` — exist
- `GET/PATCH/DELETE /api/campaigns/[id]` — exist
- `GET/POST /api/campaigns/[id]/sequences` — exist; POST validates `persona` required, primary uniqueness, subsequence trigger required (verified at `route.ts:69-119`)
- `GET/PATCH/DELETE /api/campaigns/[id]/sequences/[seqId]` — assumed exist per spec; not re-verified

### Total pre-existing campaigns/sequences UI surface
**~2,168 LOC** in dashboard + components, fully integrated with API + types + queries + worker. History trail: `B5` (CRUD modals), `B8: Sequences + subsequences -- multi-step campaigns with conditional follow-ups`, `B10` (tracking), `B12` (polish), `B14` (RBAC + rate limiting).

---

## §2. The actual gap (what's missing vs what exists)

The original prompt's "build greenfield list+detail+composer" misreads the state. The infrastructure is built; **only the WRITE PATH for sequences is missing**:

### Gap 1 — Dead button at `campaign-detail-client.tsx:343-345`
```tsx
<button className="mt-4 px-4 py-2 bg-blue-600 ...">
  Create Sequence
</button>
```
No `onClick` handler. Renders only in the "no sequences yet" empty state. There's also no "+ New Sequence" button when sequences DO exist.

### Gap 2 — `SequenceStepEditor` never rendered in write mode
The composer component is fully built (321 LOC, write-capable: `handleAddStep`, `handleAddVariant`, `handleDeleteStep`, `handleStepChange`, `handleVariantChange`). Currently called only with `readOnly={true}` at `campaign-detail-client.tsx:265, 321`.

### Gap 3 — No SequenceComposerModal wrapper
There is no modal/page that:
- Wraps `<SequenceStepEditor readOnly={false}>`
- Adds inputs for sequence-level fields the API requires: `name`, `persona` (REQUIRED per `route.ts:81-86`), `sequence_type` (lock to "primary" for v1)
- POSTs to `/api/campaigns/[id]/sequences` (create) or PATCHes `/api/campaigns/[id]/sequences/[seqId]` (edit)
- Refreshes the parent on success

### Gap 4 — Sequence rows in detail page have no edit affordance
The collapsed/expanded sequence cards (lines 239-269 primary, 289-326 subsequences) only show the read-only editor. No "Edit" button to launch the composer modal pre-filled.

### Non-gaps (already done, do NOT touch)
- Nav integration: `dashboard/campaigns` already in nav (sidebar in `dashboard/layout.tsx`).
- List page: complete with stats/charts/filters.
- Detail page Overview/Recipients/Analytics tabs: complete.
- API contract: untouched per NO-GO.
- `getCampaigns`, `getSequences`, etc.: already in `src/lib/supabase/queries.ts`.

---

## §3. Recommended re-scope (proposal for V8)

**Option A — minimal "complete missing pieces" (RECOMMENDED, ~250-350 LOC new code)**

Ship the WRITE PATH only:

1. **NEW** `src/components/modals/sequence-composer-modal.tsx` (~200-250 LOC)
   - Radix Dialog wrapper (match `create-campaign-modal.tsx` pattern)
   - Inputs: `name` (required), `persona` (required), `sequence_type` locked to "primary" for v1
   - Embeds `<SequenceStepEditor steps={steps} onChange={setSteps} />` (write mode)
   - Submit: POST or PATCH; toast + `router.refresh()` on success; show field errors from API

2. **EDIT** `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` (~30-50 LOC delta)
   - Wire the existing dead button (line 343) → opens modal in CREATE mode (only enabled if no primary exists already)
   - Add "+ New Primary Sequence" button visible when no primary exists (replaces or supplements the empty-state button)
   - Add an "Edit" button on each sequence card → opens modal in EDIT mode pre-filled
   - Keep all read-only display in place; the modal is the only write surface

3. **NEW** test: `src/components/modals/__tests__/sequence-composer-modal.test.tsx` (~80-120 LOC)
   - Renders empty state → "Add step" present
   - Adding a step exposes A/B/C/D tabs (delegated to existing editor — light coverage only)
   - Persona empty + Submit → blocked with field error
   - Valid submit calls `fetch` with the documented JSON body shape
   - Edit mode pre-fills from passed sequence prop

**Total new code: ~310-420 LOC.** Well under 1000-LOC scope cap and 200-LOC pre-existing-UI gate (the gate compared to *new* greenfield code; we're now genuinely writing only what's missing).

**Option B — close the gap + also wire subsequences (NOT RECOMMENDED for v1)**
Add subsequence trigger UX (the existing `SubsequenceTriggerEditor` is built but unused). Out of scope per prompt: *"Subsequences out of scope for v1 (require trigger_event/trigger_condition UX which is its own session)."*

**Option C — abandon and confirm "no UI work needed"**
If V8's read on the STALE-STATE OVERRIDE is "the in-house sender doesn't exist *as a worker pipeline yet*" rather than "the UI doesn't exist," then the Phase 1 worker pipeline (CC #3 campaign-fire smoke) is the actual blocker, not this UI session. The pre-existing UI may be enough — Dean already has a way to view sequences if any exist.

---

## §4. Smoke plan (unchanged — works for Option A)

The Phase 5 smoke from the original prompt still applies as written:
- `INSERT [V8_SMOKE_COMPOSER]` campaign
- `INSERT [V8_SMOKE_COMPOSER]` sequence with 1 step × 4 variants
- DB read-back (probe 1)
- Vercel route probe (probe 2)
- Existing tabs regression probe (probe 4)
- DELETE both rows

Plus an additional probe for Option A:
- **Probe 5 (new):** `grep -r "sequence-composer-modal" .next/static/chunks/` confirms the new component shipped in the build (or check via Vercel build logs).

---

## §5. Decision needed from V8

1. Confirm Option A (recommended). Re-author CC #2 prompt with the narrower scope, OR authorize this session to proceed under Option A immediately given auto-mode is active and the spec already has a clean re-scope path.
2. OR confirm Option C. If the UI gap isn't actually blocking the next milestone, close this session $0-spent and route to CC #3.
3. OR a third option I missed.

This design doc is the only artifact written so far this session. No code changed. No DB writes. No commits.

---

## Appendix — Verbatim evidence

### Dead button
`src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx:339-347`
```tsx
{sequences.length === 0 && (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <Mail className="w-12 h-12 text-gray-600 mb-4" />
    <p className="text-gray-400">No sequences created yet</p>
    <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
      Create Sequence
    </button>
  </div>
)}
```

### Read-only editor calls
`src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx:262-266` (primary)
```tsx
<SequenceStepEditor
  steps={primarySequence.steps}
  onChange={() => {}}
  readOnly={true}
/>
```

### Editor write capabilities (already implemented)
`src/components/sequence/sequence-step-editor.tsx:96-116` (handleAddStep), `:62-85` (handleAddVariant), `:34-42` (handleStepChange), `:44-60` (handleVariantChange) — all real, all gated only by the `readOnly` flag.

### POST API contract (verified)
`src/app/api/campaigns/[id]/sequences/route.ts:69-119`
- Required body fields: `name`, `sequence_type`, `persona`, `steps`
- Optional: `trigger_event`, `trigger_condition`, `trigger_priority`
- Validations: persona required (400), primary uniqueness (400), subsequence requires trigger fields (400)
