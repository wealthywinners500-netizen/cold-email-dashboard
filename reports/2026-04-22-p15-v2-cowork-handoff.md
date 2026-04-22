# P15-v2 Handoff to Cowork — 2026-04-22

**Purpose:** Dean is closing the current Claude Code monitor session and needs Cowork (Master Command Center) to produce a fresh, up-to-date CC prompt for a new monitor session. This file is the ground truth Cowork should read first to generate that prompt.

---

## TL;DR

P15-v2 has now had **two BLOCKED attempts in sequence**, for **two different root causes**, neither of which exercised the PR #18 SOA-fix chain. Gate 0 remains BLOCKED. P16 is not safe to click. A third attempt is next; the cleanest path uses the **same NS slate** (`lavine.info` + 10 already-selected sending domains) with the orphan Linodes from Attempt 1 already manually deleted by Dean.

**Also: one real saga bug was surfaced** (orphan Linodes on `MAX_IP_REROLL_ATTEMPTS` exhaustion) — worth a fix before the next launch cycle, but NOT blocking a third attempt now that Dean cleaned up manually.

---

## State at handoff time (2026-04-22T15:49Z)

### Attempt 1 — job `c0d3a1d1-a44c-4f90-b666-604d6300c4dc`

- **Status:** `failed`
- **Region config:** `us-central` + `us-southeast`
- **Step 1 `create_vps`:** failed after **10m 13s** (6 IP pre-check attempts)
- **Error:** `IP pre-check failed after 6 attempts. Last failure: BLACKLISTED [72.14.190.77: Barracuda]. All 6 Linode IP pairs either had blacklist hits or shared a /12 subnet. Try different regions or contact Linode support.`
- **Root cause:** Linode IP-pool pollution in `us-central` + `us-southeast`. Every reroll produced a Barracuda-listed IP (or a same-`/12` pair). **Saga worked as designed** — PATCH 20 / `ip-blacklist-check.ts` enforces zero-tolerance at pre-check; HL #130's WARN-only scope is the operational sweep (Gate 2), not `create_vps`. Not a saga bug — an external IP-pool condition.
- **Archive report:** `reports/2026-04-22-p15-v2-attempt-1-blocked.md`

### Attempt 2 — job `df95173c-1c07-49a9-9d68-73b83184c729`

- **Status:** `failed`
- **Region config:** `us-central` + `us-west` (Dean changed s2 from `us-southeast` to `us-west` after Attempt 1)
- **Step 1 `create_vps`:** failed after **4.2 s** (first Linode create API call)
- **Error:** `HTTP 400 from linode: {"errors": [{"reason": "Label must be unique among your linodes", "field": "label"}]}`
- **Root cause:** **Real saga bug (new).** When Attempt 1's `create_vps` loop exhausted `MAX_IP_REROLL_ATTEMPTS = 5` at provision-step.ts:358-366, the throw path did **not** delete the current-iteration Linodes before exiting. Result: the 6th reroll's Linodes (labels `mail1-lavine-info` + `mail2-lavine-info`) stayed live on Dean's Linode account. Attempt 2's first `provider.createServer({ name: 'mail1-lavine-info', ... })` call hit Linode's label-uniqueness constraint and failed instantly.
- **Dean's mitigation (already done, 2026-04-22T~15:46Z):** Manually deleted the orphan Linodes at cloud.linode.com. The constraint is now clear; a third attempt should not hit this label issue.

### Attempt 3 — NOT YET DISPATCHED at handoff

- As of 2026-04-22T15:49:58Z there is **no new `provisioning_jobs` row** after `15:41:35Z` and `df95173c` remains `status=failed` (not re-dispatched). Dean indicated he'd restart; whichever path he takes (fresh Provision click → new job row, or some job-retry endpoint → same job_id re-dispatched) the new CC session will need to handle both.

---

## What's been proven (this session, beyond the BLOCKEDs)

1. The P15-v2 domain slate (`lavine.info` NS + `carosi.info`, `cirone.info`, `lodema.info`, `luvena.info`, `marife.info`, `morice.info`, `norita.info`, `renita.info`, `valone.info`, `verina.info`) is **valid Namecheap inventory**, **CLEAN on DBL/SURBL**, **uncollided against existing `server_pairs` + any sending-domain rows**, and does **not need re-picking** for a third attempt. Keep the slate.
2. The P14 orphan posture (`server_pairs.id=fbc03039-00db-4b93-b996-da16c1345814` + `ssh_credentials` rows for IPs `173.230.132.245` and `45.33.63.216`) is **untouched** — all queries were read-only, nothing was written.
3. Repo is still at `a573f9b` on `main` (ahead of PR #18 merge `7b64ad3`). No saga code edits made this session.
4. **Zero new `ssh_credentials` rows** were persisted for either failed attempt (confirmed via `ssh_credentials WHERE created_at > '2026-04-22T15:00:00Z'` → 0 rows). No DB cleanup needed on the app side.

---

## What is still UNPROVEN (and blocks P16)

**The entire PR #18 SOA-fix chain.** Neither failed attempt got past Step 1 `create_vps`, so none of these PR-#18 surfaces executed:

- `patchDomainSHSOATemplate` at Step 2 `install_hestiacp`
- Un-swallowed `v-change-dns-domain-soa` exit-code handling at `hestia-scripts.ts:285-290`
- `validateSOASerialFormat` in `verification-checks.ts` (Check 5)
- `fix_soa_serial_format` auto-fix in `auto-fix.ts`

Gate 0 remains **BLOCKING**. P16 is gated on a GREEN P15-v2 end-to-end run.

---

## Saga bug surfaced this session (HL candidate)

**When `create_vps` exhausts `MAX_IP_REROLL_ATTEMPTS`, the current-iteration Linodes are orphaned.** See `src/worker/handlers/provision-step.ts:358-366`:

```typescript
if (rerollAttempt === MAX_IP_REROLL_ATTEMPTS) {
  // Exhausted all retries — fail the step
  throw new Error(`IP pre-check failed after ${MAX_IP_REROLL_ATTEMPTS + 1} attempts. ...`);
  // ^^^ BUG: server1.id and server2.id (the current iteration's Linodes) are
  //     NEVER deleted before this throw. Compare to the continuing-reroll
  //     path at lines 373-375 which DOES delete both.
}
```

**Impact:** a retry with the same `ns_domain` hits Linode's label-uniqueness constraint on the first `createServer` call of Attempt 2 and fails in <5 seconds. The operator (Dean) must manually delete the orphan Linodes at cloud.linode.com before the retry can proceed — exactly what happened today.

**Recommended fix (not done this session — out of scope for monitoring):** in the exhausted-reroll branch, wrap the current `server1.id` / `server2.id` in a `try { await provider.deleteServer(...) }` pair **before** the throw, so the saga cleans up after itself. Or, alternatively, use a `finally` block on the outer try/catch around the whole reroll loop.

**This is NEW and worth an HL.** Proposing HL #136: *"On `create_vps` reroll exhaustion, the final-iteration Linodes are orphaned — retry with same `ns_domain` fails on Linode label uniqueness until operator manually deletes them."*

---

## What the NEW Cowork-generated CC prompt should cover

A fresh CC session picking up for Attempt 3 needs the following differences from the existing `reports/2026-04-22-cc-prompt-p15-v2.md`:

### 1. Phase 1 — job discovery must handle BOTH paths

Attempt 3 may be dispatched as (a) a fresh `provisioning_jobs` row, or (b) a re-dispatch on the same `df95173c-1c07-49a9-9d68-73b83184c729` id. The query should accept either:

```sql
-- Path A: new job row after the two failed ones
SELECT * FROM provisioning_jobs
WHERE created_at > '2026-04-22T15:41:35Z'
  AND ns_domain = 'lavine.info'
ORDER BY created_at DESC LIMIT 1;

-- Path B: df95173c transitioned back to in_progress
SELECT status, current_step FROM provisioning_jobs
WHERE id = 'df95173c-1c07-49a9-9d68-73b83184c729';
```

If neither transitions within 10 min of session start, BLOCKED (Dean didn't click).

### 2. Phase 0 — orient addition

Add a paragraph explaining:
- Attempts 1 and 2 are already BLOCKED; their job_ids are `c0d3a1d1-a44c-4f90-b666-604d6300c4dc` and `df95173c-1c07-49a9-9d68-73b83184c729`.
- P14 orphan posture unchanged (do not touch).
- The orphan-Linode-on-reroll-exhaustion bug is known; if Attempt 3 also hits IP pre-check exhaustion, tell Dean to manually clean up before Attempt 4 or accept that this saga bug must be patched before the next retry.

### 3. Phase 5 — archive reports must be listed

Memory updates should cross-reference:
- `reports/2026-04-22-p15-v2-attempt-1-blocked.md`
- `reports/2026-04-22-p15-v2-cowork-handoff.md` (this file)
- The new attempt-3 final report (write path depends on outcome)

### 4. Region guidance

`us-central` + `us-west` is the current running config. If Attempt 3 hits IP pre-check exhaustion again, **rotate s1** (not just s2) on Attempt 4 — try `us-ord` (Chicago) or `us-iad` (Washington) as primary. The account's observed-clean pairs so far: `us-central` + `us-sea` (proven on P14 2026-04-21). Consider falling back to that pair if Attempt 3 re-lists.

### 5. Also: fold in HL #136 authoring

Since Cowork owns `feedback_hard_lessons.md`, it can either author HL #136 itself as part of the new prompt or hand that task to the new CC session. Recommend Cowork authors it now (since the bug is already understood) and the new CC prompt only cites it.

---

## Files written this session

- `reports/2026-04-22-p15-v2-attempt-1-blocked.md` — full BLOCKED-at-Attempt-1 analysis
- `reports/2026-04-22-p15-v2-cowork-handoff.md` — this file
- Memory files updated in the same commit: see Phase 5 below

---

## Memory updates (Phase 5) — committed alongside this report

- `.auto-memory/MEMORY.md` — new dated line under 2026-04-22: "P15-v2 Attempts 1+2 BLOCKED; Gate 0 unchanged; see handoff"
- `.auto-memory/project_server_deployment.md` — new "Halted attempts" sub-section with both job_ids + root causes
- `.auto-memory/project_saas_dashboard.md` — Gate 0 remains BLOCKED; reason updated with today's two failure modes
- `.auto-memory/feedback_rebuild_assessment.md` — preserves Gate 0 BLOCKED; appends today's attempts summary
- `.auto-memory/feedback_hard_lessons.md` — appends HL #136 on the orphan-Linode bug

---

## One-line verdict for Dean

**Gate 0 still BLOCKED. Do NOT click Provision on P16. After Cowork regenerates the CC prompt, the new CC session will monitor Attempt 3 of P15-v2 (same `lavine.info` slate, same `us-central`+`us-west` config) — with orphan Linodes already cleared by Dean. If Attempt 3 reaches Step 2, the PR #18 SOA-fix chain finally gets its first real test.**
