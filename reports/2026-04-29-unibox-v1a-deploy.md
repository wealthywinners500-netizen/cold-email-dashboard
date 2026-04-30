# Unibox V1+a — deploy report

**Branch:** `feat/unibox-v1a-vocab-6tabs-pacing`
**PR:** [https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/26](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/26) (MERGED)
**Author:** V7 CC session, 2026-04-30

## 1. Commit / merge / deploy SHAs

| Stage | SHA |
|---|---|
| Pre-merge `origin/main` | `248fd17` (PR #25 merge — classifier parser fix) |
| Feature commit | `f0c3f4a` |
| Merge SHA | **`3137593c8237bf86c3614376d9eca08570b0ff67`** |
| Worker post-deploy HEAD | **`3137593c8237bf86c3614376d9eca08570b0ff67`** ✓ |

Worker host: `root@200.234.226.226` (`/opt/dashboard-worker`).
`systemctl is-active dashboard-worker` → **active**.
Boot journal post-restart at 15:50:23 UTC clean: `[Worker] pg-boss started`, `[Worker] All queues created`, `[Worker] Email worker is running. Waiting for jobs...`. Pre-existing per-account IMAP errors (auth/connection) unrelated to this change.

## 2. Smoke-test results (post-deploy)

Run via `npx tsx v1a-smoke.ts` on the deployed worker with `EnvironmentFile=/opt/dashboard-worker/.env` loaded.

| Candidate | Input text | Result | Confidence |
|---|---|---|---|
| INTERESTED | `"Can you send pricing?"` | **`INTERESTED`** | **0.95** ✓ |
| HOT_LEAD | `"What is your turnaround time and contract length, and who is your typical client?"` | **`HOT_LEAD`** | **0.95** ✓ |

Both labels match the V1+a locked vocab split exactly: the soft first-touch positive ("asks for pricing only") routed to INTERESTED; the substantive multi-question text (turnaround + contract + persona) routed to HOT_LEAD. Confidence ≥ 0.5 on both — no parse-failure fallback fired.

## 3. Re-drain results

| Metric | Value |
|---|---|
| inbox_messages received total | **543** |
| inbox_threads cleared | **698** |
| Pre-clear classification (NULL) | 0 (PR #25 had drained all 543) |
| Post-clear classification (NULL) | 543 ✓ |
| Iterations of `handleClassifyBatch` | **6** (100/100/100/100/100/42) |
| Re-drain duration | **650s** (10m 50s) |
| Final NULL count | **0** ✓ |
| Failed jobs | **0** ✓ |
| Rate-limit hits (sustained 429) | **0** ✓ |

### 3.1 Pre-clear distribution (state set by PR #25, OLD vocab)

```json
{
  "AUTO_REPLY":     490,
  "NOT_INTERESTED": 35,
  "INTERESTED":     8,
  "BOUNCE":         5,
  "SPAM":           5
}
```

### 3.2 Post-drain distribution (V1+a vocab)

```json
{
  "AUTO_REPLY":     446,
  "NOT_INTERESTED": 41,
  "BOUNCE":         21,
  "SPAM":           20,
  "INTERESTED":     11,
  "HOT_LEAD":       3,
  "STOP":           1
}
```

Sum 446+41+21+20+11+3+1 = **543** ✓ (matches total).

**V1+a vocab impact (delta vs OLD):**

| Label | Before | After | Δ | Notes |
|---|---|---|---|---|
| AUTO_REPLY | 490 | 446 | −44 | Stronger vocab routed 44 noise-rows into specific buckets |
| BOUNCE | 5 | 21 | +16 | LLM caught more bounces with explicit BOUNCE prompt |
| SPAM | 5 | 20 | +15 | LLM caught more spam (Snov filter notices, etc.) |
| NOT_INTERESTED | 35 | 41 | +6 | Stricter detection |
| INTERESTED | 8 | 11 | +3 | Some AUTO_REPLY → INTERESTED with new "asks for info/pricing" wording |
| **HOT_LEAD** | (n/a) | **3** | **+3** | New label fired on 3 messages — vocab split working |
| STOP | 0 | 1 | +1 | New unsubscribe detection |

### 3.3 Pacing telemetry (per-iter)

| Iter | Total msgs | Short-circuit | Via LLM | Duration | LLM/min |
|---|---|---|---|---|---|
| 1 | 100 | 95 | 5 | 31s | 9.7 |
| 2 | 100 | 100 | 0 | 22s | 0 |
| 3 | 100 | 63 | 37 | 91s | 24.4 |
| 4 | 100 | 1 | 99 | 207s | 28.7 |
| 5 | 100 | 0 | 100 | 210s | 28.6 |
| 6 | 42 | 1 | 41 | 86s | 28.6 |
| **Total** | **542*** | **260** | **282** | **650s** | **avg 26.0** |

\*One row had thread_id NULL — counted in classification but not in the per-iter total. (Cosmetic; no impact on partition or ground truth.)

LLM rate sustained at 28-29/min during heavy iters (4-6) — exactly within the 30/min target with margin. Cap is 50/min on `claude-haiku-4-5-20251001`.

The empty-text short-circuit handled **260 / 542 = 48%** of all messages with no LLM call. Cost saved: ~260 × $0.0003 = ~$0.08 per drain (small in absolute, large as a steady-state savings as Snov warm-up volume grows).

## 4. Tab counts (post-deploy)

Captured against `inbox_threads` (698 rows) for `org_id=org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` via the new 6-tab predicates from [src/lib/inbox/tab-routing.ts](../src/lib/inbox/tab-routing.ts):

| Tab | Count | Notes |
|---|---|---|
| **All** | **25** | NOT (warm-up OR spam OR bounced) — real engagement + AUTO_REPLY/NOT_INTERESTED/STOP |
| **Warm Up** | **657** | 94% of threads — Snov `- wsn` subjects + self-test |
| **Interested** | **0** | No INTERESTED-classified threads escape the warm-up filter (live INTERESTED messages are all warm-up replies in current state) |
| **Hot Leads** | **0** | Same — HOT_LEAD/OBJECTION messages currently land on warm-up subjects |
| **Bounced** | **19** | 18-19 of these are also warm-up bounces (overlap; see §4.1) |
| **Spam** | **20** | 4-5 of these are also warm-up SPAM-classified (overlap) |

### 4.1 Partition discrepancy (known overlap; spec-compliant but UX follow-up)

Sum of {Warm Up + Bounced + Spam + All} = 657 + 19 + 20 + 25 = **721**, vs total **698**. **23 threads are double-counted** — primarily Snov warm-up bounces (~18) and warm-up SPAM-classified (~5).

Per the V1+a spec routing matrix, **only `All` excludes Bounced + Spam**. Bounced + Spam predicates do NOT exclude warm-up. So a Snov warm-up bounce will appear in BOTH Warm Up and Bounced tabs. That's a literal-spec read but a UX surprise.

Two clean follow-up options (V1+b candidates):

A. **Warm-up wins:** make `isBouncedThread` and `isSpamThread` short-circuit if `isWarmUpThread` fires. Snov noise stays in Warm Up only. Trade-off: real warm-up bounces are hidden from the Bounced tab (deliverability monitoring loses Snov-side bounces).

B. **Bounced wins (recommended):** make `isWarmUpThread` short-circuit if classification = BOUNCE. Snov warm-up bounces surface in Bounced (Dean wants to see deliverability problems regardless of source). Spam case is harder — could either let Spam win or keep current Warm Up ∪ Spam.

I'd ship (B) in V1+b. Not blocking V1+a — Dean can use Bounced + Warm Up in parallel today.

**The All count (25) is correct in isolation** (it explicitly excludes everything), so the default view is exactly what Dean asked for.

### 4.2 Why Interested + Hot Leads are 0

Both tabs require `NOT warm-up AND NOT spam`. The 11 INTERESTED + 3 HOT_LEAD messages live on threads whose subjects all contain `- wsn` (Snov warm-up). Real cold-email replies haven't landed yet (campaigns just started). Once they do — and given the smoke test confirmed the labels fire correctly — Interested + Hot Leads will populate automatically.

## 5. system_alerts new in window (since 2026-04-30T15:50:00Z)

```
system_alerts since 2026-04-30T15:50:00Z: 0 rows
classifier_error rows: 0  ✓
```

**Zero alerts of any kind.** No `classifier_error` (target met — pacing kept us under 429), no IMAP errors that bubbled up to alerts, no rate-limit hits. The handler-side throttle worked as designed for the entire 650s drain.

## 6. Operational follow-ups still pending

- **DATABASE_URL rotation** (Task #19) — standalone, V7-routed.
- **V1+b**: delete email + manual unsubscribe + auto-unsub on STOP (Task #22) — next session.
  - **Bonus for V1+b:** the warm-up vs bounced/spam overlap fix from §4.1 (recommended option B).
- **V2 thread-context** (Task #21) — after Snov migration.
- **Skill #15 CC-prompt-author** (Task #15).

## 7. MEMORY.md proposed append (≤ 8 lines, dated)

```
*2026-04-30 — **Unibox V1+a shipped (PR #26 MERGED, sha=3137593).** Classifier vocab split: INTERESTED redefined to "asks for general info or pricing, but does NOT ask substantive qualifying questions" (first-touch soft positive); new HOT_LEAD label for substantive engagement (pricing depth, contract terms, turnaround time, decision-maker queries, next-step asks). 6-tab UX: All / Warm Up / Interested / Hot Leads / Bounced / Spam — Interested + Hot Leads are visible subsets of All; Bounced + Warm Up + Spam are exclusive of All only (spec-literal — see deploy report §4.1: Snov warm-up bounces double-appear in Warm Up + Bounced; option-B fix queued for V1+b). Handler-side rate-limit pacing in src/worker/handlers/sync-inbox.ts (≥2000ms + 200ms jitter, 429 retry-once-then-surface to system_alerts.classifier_error) sustained 28-29 LLM/min during the redrain — well under Anthropic Haiku 50/min cap. Empty-text short-circuit (both reply_only_text + body_text empty/whitespace ⇒ AUTO_REPLY/0.95 with NO LLM call) handled 260/542 (48%) of redrain messages. handleClassifyBatch refactored from parallel-batch-of-10 to sequential paced loop; classifyBatch removed from reply-classifier.ts (only caller). test:gate0 26→28 suites (51 tab-routing + 7 vocab + 10 pacing — all green). No migration. **Smoke**: "Can you send pricing?"→INTERESTED/0.95; "What's turnaround/contract/typical client?"→HOT_LEAD/0.95 — both correct on the deployed worker. **Re-drain**: 543 messages in 650s (6 iters, 0 failed, 0 rate-limit alerts). New label distribution: AUTO_REPLY 446, NOT_INTERESTED 41, BOUNCE 21, SPAM 20, INTERESTED 11, HOT_LEAD 3, STOP 1. **Tab counts (live)**: All 25, Warm Up 657, Interested 0, Hot Leads 0, Bounced 19, Spam 20 — Interested + Hot Leads are 0 because all current INTERESTED/HOT_LEAD messages live on warm-up-subject threads (real cold-email replies haven't landed yet; smoke-test confirmed labels fire correctly). Worker on sha=3137593, systemctl=active. Saga-isolation invariant: PASS (files-changed=0). Reports: dashboard-app/reports/2026-04-29-unibox-v1a-design.md + 2026-04-29-unibox-v1a-deploy.md. Next: V1+b (delete + unsubscribe + warm-up overlap fix).*
```
