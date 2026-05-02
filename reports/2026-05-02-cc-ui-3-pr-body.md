# feat(campaigns): builder completion (CC #UI-3)

## Summary

Closes 4 of 5 V10-audit-confirmed gaps in the campaign detail page. Dean can now build a campaign, attach a lead list, configure schedule, click Start.

| Sub-feature | Status | Wiring |
|-------------|--------|--------|
| **A. Start Campaign button** | ✅ Shipped | Calls existing CC #4 `POST /api/campaigns/[id]/send` |
| **B. Recipients upload modal** | ✅ Shipped (lead-list path; CSV stubbed) | `POST /api/lead-contacts/import-to-campaign` (route filter extended +3 LOC to accept `lead_list_id`) |
| **C. Send Schedule editor** | ✅ Shipped | `PATCH /api/campaigns/[id]` with `sending_schedule` JSONB |
| **D. Pause/Resume button** | ✅ Shipped | `PATCH /api/campaigns/[id]` with `{status}` |
| **E. Email Account picker** | ❌ HALTED — schema-out-of-scope | `campaigns.assigned_account_id` does not exist; per-recipient assignment is via round-robin in sequence-engine. Needs migration in follow-up CC. |

## Phase 0 design

`reports/2026-05-02-cc-ui-3-design.md` — full audit, schema findings, routing matrix, risks.

## V10 audit-data drift note

The original prompt (V10 audit) assumed `campaigns.assigned_account_id` existed. Phase 0 ground-verify (full migration grep) proved it does not — the `assigned_account_id` column lives on `campaign_recipients` and `lead_sequence_state`, written by sequence-engine round-robin assignment, not by user-facing campaign-level config. **Lesson reaffirmed:** Phase 0 §0.2 per-gap re-verify discipline catches assumption-driven HALTs before any code is written. CC #UI-1 (redirected) and CC #UI-2 (proceed-as-planned) followed the same pattern.

Sub-feature C also carried a shape-mismatch finding: the engine reads `send_between_hours / days / max_per_day / per_account_per_hour`, NOT the prompt's `hours.{start,end} / days_of_week / daily_limit`. The display in `campaign-detail-client.tsx` had been silently broken since day one — always showing fallback strings because the actual column held the engine shape. This PR fixes the display AND wires the editor to the engine shape.

## Critical safety check

`POST /api/campaigns/[id]/send` is not modified — only the button that calls it. Smoke tests pre-archive the smoke campaign's primary sequence so `/send` returns HTTP 400 ("No active primary sequence configured") and `email_send_log` count remains 0. The route's existing CC #4 idempotency + validation logic is untouched.

## Per-sub-feature rollback isolation

If a single sub-feature fails post-deploy:

- D (Pause/Resume): isolated to ~50 LOC in `campaign-detail-client.tsx`
- A (Start): ~80 LOC in `campaign-detail-client.tsx`, `handleStartCampaign` fn
- C (Schedule): full file `send-schedule-modal.tsx` + 1 import + 1 button + display fix
- B (Recipients): full file `recipients-upload-modal.tsx` + 1 import + 1 button + 3-line route filter extension

Cherry-pick rollback is possible. Default rollback recipe is the full PR.

## Files changed

```
package.json                                                  +3 lines (test:gate0)
src/app/api/lead-contacts/import-to-campaign/route.ts         +3 lines (lead_list_id filter)
src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx   +130 lines (4 buttons + handlers + display fix)
src/components/modals/send-schedule-modal.tsx                 NEW (310)
src/components/modals/recipients-upload-modal.tsx             NEW (243)
src/components/modals/__tests__/send-schedule-modal.test.ts   NEW (114)
src/components/modals/__tests__/recipients-upload-modal.test.ts NEW (102)
src/app/dashboard/campaigns/[id]/__tests__/campaign-detail-client.test.ts NEW (126)
reports/2026-05-02-cc-ui-3-{design,deploy,pr-body}.md         3 reports
```

## NO-GO compliance

Saga / panel-sidecar / smtp-manager / sequence-engine / `/send/route.ts` / provisioning files: ALL UNTOUCHED. Saga-isolation grep empty. No new migration. No DELETE statements.

## Test plan

- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — clean (compiled successfully)
- [x] `npm run test:gate0` — 3 new test files (31 new assertions) all GREEN; 100% existing tests still GREEN
- [x] Saga isolation grep: empty
- [ ] Vercel deploy READY post-merge
- [ ] Smoke 7-8/8 GREEN (Probe 4 SKIP if no active accounts; Probe 6 critical safety check `email_send_log = 0`)
- [ ] No regression on `/dashboard`, `/campaigns`, `/leads`, `/inbox`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
