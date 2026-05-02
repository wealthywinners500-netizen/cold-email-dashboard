## Summary

CC #UI-4 (V10, 2026-05-02) — exposes subsequence CRUD on `/dashboard/follow-ups`.

- Adds 4th **"Subsequences"** tab alongside group-a/b/c on the follow-ups page.
- Reuses `SequenceComposerModal` with new optional `campaignId` prop. When `null`, the modal renders a `<CampaignPicker>` dropdown so the user picks which campaign the subsequence attaches to.
- New endpoint `GET /api/follow-ups/subsequences` returns org-scoped list with `campaigns(name)` join.
- New `<CampaignPicker>` component (~71 LOC).
- New `getOrgSubsequences()` query.
- Edit/Delete reuse existing `PATCH/DELETE /api/campaigns/[id]/sequences/[seqId]` (already shipped).
- Picker is **locked** in edit mode (can't re-attach an existing subsequence to a new campaign — out of scope).

Per-campaign attachment preserved (existing schema). **CC #UI-5 will migrate to true org-scoped reuse** via `campaign_id` nullable + `applies_to_campaigns` + `applies_to_tags` + sequence-engine cross-campaign matching.

## Design + ground-verify

V10 META process completed Phase 0 ground-verify before any code:

- ✓ follow-ups-client.tsx contained **0** subsequence refs (gap real)
- ✓ `/api/follow-ups/subsequences/` did NOT exist
- ✓ `SequenceComposerModal` already accepts `sequenceType` prop (CC #UI-2 shipped)
- ✓ `DELETE /api/campaigns/[id]/sequences/[seqId]` already exists (saves scope)
- ✓ 1 existing subsequence + 9 non-archived campaigns confirmed via Supabase REST

Full design doc + risks + verbatim diff plans: [`reports/2026-05-02-cc-ui-4-design.md`](dashboard-app/reports/2026-05-02-cc-ui-4-design.md).

## NO-GO compliance

- ✗ NO migrations
- ✗ NO sender-pipeline edits (`src/lib/email/`, panel-sidecar/, sequence-engine, threading) — verified empty by saga-isolation grep
- ✗ NO worker handler edits
- ✗ NO real or smoke email sends
- ✗ NO campaign status mutations

## Test plan

- [x] `npm run typecheck` — 0 errors
- [x] `npm run build` — clean (28/28 static pages)
- [x] `npm run test:gate0` — all GREEN, including 35 new assertions across 3 new test files + 2 updated assertions in `sequence-composer-helpers.test.ts` for the new picker contract
- [ ] Vercel READY post-merge
- [ ] Probe 1: `/dashboard/follow-ups` non-500
- [ ] Probe 3: end-to-end CREATE → READ → DELETE on smoke subsequence via Supabase REST
- [ ] Probe 4: primary sequences regression — no drift
- [ ] Probe 5: adjacent dashboard pages non-500
- [ ] Probe 6: source on main contains new tab + new endpoint
- [ ] Dean verification — 11-step checklist in deploy report

🤖 Generated with [Claude Code](https://claude.com/claude-code)
