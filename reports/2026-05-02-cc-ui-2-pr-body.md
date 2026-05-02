## Summary

Wires the existing-but-dead-code `SubsequenceTriggerEditor` (206 LOC) into `SequenceComposerModal` so users can finally create subsequences from the campaign detail page.

**What was missing:** the backend `sequence-engine.handleReply()` already queries `campaign_sequences WHERE sequence_type='subsequence' AND trigger_event=...` correctly, the display layer already renders trigger labels for existing subsequences, and `SubsequenceTriggerEditor` was fully built — but no UI path created subsequences. Zero subsequence rows existed in production.

**What this PR does:** extends the existing modal to accept a `sequenceType` prop and conditionally render the trigger editor above the steps editor. Updates `buildCreatePayload`/`buildUpdatePayload`/`validateComposerInput` to handle the subsequence shape (`trigger_event` + `trigger_condition` + `trigger_priority`). Adds a `+ New Subsequence` button + Edit affordance to the campaign detail page. **Backend, DB schema, and API route are unchanged.**

## Files changed

| File | Net LOC |
|---|---|
| `src/components/modals/sequence-composer-modal.tsx` | +83 |
| `src/components/modals/sequence-composer-helpers.ts` | +127 |
| `src/app/dashboard/campaigns/[id]/campaign-detail-client.tsx` | +30 |
| `src/components/modals/__tests__/sequence-composer-helpers.test.ts` | +156 |
| **Total net LOC** | **~396** |

LOC overshoots the V10 prompt's ≤350 target by ~46 LOC; the overage is durable test coverage (10 new subsequence-shape assertions + 4 detail-page contract greps). 41/41 tests pass.

## Trigger event canonicalization (the load-bearing nuance)

`SubsequenceTriggerEditor` emits display strings (`"Reply Classified"`, `"No Reply"`, `"Opened"`, `"Clicked"`). `sequence-engine.ts:337,540` queries snake_case (`'reply_classified'`, `'no_reply'`). Helpers map display→snake_case in `buildCreatePayload`/`buildUpdatePayload` so persisted shape matches what `handleReply` actually queries. Display layer in `campaign-detail-client.tsx` updated to read snake_case keys (with display-string tolerance kept as a no-cost fallback).

Verified pre-implementation: production `campaign_sequences` has 0 primary + 0 subsequence rows — clean slate, no legacy data to migrate.

## V10 audit-data drift note

CC #UI-1 (2026-05-02 earlier) shipped GREEN-with-pivot because its prompt referenced audit findings that turned out to be stale by the time CC ran (UI files claimed missing on main were already on main since `1add11b0`). **This CC's Phase 0 §0.2 ran 5 fresh greps against current main (`a7945e5`) before writing any code** — confirming `SubsequenceTriggerEditor` still dead, modal still hardcodes `sequence_type:'primary'`, helpers still pin primary, detail page has no subsequence button, API route still accepts the subsequence shape. All 5 checks passed; wire-up gap is real.

**Future CC sessions should follow the same Phase 0 discipline:** don't trust audit-derived premises without re-verifying live state in the same session. Static-from-audit findings decay fast in this workspace.

Phase 0 design doc: [`dashboard-app/reports/2026-05-02-cc-ui-2-design.md`](dashboard-app/reports/2026-05-02-cc-ui-2-design.md).

## NO-GO compliance

- No `src/lib/provisioning/` edits ✅
- No `src/lib/email/{smtp-manager,error-handler,imap-sync,sequence-engine}.ts` ✅
- No `panel-sidecar/`, `sidecar-health-monitor.ts`, `smtp-connection-monitor.ts` ✅
- No new migration; no schema change ✅
- No DELETE on any DB row ✅
- No DNS / panel / sender-pipeline touch — MXToolbox + DNS untouched ✅
- No `git add -A` — specific paths only ✅
- No call to `/api/campaigns/[id]/send`; no `campaigns.status='sending'` ✅

## Test plan

- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — clean
- [x] `npm run test:gate0` — all green (sequence-composer suite: 41/41 pass)
- [x] Saga-isolation grep — empty
- [ ] Phase 5 Probe 1 — Vercel deploy READY
- [ ] Phase 5 Probe 2 — `/dashboard/campaigns/[id]` HTTP 200/307/401 (not 500)
- [ ] Phase 5 Probe 4 — End-to-end smoke: create campaign + primary + subsequence via Supabase REST; read back asserts exact shape (`sequence_type:'subsequence'`, `trigger_event:'reply_classified'`, `trigger_condition.classification:'INTERESTED'`, `trigger_priority:1`)
- [ ] Phase 5 Probe 5 — Primary regression: 5 existing primary rows still `sequence_type='primary'` (currently 0 rows; passes vacuously, defends against future drift)
- [ ] Phase 5 Probe 6 — Active subsequence count > 0 after smoke

🤖 Generated with [Claude Code](https://claude.com/claude-code)
