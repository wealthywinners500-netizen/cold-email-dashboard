# Reoon Verify Audit — Final Report

**Date:** 2026-04-30 (UTC ~22:00–23:30)
**Operator:** CC autonomous session (Opus 4.7), V7 prompt
**Pre-state SHA:** `d6021a0` (post V1a deploy, main)
**Branch:** `fix/reoon-verify-mapping-2026-04-30`
**Outcome:** **FAIL → fix PR open** — existing path could not produce correct `email_status` updates on a fresh list. Two bugs identified, fixed, and shipped behind a 30-LOC patch + 18-assertion regression test.

---

## 1. The question, restated

> Does the existing Reoon verify path produce correct `email_status` updates on a fresh list with real emails?

**Answer: No.** Static analysis + a $0.004 live Reoon probe against three known-status emails (no Outscraper smoke needed, see §3) prove two distinct bugs that together render the path unable to deliver pass criteria. Outscraper smoke skipped — evidence sufficient.

---

## 2. Path traced

```
UI "Verify Selected" / "Verify All Pending"
  └─ POST /api/lead-contacts/verify   (src/app/api/lead-contacts/verify/route.ts)
       └─ verifyBatch(...)            (src/lib/leads/verification-service.ts)
            └─ Reoon /api/v1/verify (per-email, ≤50) or /bulk (>50)
            └─ mapReoonStatus(reoon.status) → email_status enum
       └─ UPDATE lead_contacts SET email_status, verified_at, verification_source='reoon'
```

The orphan `src/worker/handlers/verify-new-leads.ts` (the file the V7 prompt cited as having a "line 148 verification_status filter bug") is registered in `src/worker/index.ts` but **never enqueued** — `grep -rn "boss.send.*verify-new-leads"` returns 0 hits. Whatever bugs it has are unreached. Not in scope.

---

## 3. Bugs

### 3a. `mapReoonStatus()` mismatched Reoon's actual response shape

Live Reoon Power-mode response (1 ground-truth call, $0.001):

```jsonc
{
  "status": "role_account",   // ← the field mapReoonStatus reads
  "is_safe_to_send": true, "is_role_account": true,
  "is_catch_all": false, "is_disabled": false, "is_spamtrap": false,
  "is_disposable": false, "is_valid_syntax": true, ...
}
```

`mapReoonStatus()` only handled `valid`, `invalid`, `disposable`, `accept_all`, `role`, `unknown`, `timeout`. Live Reoon returns `safe`, `role_account`, `catch_all`, `disabled`, `spamtrap`, `risky`. Five canonical values fell through to `unknown`.

3-email demo against the unfixed mapper ($0.003):

```
postmaster@gmail.com     Reoon "role_account" → email_status="unknown"  (should be "risky")
noreply@github.com       Reoon "catch_all"    → email_status="unknown"  (should be "risky")
nonexistent@…            Reoon "invalid"      → email_status="invalid"  (correct)
```

**Production impact:** any deliverable mailbox that Reoon classified as `safe`, `role_account`, or `catch_all` would land in `email_status='unknown'`. Mass mis-classification.

### 3b. API route gated on org-level Reoon key that no org has

`src/app/api/lead-contacts/verify/route.ts:59` read `org.integrations?.reoon_api_key` and 400'd if absent. DB query against all 4 production orgs:

```
org_3CBQc786…  Zachary's Organization   integrations: {}
org_3C2CaqUM…  StealthMail (Dean)       integrations: {}
org_2g7np7Hr…  Acme Corp                integrations: {}
org_3C9nmUSC…  Mayank's Organization    integrations: {}
```

The platform-level `process.env.REOON_API_KEY` is set on Vercel + worker + `.env.local` (per the V1a deploy report) but the route never read it. So clicking "Verify" today returns 400 *before* `verifyBatch` is even called — bug 3a was masked by 3b.

### 3c. (Noted, not fixed) Route never persists `verification_result`

`route.ts:153–157` writes only `email_status`, `verified_at`, `verification_source`. The `lead_contacts.verification_result` JSONB column stays at its `{}` default. Sample row from the V1a smoke list confirms this — `verification_result` is `{}` on all 10 rows. Defeats the prompt's "≥50% of rows" PASS criterion structurally. Deferred to a dedicated session because (a) it requires changing `verifyBatch`'s return type + every caller, and (b) the lead-gen-pipeline skill's tightened triage (safe+role_account+prefix-whitelist → valid; spamtrap → suppress) belongs in the same change.

---

## 4. Fix shipped on `fix/reoon-verify-mapping-2026-04-30`

| Change | File | LOC |
|---|---|---|
| Expand `mapReoonStatus()` to handle `safe`, `role_account`, `catch_all`, `disabled`, `spamtrap`, `risky`. Keep legacy aliases (`valid`, `accept_all`, `role`) for forward-compat. Export for testability. | `src/lib/leads/verification-service.ts` | +11 / -1 |
| Add platform-key fallback: `org.integrations?.reoon_api_key \|\| process.env.REOON_API_KEY`. Org-level still wins for tenant isolation. | `src/app/api/lead-contacts/verify/route.ts` | +4 / -2 |
| Wire new test into `test:gate0`. | `package.json` | +1 / -1 |
| New regression test — 18 assertions covering canonical Reoon values, legacy aliases, defensive defaults, and `verifyBatch` end-to-end with stubbed fetch. | `src/lib/leads/__tests__/verification-service.test.ts` (new) | +127 / 0 |

**Business-logic delta: 15 LOC** across 3 files (under the V7 prompt's 30-LOC threshold).

### 4a. Test results on the fix branch

```
test:gate0:  33 suites, all passing  (18/18 new assertions pass)
typecheck:   tsc --noEmit clean
build:       Compiled successfully in 4.9s
```

### 4b. Post-merge verification plan (for Dean / next session)

Once the PR merges and Vercel redeploys:

1. **Same 3-email Reoon probe**, post-fix, expected mapping:
   ```
   postmaster@gmail.com  → email_status="risky"   (was "unknown")
   noreply@github.com    → email_status="risky"   (was "unknown")
   nonexistent@…         → email_status="invalid" (unchanged)
   ```
2. **One-click UI verify** on the V1a smoke list (10 rows, all with `email=NULL`) — should return `{"verified":0,"valid":0,"invalid":0,"risky":0}` (no emails to verify, but no longer 400). Confirms the gate fix.
3. **Scrape a real-email list** (LI dentists 11550, places=20) → click "Verify All Pending" → distribution should shift from `pending` to a mix of `valid`/`invalid`/`risky`/`unknown`. That is the "Phase 1 + 2 + 3" the V7 prompt scoped, deferred until the fix is merged.

---

## 5. Skipped phases — why

| Prompt phase | What it asked | Why skipped |
|---|---|---|
| Phase 1 (Outscraper smoke for LI dentists 11550) | $0.20, scrape ~20 leads with emails | Static + 3-email live demo proved FAIL conclusively. Real emails would still 400 at the gate (3b) or misclassify (3a). |
| Phase 2 (Reoon trigger via existing endpoint) | Trigger /api/lead-contacts/verify | Same — endpoint returns 400 today regardless of input. |
| Phase 3 (verify outcome) | Diff `email_status` distribution before/after | Nothing to diff; the path can't run. |

Net Reoon spend this session: **$0.004**. Outscraper: $0.

---

## 6. NO-GO / scope compliance

- ✅ No saga / `src/lib/provisioning/` touches
- ✅ No Hestia, Ionos, panel.* changes
- ✅ No DELETEs (only the 1 INSERT into `system_alerts` from the V1a smoke remains; nothing touched here)
- ✅ No `git add -A` — explicit file list only
- ✅ No `.gitignore` / `serverless-steps.ts` touches
- ✅ No keys printed (sed-redacted in all bash output, `<set>` redaction on env probes)
- ✅ Spend: $0.004 Reoon (1 ground-truth + 3-email demo) — well under $0.25 cap
- ✅ Auto-merge: NO. PR opened, awaiting Dean review per V7 prompt.
- ✅ Stayed within 2-hr session budget.

---

## 7. Recommendation for next session

**If Dean merges the fix PR and Vercel redeploys:** route the deferred items into one focused session:

1. **Persist `verification_result` JSONB** — change `verifyBatch`'s return shape to include `raw_result` per email, write it to `lead_contacts.verification_result` from the route. Required by the lead-gen-pipeline skill's tightened triage.
2. **Encode the tightened triage** (safe + role_account + prefix-whitelist → valid; catch_all + prefix-whitelist → valid; disposable / spamtrap → invalid + suppress) — needs the raw flags from #1.
3. **Delete the orphan `verify-new-leads.ts` worker handler** + its `worker/index.ts` registration — pure cleanup, confirmed dead.
4. **(Then)** the original V7 plan: scrape LI dentists 11550 + verify + load sequences + fire campaign smoke.

**If Dean wants to defer the deferred-items session:** the current fix unblocks "click Verify and get correct verdicts." Sequences-load + campaign-fire could proceed using the coarse `risky` bucket (no prefix-whitelist refinement), accepting that some legitimate `role_account`/`catch_all` mailboxes would be excluded as `risky` rather than promoted to `valid`. Lower-quality but functional.

---

## 8. MEMORY.md append (≤8 lines, dated)

To be applied in §9 below; new project memory file `project_reoon_verify_audit_2026-04-30.md` and new index entry pointing at it.

Also: retire `feedback_classifier_anthropic_key_missing.md` — confirmed stale by the V1a deploy report (worker `/proc/<pid>/environ` shows `ANTHROPIC_API_KEY=<set>`).

Also: amend `project_leads_v1a_status.md` body to note the Reoon path bugs now exist on a fix PR.

---

## 9. Files touched this session

### Code (PR'd on `fix/reoon-verify-mapping-2026-04-30`)
- `src/lib/leads/verification-service.ts` (mapper + export)
- `src/app/api/lead-contacts/verify/route.ts` (env fallback)
- `src/lib/leads/__tests__/verification-service.test.ts` (new)
- `package.json` (test:gate0 wiring)

### Reports (also on the PR branch)
- `reports/2026-04-30-reoon-audit-design.md`
- `reports/2026-04-30-reoon-audit.md` (this file)

### Production state
- **No changes.** No DB writes, no env edits, no SSH to worker, no Vercel toggles. The V1a smoke list `60dff323-…` still has 10 rows, all `email_status='pending'`, untouched.

### Memory (auto-memory directory, applied in §10 of this session)
- New: `project_reoon_verify_audit_2026-04-30.md`
- Updated: `MEMORY.md` index (1 new entry, 1 retirement)
- Retired: `feedback_classifier_anthropic_key_missing.md` (stale per V1a deploy evidence)
