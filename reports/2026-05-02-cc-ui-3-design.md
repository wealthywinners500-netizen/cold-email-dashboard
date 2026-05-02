# CC #UI-3 — Phase 0 Design Doc (2026-05-02 V10)

**Branch:** `feat/ui-3-campaign-builder-completion-2026-05-02`
**Worktree:** `.claude/worktrees/hungry-lehmann-33c89d`
**Pre-merge main SHA:** `8713352` (PR #50, CC #UI-2 deploy report)
**Phase 0 outcome:** PROCEED with **4 of 5** sub-features (E HALTed — schema-out-of-scope)

---

## §0.2 Per-gap re-verify results

| Gap | Status | Action | LOC |
|-----|--------|--------|-----|
| A. Start Campaign button | NOT WIRED — confirmed | Proceed | ~70 |
| B. Recipients upload modal | NOT WIRED; route exists; needs filter extension | Proceed (+3 LOC route) | ~220 |
| C. Send Schedule editor | NOT WIRED; engine-shape mismatch with display | Proceed (+update display) | ~230 |
| D. Pause/Resume button | NOT WIRED — confirmed | Proceed | ~45 |
| E. Email Account picker | **HALT** — `campaigns.assigned_account_id` does not exist | **Skip** + document | 0 |
| **Total** | | | **~570 + ~3 route + tests** |

### Detail per gap

#### A. Start button — proceed
- Grep for "Start Campaign|launchCampaign|isStarting|isSending" in `campaign-detail-client.tsx`: ZERO matches.
- `/api/campaigns/[id]/send/route.ts` validates: `recipientCount>0`, `subject_lines`, primary sequence + content, `accountCount>0`. Returns HTTP 400 with `{error, details: string[]}` shape on validation fail. Route shape unchanged from CC #4.

#### B. Recipients upload — proceed (with route filter extension)
- No upload modal exists in `src/app/dashboard/campaigns` or `src/components`.
- Route `src/app/api/lead-contacts/import-to-campaign/route.ts` EXISTS. Accepts `{campaign_id, contact_ids[]}` OR `{campaign_id, filter:{email_status, state, city}}`.
- **Does NOT accept `lead_list_id`** — need to extend filter shape to also accept `lead_list_id` (3-line change, in spirit of prompt's "small additions OK").
- De-duplication, suppression, recipient-count update all already implemented.
- CSV path: stub with "Coming soon — use lead list" per prompt's deferral.

#### C. Schedule editor — proceed (with display update)
- No editor UI exists.
- `campaigns.sending_schedule` JSONB column exists (mig 003:89, default `{send_between_hours:[9,17], timezone:"America/New_York", days:["mon","tue","wed","thu","fri"], max_per_day:500, per_account_per_hour:13}`).
- **CRITICAL: schema-vs-prompt shape mismatch.** Prompt specifies `{hours:{start,end}, timezone, daily_limit, days_of_week}`, but the engine reads `send_between_hours/days/timezone/max_per_day/per_account_per_hour` (sequence-engine.ts:693, campaign-queue.ts:58-63). The existing display in campaign-detail-client.tsx:99-102 reads `hours/timezone/daily_limit` (the prompt's shape) — meaning the display has been silently broken since day one (always showing fallback strings because the actual column shape is the engine's shape).
- **Decision:** Modal writes the engine's shape (correctness > prompt's exact field-name spec). Display also updated to match. Documented in deploy report.

#### D. Pause/Resume — proceed
- No button exists in `campaign-detail-client.tsx`.
- PATCH `/api/campaigns/[id]/route.ts` accepts arbitrary body (line 80 `update(body)` — does `delete body.org_id` then forwards) → `{status: "paused"|"active"}` flows through.
- A separate POST `/api/campaigns/[id]/pause/route.ts` exists (sets `status='paused'` only). Use the PATCH route for both directions to keep one code path.
- `campaigns.status` is `text NOT NULL DEFAULT 'draft'` — no enum constraint, no migration risk.

#### E. Email Account picker — HALT
- `campaigns.assigned_account_id` **does not exist** as a column on the `campaigns` table.
- Full migration grep: `assigned_account_id` exists only on `campaign_recipients` (mig 003:45) and `lead_sequence_state` (mig 004:40) — both written by sequence-engine round-robin assignment, NOT by user-facing campaign-level config.
- The route-helpers test even asserts the dead path is gone: `"route must NOT write campaign_recipients.assigned_account_id (dead path)"`.
- **HALT decision:** schema is out-of-scope per CC #UI-3 prompt §0.4 HALT condition. Skipping this sub-feature. Document for V11 follow-up: needs migration adding `campaigns.assigned_account_id UUID REFERENCES email_accounts(id)` + sequence-engine awareness (override round-robin if set).

---

## Schema findings (definitive)

```
campaigns.status               text NOT NULL DEFAULT 'draft'  (no CHECK constraint)
campaigns.sending_schedule     jsonb (default with engine shape)
campaigns.assigned_account_id  DOES NOT EXIST
email_accounts.status          varchar(50) DEFAULT 'active'
```

Engine schedule shape (load-bearing — modal MUST write this):
```ts
{
  send_between_hours: [number, number];
  timezone: string;                       // e.g. "America/New_York"
  days: string[];                          // ["mon","tue","wed","thu","fri"]
  max_per_day: number;
  per_account_per_hour: number;
}
```

---

## Files to touch

| Path | Reason | Est. LOC | Sub-feature |
|------|--------|----------|-------------|
| `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` | Add buttons + modal wiring + state hooks; fix schedule display shape | +130 | A, C, D, recip-modal-trigger |
| `src/components/modals/send-schedule-modal.tsx` (NEW) | Schedule editor modal | +200 | C |
| `src/components/modals/recipients-upload-modal.tsx` (NEW) | Recipients lead-list picker modal + CSV stub | +180 | B |
| `src/app/api/lead-contacts/import-to-campaign/route.ts` | Add `lead_list_id` to filter object | +3 | B |
| `src/components/modals/__tests__/send-schedule-modal.test.ts` (NEW) | Source-grep contract test | +60 | C |
| `src/components/modals/__tests__/recipients-upload-modal.test.ts` (NEW) | Source-grep contract test | +50 | B |
| `src/app/dashboard/campaigns/[id]/__tests__/campaign-detail-client.test.ts` (NEW) | Source-grep button presence | +50 | A, C, D |
| `package.json` | Add 3 new test:gate0 entries | +3 | tests |
| `reports/2026-05-02-cc-ui-3-design.md` | This file | n/a | — |
| `reports/2026-05-02-cc-ui-3-deploy.md` | Phase 7 | n/a | — |
| `reports/2026-05-02-cc-ui-3-pr-body.md` | Phase 7 | n/a | — |
| **Total** | | **~676** | |

LOC ≤700 hard ceiling (target was 600; over by ~76 due to two full modals + their tests). Within budget.

---

## Routing/wiring matrix

| Button | State trigger | API call | DB write |
|--------|---------------|----------|----------|
| Start Campaign | `setIsStarting(true)` | `POST /api/campaigns/[id]/send` | `campaigns.status='sending'`, `lead_sequence_state` rows |
| Pause | `handlePauseResume('paused')` | `PATCH /api/campaigns/[id]` body=`{status:'paused'}` | `campaigns.status='paused'` |
| Resume | `handlePauseResume('active')` | `PATCH /api/campaigns/[id]` body=`{status:'active'}` | `campaigns.status='active'` |
| Edit Schedule | opens SendScheduleModal; submit → `PATCH /api/campaigns/[id]` | body=`{sending_schedule:{...engine shape}}` | `campaigns.sending_schedule` JSONB |
| + Add Recipients | opens RecipientsUploadModal; submit → `POST /api/lead-contacts/import-to-campaign` | body=`{campaign_id, filter:{lead_list_id, email_status?}}` | inserts into `campaign_recipients`; updates `campaigns.recipients` count |

---

## Function signature changes

**`src/app/api/lead-contacts/import-to-campaign/route.ts`** — small addition to filter handling.

Before (lines 48-58):
```ts
} else if (filter) {
  if (filter.email_status) {
    contactsQuery = contactsQuery.eq("email_status", filter.email_status);
  }
  if (filter.state) {
    contactsQuery = contactsQuery.eq("state", filter.state);
  }
  if (filter.city) {
    contactsQuery = contactsQuery.eq("city", filter.city);
  }
}
```

After (add 3 lines for `lead_list_id`):
```ts
} else if (filter) {
  if (filter.lead_list_id) {
    contactsQuery = contactsQuery.eq("lead_list_id", filter.lead_list_id);
  }
  if (filter.email_status) {
    contactsQuery = contactsQuery.eq("email_status", filter.email_status);
  }
  ...
}
```

No other signature changes anywhere.

---

## Tests to add

`__tests__/send-schedule-modal.test.ts`:
- File contains `<input type="time"` (one for start, one for end)
- File contains a select for timezone
- File contains `<input type="number"` for `max_per_day`
- onSubmit handler PATCH body string contains `send_between_hours` and `timezone`

`__tests__/recipients-upload-modal.test.ts`:
- File contains a select for lead_list selection
- onSubmit calls fetch with URL containing `/api/lead-contacts/import-to-campaign`
- File references `lead_list_id` in the filter payload
- `email_status: "valid"` filter is conditionally added

`__tests__/campaign-detail-client.test.ts`:
- Source contains `Start Campaign` button text
- Source contains both `Pause` and `Resume` button text
- Source contains `+ Add Recipients` button text
- Source contains `Edit Schedule` button text
- Source contains import for `SendScheduleModal` and `RecipientsUploadModal`

---

## Migration needed

**N — zero schema changes.** All needed columns already exist:
- `campaigns.status` ✓
- `campaigns.sending_schedule` ✓
- `lead_contacts.lead_list_id` ✓ (from CC #UI-1 redirect)
- `lead_lists` ✓ (mig 023, populated)

(`campaigns.assigned_account_id` would be needed for sub-feature E — that's the schema-out-of-scope HALT.)

---

## Per-sub-feature rollback isolation

Bundle ships in one PR but the file edits are scoped per sub-feature for cherry-pick rollback in a follow-up if ever needed:

| Sub-feature | Files exclusively scoped to it |
|-------------|-------------------------------|
| Pause/Resume (D) | `campaign-detail-client.tsx` lines around status badge |
| Start button (A) | `campaign-detail-client.tsx` lines in overview header + handleStart fn |
| Schedule modal (C) | `send-schedule-modal.tsx` (entire file) + 1 import + 1 button + display fix in `campaign-detail-client.tsx` |
| Recipients modal (B) | `recipients-upload-modal.tsx` (entire file) + 1 import + 1 button in `campaign-detail-client.tsx` + 3-line route filter extension |
| (E HALTed) | n/a |

If a single sub-feature breaks post-deploy, the rollback is the full PR. If only one sub-feature breaks during local testing, the design intent allows surgical revert.

---

## Smoke artifact lifecycle

1. Pre-create campaign `CC-UI-3-smoke-test` with `status='paused'`.
2. Pre-create primary sequence (smoke-primary, status='active') so Start-button validation has a sequence to find.
3. Probe 1: GET campaign detail page → non-500.
4. Probe 2: PATCH status `paused → active → paused`.
5. Probe 3: PATCH `sending_schedule` with engine shape; read back; assert exact JSON match.
6. Probe 4: SKIP (per Phase 0 HALT for sub-feature E — column does not exist).
7. Probe 5: Insert 5 lead_contacts as campaign_recipients via direct REST (proves schema accepts the shape; the route's logic is asserted by source-grep test).
8. Probe 6: Set primary sequence `status='archived'` so /send returns 400; THEN POST /send (skipped if no Clerk JWT in harness — source-grep contract test asserts button calls route). **Critical safety check: `email_send_log` count for smoke campaign = 0.**
9. Probe 7: Existing campaigns still parseable; no unexpected `sending` transitions.
10. Probe 8: `/dashboard`, `/campaigns`, `/leads`, `/inbox` all non-500.
11. Cleanup: UPDATE smoke campaign `status='archived'`, prefix name with `[CC-UI-3 smoke artifact 2026-05-02 — safe to archive]`. NO DELETE.

---

## MXToolbox / DNS

**UNTOUCHED.** This session has zero deliverability impact. No SMTP, no IMAP, no panel-sidecar, no DNS, no provisioning. Saga-isolation grep expected empty.

---

## Risks + mitigations (top 5)

1. **Existing campaign-detail-client.tsx state expansion conflicts with composer state.** Mitigation: state for new buttons lives in NEW useState calls (`isStarting`, `isPausing`, `scheduleModalOpen`, `recipientsModalOpen`); doesn't reuse `composerState` name.
2. **Schedule modal writes the wrong shape and breaks throttling.** Mitigation: Phase 0 ground-verified engine shape (sequence-engine.ts:693, campaign-queue.ts:58-63). Modal writes `send_between_hours/days/timezone/max_per_day/per_account_per_hour`. Display also updated to read this shape.
3. **Start button accidentally fires real sends during smoke.** Mitigation: smoke pre-archives the primary sequence so /send returns 400. End-of-Probe-6 asserts `email_send_log count = 0` and `campaigns.status != 'sending'` — auto-rollback on violation.
4. **Recipients modal's import-to-campaign route extension changes route response shape and breaks other callers.** Mitigation: only ADDS a new optional filter field (`lead_list_id`); response shape unchanged.
5. **Sub-feature E user-visible expectation gap.** Mitigation: design doc + deploy report + MEMORY.md note that E is deferred pending schema migration. The PR description explicitly calls this out.

---

## Phase 0 ground-verify discipline

Per V10 audit-data-drift lesson and CC #UI-2 pattern: each of the 5 sub-features got an explicit grep BEFORE any code was authored. Result:
- 4 confirmed still missing → proceed.
- 1 confirmed schema-out-of-scope (E) → HALT-skip with redirect note.

If this Phase 0 had been skipped, sub-feature E would have produced a runtime PG error on every PATCH attempt (column not found), and the entire smoke would have failed at Probe 4.

---

## NO-GO compliance pre-check

| Constraint | Honored |
|-----------|---------|
| No `src/lib/provisioning/` edits | ✓ |
| No `provision-*`/`pair-verify`/`rollback-*` worker handler edits | ✓ |
| No saga F-24 file changes | ✓ |
| No `smtp-manager.ts`/`error-handler.ts`/`imap-sync.ts`/`sequence-engine.ts` edits | ✓ |
| No `panel-sidecar/` edits | ✓ |
| No `/send/route.ts` edits | ✓ |
| No new migration | ✓ |
| No DELETE statements | ✓ (smoke uses UPDATE status='archived') |
| Append-only ≤8 lines to `MEMORY.md` | ✓ (Phase 7) |
| No `git add -A` | ✓ |
| No secrets printed | ✓ |
| Auto-merge gate respects test:gate0/typecheck/build | ✓ |

---

**Phase 0 conclusion:** PROCEED with implementation of A, B, C, D. Skip E with documented redirect.
