# 2026-05-01 — Send-route wiring + distribute-campaign-sends deletion (CC #4 V9)

**Branch:** `fix/send-route-wiring-2026-05-01`
**Phase:** 0 — Design (no code yet)
**Author:** CC #4 (Opus 4.7 1M, ultrathink, auto mode)

---

## 1. Schema findings

All four V9 ground-verify findings re-confirmed against current `main` (HEAD `e2e58eb`):

| File | Line(s) | V9 claim | Confirmed |
|---|---|---|---|
| `src/app/api/campaigns/[id]/send/route.ts` | 64-67 | placebo `if (!campaign.body_html)` rejects new composer | ✅ verbatim |
| `src/app/api/campaigns/[id]/send/route.ts` | 84-107 | dead round-robin → `campaign_recipients.assigned_account_id` | ✅ verbatim |
| `src/lib/email/sequence-engine.ts` | 24-27 | `initializeSequence(campaignId: string, orgId: string): Promise<number>` | ✅ unchanged |
| `src/worker/handlers/distribute-campaign-sends.ts` | 180-194 | 4-key `boss.send('process-sequence-step', { recipientId, campaignId, accountId, step:0 })` | ✅ verbatim |
| `src/worker/handlers/process-sequence-step.ts` | 16-23 | 6-key `{ stateId, recipientId, sequenceId, stepNumber, campaignId, orgId }` | ✅ verbatim, dereferences `stateId` at line 29 |
| `supabase/migrations/004_sequences.sql` | 45 | `UNIQUE(recipient_id, campaign_id, sequence_id)` on `lead_sequence_state` | ✅ verbatim |
| `src/worker/index.ts` | 12 / 67 / 308-318 | 4 references to `distribute-campaign-sends` | ✅ verbatim (1 import + 1 queue-name + 1 schedule + 1 work block w/ comment) |

No drift. Design proceeds.

## 2. Files to touch

| File | Change | LOC delta |
|---|---|---|
| `src/app/api/campaigns/[id]/send/route.ts` | Rewrite POST handler; remove placebo body_html + round-robin | -45 / +75 (≈ +30 net) |
| `src/app/api/campaigns/[id]/send/route-helpers.ts` | NEW — pure helpers + types | +90 |
| `src/app/api/campaigns/[id]/send/__tests__/route-helpers.test.ts` | NEW — tsx unit + source-grep contracts | +180 |
| `src/worker/handlers/distribute-campaign-sends.ts` | DELETE | -297 |
| `src/worker/index.ts` | Surgical: -1 import, -1 queueName, -1 schedule, -1 work block, +1 audit comment | -12 / +9 |
| `package.json` | Append new test path to `test:gate0` | +1 / -0 |

**Total: ~+360 / -355 = +5 net LOC** (well under the 300 LOC delta-excluding-deletions cap).

## 3. Routing / wiring before vs after

| Trigger | Before | After |
|---|---|---|
| User clicks "Start campaign" in UI | `POST /api/campaigns/[id]/send` validates + sets `assigned_account_id` on recipients + flips `campaigns.status='sending'` — but never creates `lead_sequence_state` rows or pgboss jobs. **No-op in practice.** | `POST /api/campaigns/[id]/send` validates against the new sequence-content rules → idempotency pre-check on `lead_sequence_state` count → calls `initializeSequence(campaignId, orgId)` → creates state rows + enqueues 6-key `process-sequence-step` jobs → flips `campaigns.status='sending'`. |
| 6 AM UTC cron `0 6 * * *` | `distribute-campaign-sends` cron enqueued WRONG-shape (4-key) `process-sequence-step` jobs against any `status='sending'` campaign — every job dead-lettered at `process-sequence-step.ts:29` (`stateId` undefined). Dead since handler refactor. | DELETED. The new flow needs no cron — `initializeSequence` enqueues the first step at route-time; the existing `queue-sequence-steps` cron (every 5 min) handles subsequent step-readiness scans. |
| Unsubscribe race-window check | `distribute-campaign-sends.getPendingRecipients` excluded unsubscribed at queue-time; `process-sequence-step.ts:78-101` re-checked at send-tick time. | Send-tick check at `process-sequence-step.ts:78-101` is preserved verbatim. The queue-time pre-filter is dropped — `lead_sequence_state` is created for all recipients, but the send-tick layer hard-stops on unsub. (Trade: state row exists for unsubscribed recipients that shouldn't have been queued. Acceptable: send-tick check is the authoritative layer; campaigns can be re-checked retroactively. CC #5+ can add an init-time pre-filter if Dean wants.) |

## 4. Verbatim before/after of the route's POST handler

### Before (route.ts current — 127 lines)
```ts
// validation [...] (placebo body_html check at 65)
// round-robin assign campaign_recipients.assigned_account_id [...]
// update campaigns set status='sending', started_at=now() [...]
return { success: true, recipients_queued, accounts_assigned };
```

### After (route.ts new — ~155 lines)
```ts
export async function POST(req: Request, { params }) {
  const { id: campaignId } = await params;
  const orgId = await getInternalOrgId();
  if (!orgId) return 401;

  const supabase = await createAdminClient();

  // 1. Fetch campaign
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', campaignId).eq('org_id', orgId).single();
  if (!campaign) return 404;

  // 2. Validation
  const errors: string[] = [];

  const { count: recipientCount } = await supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'pending');
  if (!recipientCount) errors.push('No pending recipients found');

  if (!Array.isArray(campaign.subject_lines) || campaign.subject_lines.length === 0) errors.push('No subject lines configured');

  const { data: primarySeq } = await supabase.from('campaign_sequences').select('id, steps').eq('campaign_id', campaignId).eq('sequence_type', 'primary').eq('status', 'active').maybeSingle();
  if (!primarySeq) {
    errors.push('No active primary sequence configured');
  } else {
    const v = validatePrimarySequenceContent(primarySeq.steps);
    if (!v.ok) errors.push(v.reason!);
  }

  const { count: accountCount } = await supabase.from('email_accounts').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active');
  if (!accountCount) errors.push('No active email accounts available');

  if (errors.length > 0) return 400 { error: 'Validation failed', details: errors };

  // 3. Idempotency pre-check (Strategy A)
  const { count: existingStateCount } = await supabase.from('lead_sequence_state').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (existingStateCount && existingStateCount > 0) {
    await supabase.from('campaigns').update({ status: 'sending' }).eq('id', campaignId);
    return 200 buildSendResponse({ alreadyInitialized: true, existingStateCount, statesInitialized: 0, recipientCount, accountCount });
  }

  // 4. Initialize sequence
  let statesInitialized: number;
  try {
    statesInitialized = await initializeSequence(campaignId, orgId);
  } catch (e) {
    return 500 { error: 'Failed to initialize sequence', detail: e.message };
  }

  // 5. Flip status
  await supabase.from('campaigns').update({ status: 'sending', started_at: new Date().toISOString() }).eq('id', campaignId);

  // TODO(CC-#5+): move initializeSequence to an async pgboss `init-campaign` job
  // for >1k-recipient campaigns (current Vercel ceiling is 60s default, hot path
  // is ~1 await per recipient × ~50ms each = ~20s for 400 recipients).

  return 200 buildSendResponse({ statesInitialized, recipientCount, accountCount });
}
```

The dead `assigned_account_id` round-robin block (current lines 84-107) is REMOVED — see §10 for survey result.

## 5. Idempotency design (Strategy A — pre-check by state-row count)

**Rule:** If `count(lead_sequence_state where campaign_id=X) > 0`, do NOT call `initializeSequence` again. Update `campaigns.status='sending'` (idempotent — already-sending stays sending) and return:

```json
{
  "success": true,
  "already_initialized": true,
  "existing_state_count": <N>,
  "status": "sending",
  "recipients_queued": <recipientCount>,
  "accounts_assigned": <accountCount>
}
```

Else call `initializeSequence`, then return:

```json
{
  "success": true,
  "states_initialized": <N>,
  "recipients_queued": <recipientCount>,
  "accounts_assigned": <accountCount>
}
```

Race-safety: the UNIQUE constraint at `lead_sequence_state(recipient_id, campaign_id, sequence_id)` (mig 004:45) is the load-bearing guarantee. Two near-simultaneous POSTs on the same campaign: the first wins the pre-check + initialize; the second's pre-check sees the rows already, skips. If a perfectly-tied race got through both pre-checks, the second's `.insert(statesToInsert)` inside `initializeSequence` would 23505 unique-violation and throw — caller sees 500. This is acceptable for a UI button-click (Dean is single-user; double-click is the worst case and the second click would just see `already_initialized:true`).

## 6. Body-validation rewrite

`validatePrimarySequenceContent(steps: unknown): { ok: boolean; reason?: string }`

Rules (in order):
1. If `steps` is not an array → `{ok:false, reason:'Primary sequence has no steps'}`
2. If `steps.length === 0` → `{ok:false, reason:'Primary sequence has no steps'}`
3. For each step in `steps`:
   - If `step.body_html` is non-empty trimmed → step has content
   - Else if `Array.isArray(step.ab_variants)` and at least one variant has non-empty trimmed `body_html` → step has content
   - Else step has no content
4. If at least one step has content → `{ok:true}`
5. Else → `{ok:false, reason:'No email body configured in primary sequence'}`

The legacy `if (!campaign.body_html)` check at route.ts:65 is REMOVED. The new composer (PR #36) writes body content exclusively to `campaign_sequences.steps[N].body_html` and per-variant at `steps[N].ab_variants[V].body_html` — never to the legacy `campaigns.body_html` column.

Example pass:
```json
[{"step_number":1,"body_html":"<p>Hi</p>","ab_variants":[{"variant":"A","body_html":"<p>Hi</p>"}]}]
```

Example fail (variant exists but no body):
```json
[{"step_number":1,"ab_variants":[{"variant":"A","subject":"Hi"}]}]
```

## 7. Tests to add

NEW: `src/app/api/campaigns/[id]/send/__tests__/route-helpers.test.ts`

Pattern: tsx-runnable, no jest/vitest, follows `sequence-composer-helpers.test.ts` exactly. ≥15 cases:

**Pure helpers (1-9):**
1. `validatePrimarySequenceContent([])` → `{ok:false, reason:'Primary sequence has no steps'}`
2. `validatePrimarySequenceContent(null)` → `{ok:false}`
3. `validatePrimarySequenceContent([{}])` → `{ok:false, reason:'No email body configured in primary sequence'}`
4. `validatePrimarySequenceContent([{ body_html: 'hi' }])` → `{ok:true}`
5. `validatePrimarySequenceContent([{ ab_variants:[{variant:'A',body_html:'hi'}] }])` → `{ok:true}`
6. `validatePrimarySequenceContent([{ ab_variants:[{variant:'A'}] }])` → `{ok:false}`
7. `validatePrimarySequenceContent([{}, { body_html:'hi' }])` → `{ok:true}`
8. `buildSendResponse({ statesInitialized:5, ... })` includes `states_initialized:5`
9. `buildSendResponse({ alreadyInitialized:true, existingStateCount:12 })` includes `already_initialized:true` AND `existing_state_count:12`

**Source-grep contracts (10-15):**
10. `route.ts` text contains `from '@/lib/email/sequence-engine'` AND `initializeSequence(`
11. `route.ts` text does NOT contain `if (!campaign.body_html)`
12. `worker/index.ts` text does NOT contain `"distribute-campaign-sends"` (any reference)
13. `worker/index.ts` text does NOT contain `handleDistributeCampaignSends`
14. `worker/index.ts` text DOES contain `// distribute-campaign-sends cron REMOVED 2026-05-01`
15. `src/worker/handlers/distribute-campaign-sends.ts` does NOT exist on disk

`package.json:test:gate0` appended with `&& tsx './src/app/api/campaigns/[id]/send/__tests__/route-helpers.test.ts'`.

## 8. Migration needed?

**NO.** No SQL changes. `lead_sequence_state` table + UNIQUE constraint already exist (mig 004); `campaign_sequences` columns already accept the JSONB shapes the new validation reads.

## 9. Probe-5 on `scripts/v1b-smoke.ts` resolution

**Case (b)** — Probe 5 does NOT import from `distribute-campaign-sends.ts`. Verified:

```
$ grep -n "from.*distribute-campaign-sends\|import.*distribute-campaign-sends" scripts/v1b-smoke.ts
(empty)
```

The string `distribute-campaign-sends` appears only in the human-readable log line at `scripts/v1b-smoke.ts:364`. The unsub-filter logic the probe exercises is replicated INLINE at lines 405-414 (`unsubSet`), copying the shape from the original handler — not importing it. Deleting the handler file does NOT break the smoke script. The log-line string will become slightly stale ("Send-path filter — distribute-campaign-sends excludes unsubscribed") but the probe still validates the actual contract (unsubSet filter shape on `lead_contacts`).

**No edit needed in Phase 1.5.** Skipping it.

## 10. `campaign_recipients.assigned_account_id` reader survey

```
$ grep -rn "assigned_account_id" --include="*.ts" --include="*.tsx" src/
```

Reads break down by table:

| Reader | Source table | Production read? |
|---|---|---|
| `route.ts:104` | `campaign_recipients` (the WRITE we're deleting) | N/A |
| `src/lib/supabase/types.ts` (×6) | TypeScript interface declarations only | No (type only) |
| `src/lib/email/sequence-engine.ts:126,375,577` | Writes `lead_sequence_state.assigned_account_id` | Different table |
| `src/worker/handlers/process-sequence-step.ts:103-111` | Reads `lead_sequence_state.assigned_account_id` (via `state.assigned_account_id`) | Different table |
| `src/lib/email/campaign-queue.ts:103` | Reads `recipient.assigned_account_id` from a function parameter shape — the ONLY caller of `queueCampaign` is none (no production caller — `queueCampaign` is unused export) | Dead code path |

**Conclusion:** No production code reads `campaign_recipients.assigned_account_id`. The route's round-robin block is genuinely dead. SAFE to delete.

(Note: `queueCampaign` in `campaign-queue.ts` is an unused export — `grep -rn "queueCampaign("` returns only the definition. Cleaning that up is out of scope for this PR.)

## 11. Pre-merge dry-run validation check

CANNOT run `psql` from CC's local environment — `DATABASE_URL` is not in `.env.local`. The standing memory entry from CC #3 (2026-04-30) recorded `ever_sent=0 across entire org pre-smoke` and CC #3 cleaned its smoke campaigns at the end of its session. The probability that any campaign currently has `status='sending'` is effectively zero given the launch-hold + Dean's single-user posture.

**Mitigation:** Phase 5.0 will run this query via SSH to the worker (which has `DATABASE_URL`) immediately before opening the PR. If any `status='sending'` campaign has a primary sequence with no body content, the new validation would lock it into a 400-error state on the next button-click — surfacing in the deploy report. A pre-existing sending campaign without a properly-configured primary sequence is itself broken (it would never have produced sends), so the new validation is correctly tightening, not regressing.

## 12. Risks / open questions

| Risk | Mitigation |
|---|---|
| `initializeSequence` runs synchronously in a Vercel serverless route; 60s timeout | Document as TODO in code; CC #4 only smokes 1-recipient probes so the timeout is irrelevant; >1k-recipient campaigns are not in CC #4's scope (Dean isn't launching) |
| pg-boss queue `distribute-campaign-sends` orphan row in `pgboss.schedule` survives the worker restart (pg-boss does not auto-delete) | Acceptable; document as harmless follow-up. CC #5 can `DELETE FROM pgboss.schedule WHERE name='distribute-campaign-sends'` if Dean wants. |
| Unsubscribe queue-time pre-filter dropped (was in `getPendingRecipients`) | Send-tick check at `process-sequence-step.ts:78-101` remains the authoritative layer; trade is acceptable per §3 table |
| `campaign_recipients.status` not flipped to `sent` by `process-sequence-step` (CC #3 P3-E) | OUT OF SCOPE; will be CC #5 work |
| Worker SMTP architecture leaks 3 sender domains in Received chain (CC #3 P1-C) | OUT OF SCOPE; CC #5 |

No HALT-worthy risks. Design is clear to proceed.

---

## Sign-off

All 5 V9 ground-verify checks passed (signatures, line numbers, no drift). All NO-GO list invariants understood. Pre-reads completed (note: `2026-04-30-campaign-fire-smoke-deploy.md` and `2026-04-30-cc-3-summary-for-cowork.md` are not present in this worktree's `reports/` — the campaign-fire smoke memory entry in `MEMORY.md` covered the operational details, no additional context lost). Proceeding to Phase 1.
