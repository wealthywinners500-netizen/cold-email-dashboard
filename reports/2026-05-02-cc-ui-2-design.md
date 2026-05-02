# CC #UI-2 — Phase 0 Design Doc — Subsequence UI wire-up

**Date:** 2026-05-02
**Branch (worktree):** `claude/hopeful-sanderson-5dfeca` → push as `feat/ui-2-subsequence-wireup-2026-05-02`
**Main HEAD at session start:** `a7945e5` (post PR #48)
**Status:** Phase 0 §0.2 RE-VERIFIED — wire-up gap is REAL on current main. All 5 checks confirm work is needed.

---

## 1. Phase 0 §0.2 re-verify results (the load-bearing check)

The CC #UI-1 lesson: **never trust audit data that wasn't re-verified live in the same session.** Phase 0.2 ran 5 fresh greps against current main (`a7945e5`) before writing any code:

| Check | Expectation | Actual | Status |
|---|---|---|---|
| A. `SubsequenceTriggerEditor` imported anywhere | Only its own definition (dead code) | Only at `src/components/sequence/subsequence-trigger-editor.tsx:6,36,42` (definition + interface only) | ✅ Still dead |
| B. `SequenceComposerModal` accepts `sequence_type` | NO — currently only takes `mode` (create\|edit) | Confirmed: `mode: ComposerMode` only; line 167 says verbatim "Sequence type: primary — subsequences are authored separately." | ✅ Still primary-only |
| C. `buildCreatePayload` hardcodes primary | YES — at `sequence-composer-helpers.ts:66` | Confirmed: `sequence_type: "primary"` literal, no override | ✅ Still hardcoded |
| D. `+ New Subsequence` button on detail page | Zero matches | Zero matches across "Add Subsequence", "New Subsequence", "Create Subsequence" | ✅ Missing |
| E. API route accepts subsequence | YES with validation | `route.ts:108-119` requires `trigger_event` + `trigger_condition` when `sequence_type==='subsequence'`; persists all 4 trigger fields at lines 128-131 | ✅ Backend ready |

**Verdict:** wire-up is real, not stale-audit drift. Proceed to Phase 1.

**Helpers path correction:** the prompt referenced `src/lib/sequence/sequence-composer-helpers.ts` — actual path is `src/components/modals/sequence-composer-helpers.ts` (co-located with the modal it serves). Same file, different location. Tests live at `src/components/modals/__tests__/sequence-composer-helpers.test.ts`.

---

## 2. Schema findings (Phase 0.4)

`campaign_sequences` columns from PostgREST OpenAPI:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid | no (PK) | |
| org_id | text | no | RLS scope |
| campaign_id | uuid | no (FK) | |
| name | varchar | no | |
| sequence_type | varchar | yes | 'primary' \| 'subsequence' |
| sort_order | int | yes | |
| trigger_event | varchar | **YES** | NULL for primary |
| trigger_condition | jsonb | **YES** | NULL for primary |
| trigger_priority | int | **YES** | NULL for primary |
| persona | varchar | yes | API rejects NULL/empty for create |
| steps | jsonb | yes | |
| status | varchar | yes | |
| created_at, updated_at | timestamptz | yes | |

✅ `trigger_event`, `trigger_condition`, `trigger_priority` are nullable — primary creation continues working unchanged. NO MIGRATION NEEDED.

**Live row count (production, 2026-05-02 query):** 0 primary, 0 subsequence campaign_sequences rows. Clean slate — no legacy data to migrate or worry about. (The 21-row CC #UI-1 dataset is in `lead_contacts` / `lead_lists`, a different table.)

---

## 3. Files to touch

| File | LOC delta | Reason |
|---|---|---|
| `src/components/modals/sequence-composer-modal.tsx` | ~+50 | Accept `sequenceType` prop; conditionally render `SubsequenceTriggerEditor`; branch title; pass triggerConfig to helpers |
| `src/components/modals/sequence-composer-helpers.ts` | ~+70 | Extend `buildCreatePayload`/`buildUpdatePayload`/`validateComposerInput` for subsequence mode; add display→snake_case mapper |
| `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` | ~+40 | `+ New Subsequence` button + Edit button on each subsequence card; subsequence trigger label switch to snake_case keys |
| `src/components/modals/__tests__/sequence-composer-helpers.test.ts` | ~+170 | Subsequence-shape assertions + new modal/detail-page contract greps; existing primary tests stay passing |
| `package.json` | 0 | Test file already in `test:gate0` (it's the same file we're extending) |

**Total LOC budget:** ≤350. Current estimate: ~330. Within budget.

---

## 4. Routing/wiring matrix

| Step | What happens | Where |
|---|---|---|
| 1 | User clicks `+ New Subsequence` | `campaign-detail-client.tsx` near line 305 (subsequences section header — always rendered now, not gated on `subsequences.length > 0`) |
| 2 | Sets composer state `{ open:true, mode:'create', sequenceType:'subsequence' }` | `composerState` extended with `sequenceType` |
| 3 | `<SequenceComposerModal>` opens with `sequenceType='subsequence'` | Modal renders `<SubsequenceTriggerEditor>` ABOVE `<SequenceStepEditor>` |
| 4 | User fills trigger event + condition + priority; trigger editor onChange updates modal state `triggerConfig` | Existing `SubsequenceTriggerEditor` consumed unchanged |
| 5 | User adds steps with A/B/C/D variants in existing `SequenceStepEditor` | Existing component, no change |
| 6 | Submit → `buildCreatePayload(input, 'subsequence', triggerConfig)` | Helper builds `{ name, persona, sequence_type:'subsequence', trigger_event:<snake_case>, trigger_condition, trigger_priority, steps }` |
| 7 | POST `/api/campaigns/[id]/sequences` with body | Existing route validates and persists |
| 8 | Row inserts with `sequence_type='subsequence'` + `trigger_event='reply_classified'` (etc.) | DB |
| 9 | Next time `handleReply()` fires for a classified reply on this campaign | `sequence-engine.ts:337` query `eq('trigger_event','reply_classified')` matches our row, queues step 1 |

---

## 5. Function signatures (before/after, verbatim)

### `SequenceComposerModalProps`

**Before:**
```ts
interface SequenceComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  mode: ComposerMode;
  existingSequence?: CampaignSequence;
  onSuccess?: (seq: CampaignSequence) => void;
}
```

**After:**
```ts
interface SequenceComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  mode: ComposerMode;
  sequenceType?: SequenceType;          // NEW: default 'primary'; for edit, inferred from existingSequence.sequence_type
  existingSequence?: CampaignSequence;
  onSuccess?: (seq: CampaignSequence) => void;
}
```

### `buildCreatePayload`

**Before:**
```ts
export function buildCreatePayload(input: ComposerInput): {
  name: string;
  persona: string;
  sequence_type: "primary";
  steps: SequenceStep[];
}
```

**After:**
```ts
export function buildCreatePayload(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): CreatePayload  // discriminated by sequence_type
```

Returns:
- For `sequenceType==='primary'`: `{ name, persona, sequence_type:'primary', steps }` — UNCHANGED for backward compat
- For `sequenceType==='subsequence'`: `{ name, persona, sequence_type:'subsequence', trigger_event:<snake_case>, trigger_condition, trigger_priority, steps }`

### `buildUpdatePayload`

**Before:**
```ts
export function buildUpdatePayload(input: ComposerInput): { name; persona; steps }
```

**After:**
```ts
export function buildUpdatePayload(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): UpdatePayload
```

Returns:
- For primary: `{ name, persona, steps }` — UNCHANGED
- For subsequence: `{ name, persona, trigger_event, trigger_condition, trigger_priority, steps }` (PATCH route accepts these per `[seqId]/route.ts`)

### `validateComposerInput`

**Before:**
```ts
export function validateComposerInput(input: ComposerInput): ComposerErrors
```

**After:**
```ts
export function validateComposerInput(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): ComposerErrors
```

Errors structure extends to include `trigger_event`, `trigger_condition`, `trigger_priority`. Existing primary callers see no change.

---

## 6. Display → snake_case trigger_event mapping

**The key crux:** `SubsequenceTriggerEditor` emits display strings (`"Reply Classified"`, `"No Reply"`, `"Opened"`, `"Clicked"`). The backend `sequence-engine.ts` queries snake_case (`'reply_classified'`, `'no_reply'`). With ZERO existing rows in production (verified §2 above), the canon is set NOW. Helpers persist as snake_case; display layer reads snake_case.

```ts
const TRIGGER_EVENT_TO_DB: Record<string, string> = {
  "Reply Classified": "reply_classified",
  "No Reply":         "no_reply",
  "Opened":           "opened",
  "Clicked":          "clicked",
};
```

`campaign-detail-client.tsx:308-314` switches: `seq.trigger_event === "Reply Classified"` → `seq.trigger_event === "reply_classified"`. Same for "No Reply"→"no_reply".

---

## 7. Tests to add

Extend `src/components/modals/__tests__/sequence-composer-helpers.test.ts` (single file, currently in `test:gate0`).

**Update existing primary test to be backward-compat assertion (line 124, 132):** keep them green by calling without 2nd arg → defaults to primary.

**New assertions:**

| # | Section | Assertion |
|---|---|---|
| 1 | helpers — payload | `buildCreatePayload(input, 'subsequence', triggerConfig)` returns `sequence_type:'subsequence'` |
| 2 | helpers — payload | Subsequence payload includes `trigger_event` (snake_case), `trigger_condition`, `trigger_priority` |
| 3 | helpers — payload | "Reply Classified" → `reply_classified`; "No Reply" → `no_reply`; "Opened" → `opened`; "Clicked" → `clicked` |
| 4 | helpers — payload | `buildCreatePayload(input)` (no 2nd arg) returns `sequence_type:'primary'` (backward-compat regression) |
| 5 | helpers — validation | `validateComposerInput(input, 'subsequence', { trigger_event:'No Reply', trigger_condition:{ days:0 } })` → error (days must be ≥1) |
| 6 | helpers — validation | `validateComposerInput(input, 'subsequence', { trigger_event:'Reply Classified', trigger_condition:{ classification:'INTERESTED' }, trigger_priority:1, persona:'sub' })` → success |
| 7 | helpers — validation | `validateComposerInput(input, 'subsequence', null)` → error (triggerConfig required) |
| 8 | helpers — round-trip | build → parse → matches input |
| 9 | helpers — buildUpdatePayload | Subsequence update includes the 3 trigger fields |
| 10 | helpers — endpointFor | Existing `endpointFor("create", id)` works for both modes (single endpoint) |
| 11 | modal source-grep | `SubsequenceTriggerEditor` IS imported in `sequence-composer-modal.tsx` |
| 12 | modal source-grep | Modal title contains "New Subsequence" or "Edit Subsequence" |
| 13 | modal source-grep | `<SubsequenceTriggerEditor` JSX present (gated by `sequenceType==='subsequence'`) |
| 14 | modal source-grep | Modal still renders title "New Primary Sequence" (regression check) |
| 15 | detail-page source-grep | Detail page contains `+ New Subsequence` button text |
| 16 | detail-page source-grep | Detail page sets `sequenceType:'subsequence'` in composerState |
| 17 | detail-page source-grep | Subsequences section trigger labels read `'reply_classified'`/`'no_reply'` (snake_case canon enforced) |

---

## 8. Migration needed

**N — zero schema change.** All required columns + nullability already in place per §2.

---

## 9. Pacing / rate-limit approach

**N/A.** No LLM batches. No high-volume DB writes. The smoke does ~3 INSERTs total. Phase 5 Probe 4 includes one campaign + one primary + one subsequence INSERT.

---

## 10. MXToolbox-impact assertion

**`untouched`** — this CC has zero DNS / panel / sidecar / SMTP / sender-pipeline contact. Saga-isolation grep at Phase 3 will confirm zero diff under `provisioning/`, `email/smtp-manager.ts`, `email/error-handler.ts`, `email/imap-sync.ts`, `email/sequence-engine.ts`, `panel-sidecar/`. `package.json` only changes if test wiring needs it (currently it doesn't — same file already wired).

---

## 11. Smoke artifact lifecycle

1. **Pre-create** smoke campaign `CC-UI-2-smoke-test` via direct Supabase REST (`Authorization: Bearer SERVICE_ROLE_KEY`).
2. Pre-create primary sequence on it (subsequence rendering depends on having a primary in some flows, plus it gives us regression coverage of the unchanged primary-shape).
3. **Create** subsequence on it via direct Supabase REST with snake_case trigger_event — this is the ground-truth shape we're committing to.
4. **Read back** + verify exact shape match.
5. **Mark archived** at end via `PATCH campaigns?id=eq.<id> { status:'archived' }`.

**NO DELETE on any row.** The smoke campaign's primary + subsequence rows stay as durable evidence the canon is correct. The campaign is `archived` so it doesn't pollute Dean's active list.

---

## 12. Risks + mitigations (ranked)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Existing primary creation breaks because modal mode-handling diverges | medium | high | Backward-compat tests (assertion #4); helper default-arg semantics; primary-mode source-grep regression check (#14); Phase 5 Probe 5 reads 5 existing primary rows (today =0; future check defends against drift) |
| 2 | Display-string vs snake_case mismatch leaves new subsequences un-labeled | low (zero existing rows) | medium | §6 mapping in helper; assertion #17; campaign-detail-client.tsx update |
| 3 | Submit handler sends wrong shape for subsequence | medium | high | Helper unit tests #1-#3; Phase 5 Probe 4 end-to-end create + read-back asserts exact shape match |
| 4 | API route's primary-uniqueness check (route.ts:91-106) blocks legitimate subsequence creation | low | medium | The check is gated on `sequence_type==='primary'` — subsequences pass through; Phase 5 Probe 4 proves a subsequence creates next to an existing primary |
| 5 | `SubsequenceTriggerEditor` `onChange` doesn't fire for "Opened"/"Clicked" because they have no condition fields | low | low | Editor calls `onChange` immediately on event change with `condition: {}` (line 60-67) — works |
| 6 | `validateComposerInput` doesn't get triggerConfig because state isn't updated by editor before submit | low | medium | Editor fires onChange on every field change AND on event-change; modal's submit handler reads latest triggerConfig |
| 7 | TypeScript discriminated-union mismatch on `CreatePayload` | low | low | Single union return type; tsc --noEmit at Phase 3 catches |
| 8 | Tests' string regex too strict and break on whitespace | low | low | Use flexible regex; assertion strings don't pin exact whitespace |

---

## 13. NO-GO compliance preview

| # | Constraint | Status |
|---|---|---|
| 1 | No `src/lib/provisioning/` edits | ✅ |
| 2 | No `provision-*`, `pair-verify`, `rollback-*` worker handlers | ✅ |
| 3 | No `.gitignore` or `serverless-steps.ts` | ✅ |
| 4 | No `src/lib/email/{smtp-manager,error-handler,imap-sync,sequence-engine}.ts` | ✅ |
| 5 | No `smtp-connection-monitor.ts` / `sidecar-health-monitor.ts` | ✅ |
| 6 | No `panel-sidecar/` | ✅ |
| 7 | No new migration; no DELETE on DB rows (UPDATE OK on smoke campaign status) | ✅ |
| 8 | No DNS/panel/sender changes | ✅ |
| 9 | No `git add -A` | ✅ — specific paths only |
| 10 | No secret printing | ✅ |
| 11 | Append-only ≤8-line MEMORY.md entry | ✅ — Phase 7 |
| 12 | No call to `/api/campaigns/[id]/send`; no `campaigns.status='sending'` | ✅ — only `archived` on smoke |

---

## 14. Auto-merge criteria recap

Auto-merge ONLY if (per Phase 3+4):
- typecheck = 0 errors
- build = clean
- `test:gate0` = all green (incl. new assertions)
- saga-isolation grep = empty
- PR state = MERGEABLE/CLEAN or MERGEABLE/UNSTABLE

---

## 15. Open questions / followups for V10

- Backend `handleReply()` only matches `trigger_event='reply_classified'` and `'no_reply'`. The editor lets users pick "Opened"/"Clicked" too — those will persist but never fire. Out of scope for this CC; flag for V10 to decide whether to (a) extend backend (b) hide those options in editor (c) leave as-is for future feature.
- `SequenceFlowDiagram` (line 365) — does it know how to render subsequence trigger arrows? Out of scope; flag for V10/CC #UI-3.
- The existing `+ New Primary Sequence` button (line 244-249) is gated on `!primarySequence && sequences.length > 0` — odd UX (only shows when a subsequence exists but no primary). The empty-state "Create Sequence" at line 369-380 covers the main path. Not changing this in CC #UI-2; flag for CC #UI-3.

---

## END Phase 0 design doc

Proceeding to Phase 1 implementation.
