## Why

CC #3's campaign-fire smoke (2026-04-30) proved end-to-end SMTP fires correctly when invoked via direct pgboss INSERT. But it surfaced two show-stoppers preventing UI-driven launch:

- **P0-A:** `/api/campaigns/[id]/send` was a placebo — validated, set `campaign_recipients.assigned_account_id`, flipped `campaigns.status='sending'`, but never called `initializeSequence()`. Clicking "Start campaign" was a no-op.
- **P0-B:** `worker/handlers/distribute-campaign-sends.ts` cron at `0 6 * * *` UTC enqueued `process-sequence-step` jobs with the wrong 4-key payload `{recipientId, campaignId, accountId, step:0}`. The handler dereferences the 6-key shape's `stateId` immediately at line 29 — every job dead-lettered for the handler's lifetime. Cron was also obsolete-model (the new flow uses `initializeSequence` + the existing `queue-sequence-steps` cron).

This PR also closes CC #3's **`body_html` validation gap**: the legacy `if (!campaign.body_html)` check at route.ts:65 rejects every campaign produced by the new sequences composer (PR #36, sha `70efb58`), because the new composer writes body content to `campaign_sequences.steps[N].body_html` (and per-variant at `steps[N].ab_variants[V].body_html`), never to the legacy `campaigns.body_html` column.

## What changed

| File | Δ |
|---|---|
| `src/app/api/campaigns/[id]/send/route.ts` | Rewrite POST: validate against new sequence-content rules → idempotency pre-check on `lead_sequence_state` count → `initializeSequence(campaignId, orgId)` → flip `status='sending'`. Legacy `body_html` check removed. Dead `assigned_account_id` round-robin block removed (no production reader — survey in design doc §10). |
| `src/app/api/campaigns/[id]/send/route-helpers.ts` | NEW — pure helpers: `validatePrimarySequenceContent` + `buildSendResponse`. tsx-runnable, no React/Radix deps. |
| `src/app/api/campaigns/[id]/send/__tests__/route-helpers.test.ts` | NEW — 19 cases (10 helpers + 9 source-grep contracts: route imports `initializeSequence`, legacy check absent, audit comment present, handler file deleted from disk). |
| `src/worker/handlers/distribute-campaign-sends.ts` | DELETED (-297 LOC). Unsubscribe-filter logic preserved at `process-sequence-step.ts:78-101`. |
| `src/worker/index.ts` | Surgical: removed import (line 12), queue name in array (line 67), schedule + work block (lines 308-318). Replaced with dated audit comment. |
| `package.json` | `test:gate0` script appends new route-helpers test path. |

**Diff stat:** 4 files / +92 / -350 (net **-258 LOC** thanks to deleting the dead cron handler).

## Idempotency design

**Strategy A — pre-check by state-row count.** If `count(lead_sequence_state where campaign_id=X) > 0`, skip `initializeSequence`, just re-affirm `campaigns.status='sending'`, return:

```json
{ "success": true, "already_initialized": true, "existing_state_count": <N>, "status": "sending" }
```

The `UNIQUE(recipient_id, campaign_id, sequence_id)` on `lead_sequence_state` (mig 004:45) is the load-bearing guarantee. A perfectly-tied race that got past both pre-checks would collide on insert and 500 — caller can retry and see `already_initialized:true`.

## Body-validation rewrite

`validatePrimarySequenceContent(steps)`: passes if at least one step has non-empty trimmed `body_html` OR any variant in `ab_variants` does. Rejects with `'Primary sequence has no steps'` for empty/null arrays, or `'No email body configured in primary sequence'` for steps without content. Whitespace-only body_html does not count as content.

## Verification

- `npm run typecheck` — 0 errors
- `npm run build` — clean (Next.js 15.5.14)
- `npm run test:gate0` — all suites GREEN, including new 19/19 route-helpers test
- Saga-isolation grep against `git diff --name-only origin/main...HEAD` — empty (no `src/lib/provisioning/`, no provision-/pair-verify/rollback- handlers, no `.gitignore`, no `serverless-steps.ts`)
- Worktree hygiene: only the intended files in `git status`

## Smoke probes (post-merge, run via worker SSH)

1. **Zero-recipient validation:** call route on smoke campaign with no recipients → expect HTTP 400 + `'No pending recipients found'`; 0 `lead_sequence_state` rows created.
2. **One-recipient init w/ future-dated schedule:** call route → expect 200 + `states_initialized:1`; 1 `lead_sequence_state` row with valid shape; 1 `process-sequence-step` pgboss job with all 6 keys present + `start_after` ≥ 24h in future (no send fires during smoke).
3. **Idempotency:** re-call route → expect 200 + `already_initialized:true`; 0 new state/job rows.
4. **Cron deletion:** `journalctl -u dashboard-worker --since "5 minutes ago" | grep -c distribute-campaign-sends` → 0.
5. **No production damage:** count of `lead_sequence_state` rows older than 1h is unchanged pre/post smoke.

Auto-rollback on any FAIL: `git revert -m1 <merge_sha> && git push && ssh worker pull+restart`.

## NO-GO compliance

- No saga / provisioning / pair-verify / rollback file touched
- No SMTP / smtp-manager / email-preparer / process-sequence-step / send-email / sequence-engine modification (read-only — only ADD a call to existing `initializeSequence` export)
- No new migration, no DB row deletion outside smoke-tagged rows
- No production secrets, API keys, or SMTP passwords printed
- No `git add -A` / `git add .`

## Launch hold status

**Still in effect.** Dean does NOT click "Start campaign" on a real campaign until CC #5 (sender-architecture redesign for zero digital footprint) ships. CC #4 ships the wiring; the launch hold protects pair 20's reputation in the meantime.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
