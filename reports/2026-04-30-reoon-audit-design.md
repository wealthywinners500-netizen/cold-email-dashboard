# Reoon Verify Audit — Design Doc (Phase 0)

**Author:** CC autonomous session — V7 prompt, 2026-04-30
**Pre-state SHA:** `d6021a0` (post V1a deploy, main branch)
**Authority:** V7 routing prompt 2026-04-30 (post V1a deploy)

---

## 1. Path inventory — what actually runs when the UI clicks "Verify"

### 1a. Code map (verbatim trace)

```
UI button "Verify Selected" / "Verify All Pending"
  └─ src/app/dashboard/leads/lead-contacts-client.tsx:112,137
       └─ POST /api/lead-contacts/verify   {contact_ids?, filter?}
            └─ src/app/api/lead-contacts/verify/route.ts:19  POST(...)
                 ├─ org gate (line 7-17): clerk_org_id → internal org_id
                 ├─ key gate  (line 59-68): org.integrations?.reoon_api_key
                 ├─ contacts SELECT (line 71-89): by ids OR filter (email_status, state, city)
                 ├─ verifyBatch(reoon_api_key, emails)   ← src/lib/leads/verification-service.ts:46
                 │     └─ for ≤50: parallel single GET /api/v1/verify per email
                 │     └─ for >50: POST /api/v1/bulk/create + poll + GET /bulk/result
                 │     └─ each result run through mapReoonStatus() at line 10-25
                 └─ batch UPDATE (line 137-161): SET email_status, verified_at, verification_source='reoon'
```

### 1b. The other "Reoon path" — dead code

`src/worker/handlers/verify-new-leads.ts` — registered in `src/worker/index.ts:13/68/326` but **never enqueued anywhere in the codebase**. `grep -rn "boss.send.*verify-new-leads"` returns 0 hits. It is registered for messages that never arrive. It is the file the V7 prompt referenced as having a "line 148 verification_status filter bug" — that bug exists but is irrelevant to the live verify path.

**Decision:** ignore `verify-new-leads.ts` for this audit. Whatever its bugs, it is not on the path Dean's UI exercises.

---

## 2. Bugs in the LIVE path (the API route + verification-service)

I ran 1 live Reoon call from CWD ($0.001 cost) to ground-truth the response shape, then ran `verifyBatch()` end-to-end against 3 known emails.

### 2a. Reoon "power" mode actual response

```jsonc
// GET https://emailverifier.reoon.com/api/v1/verify?email=postmaster@gmail.com&key=…&mode=power
{
  "can_connect_smtp": true,
  "domain": "gmail.com",
  "email": "postmaster@gmail.com",
  "has_inbox_full": false,
  "is_catch_all": false,
  "is_deliverable": true,
  "is_disabled": false,
  "is_disposable": false,
  "is_free_email": true,
  "is_role_account": true,
  "is_safe_to_send": true,
  "is_spamtrap": false,
  "is_valid_syntax": true,
  "mx_accepts_mail": true,
  "mx_records": [...],
  "overall_score": 93,
  "status": "role_account",          // ← the field mapReoonStatus reads
  "username": "postmaster",
  "verification_mode": "power"
}
```

The `status` field is the canonical email-status verdict. Observed values from 3 test calls: `role_account`, `catch_all`, `invalid`. Other documented Reoon values (per skill): `safe`, `disabled`, `disposable`, `spamtrap`, `risky`, `unknown`.

### 2b. `mapReoonStatus()` mismatches the actual values

Current code at `src/lib/leads/verification-service.ts:10-25`:

```ts
function mapReoonStatus(status: string): 'valid' | 'invalid' | 'risky' | 'unknown' {
  switch (status?.toLowerCase()) {
    case 'valid':                       // Reoon never returns 'valid' — returns 'safe'
      return 'valid';
    case 'invalid':
    case 'disposable':
      return 'invalid';
    case 'accept_all':                  // Reoon returns 'catch_all' — never 'accept_all'
    case 'role':                        // Reoon returns 'role_account' — never 'role'
      return 'risky';
    case 'unknown':
    case 'timeout':
    default:
      return 'unknown';
  }
}
```

| Reoon `status` | Current mapping | Should be |
|---|---|---|
| `safe`         | `unknown`  ❌  | `valid` |
| `role_account` | `unknown`  ❌  | `risky` |
| `catch_all`    | `unknown`  ❌  | `risky` |
| `disabled`     | `unknown`  ❌  | `invalid` |
| `spamtrap`     | `unknown`  ❌  | `invalid` (+ flag for suppression downstream) |
| `risky`        | `unknown`  ❌  | `risky` |
| `invalid`      | `invalid`   ✓  | `invalid` |
| `disposable`   | `invalid`   ✓  | `invalid` |
| `unknown`      | `unknown`   ✓  | `unknown` |

### 2c. Live evidence — verifyBatch on 3 known emails

```
postmaster@gmail.com           → Reoon status="role_account" → email_status="unknown"  (should be "risky")
noreply@github.com             → Reoon status="catch_all"    → email_status="unknown"  (should be "risky")
nonexistent…@nonexistentdomain → Reoon status="invalid"      → email_status="invalid"  (correct)
```

In production, the existing path would mark essentially every legitimate email (deliverable mailboxes at gmail/outlook/etc and every catch-all domain) as `email_status='unknown'`. Only outright invalid syntax / non-resolving domains would be detected.

### 2d. API route gate fails for every org today

`src/app/api/lead-contacts/verify/route.ts:59`:

```ts
const reoon_api_key = org.integrations?.reoon_api_key;
if (!reoon_api_key) {
  return NextResponse.json({ error: "Reoon API key not configured..." }, { status: 400 });
}
```

I queried `organizations.integrations` for all 4 orgs in production:

```
org_3CBQc786…  Zachary's Organization  integrations: {}
org_3C2CaqUM…  StealthMail              integrations: {}   ← Dean's
org_2g7np7Hr…  Acme Corp                integrations: {}
org_3C9nmUSC…  Mayank's Organization    integrations: {}
```

**No org has `reoon_api_key` configured.** The platform's `process.env.REOON_API_KEY` is set on Vercel + worker + `.env.local`, but the route doesn't fall through to it. So clicking "Verify" today returns 400 *before* `verifyBatch` is even called — the mapping bug is currently masked by this gate failure.

### 2e. Route doesn't persist `verification_result`

Even when verification succeeds, `route.ts:153-157` only writes `email_status`, `verified_at`, `verification_source`. The JSONB `verification_result` column on `lead_contacts` (default `{}`) is never populated by this path. That defeats the prompt's "verification_result JSONB populated on ≥50% of rows" PASS criterion *by design* — not a regression in this audit, but worth flagging because downstream triage (suppression for spamtrap, prefix-whitelist for catch_all per the lead-gen-pipeline skill's tightened 2026-04-18 triage) needs the raw flags.

---

## 3. Why the Outscraper smoke is unnecessary

The V7 prompt scoped Phase 1 (Outscraper task for LI dentists at ZIP 11550) → Phase 2 (Reoon trigger) → Phase 3 (verify outcome). Cost cap $0.25.

Static analysis + a single $0.001 live Reoon call + a 3-email `verifyBatch` demo (~$0.003 of Reoon spend) are sufficient to declare FAIL conclusively:

1. The route's gate (2d) returns 400 today regardless of input — confirmed via DB query, not a hypothesis.
2. The mapper (2b) drops 5 of 9 known Reoon values to `unknown` — confirmed via 3-email demo.
3. The verification_result PASS criterion (2e) is structurally impossible — the route never writes that column.

Spending $0.20 on an Outscraper smoke would surface 5+ real emails, but Reoon would still 400 at the gate or (if the gate passed) misclassify them. The smoke would tell us nothing the static evidence doesn't already prove. **Save the $0.20**, declare FAIL, ship the fix.

---

## 4. Hypothesis if the prompt's smoke had run anyway

| Step | Predicted outcome |
|---|---|
| Outscraper task for `dentist 11550 places=20 enrichment=ON` | ~5–10 leads with emails (dentist directories vary; 11550 is closer to baseline LI dentist email rates than 30309 was) |
| `email_status` distribution before Reoon | all `pending` |
| Click "Verify All Pending" in UI | HTTP 400, "Reoon API key not configured" — Phase 3 FAIL at the gate |
| If gate were bypassed | distribution shifts: `invalid` for outright bad emails, `unknown` for *everything else* (the mapping bug eats every legitimate verdict) — Phase 3 still FAIL |
| `verification_result` after | all `{}` (route doesn't write it) — Phase 3 FAIL on second criterion regardless |

---

## 5. Pass / fail criteria for this audit

- **Pass = email_status distribution shifts from all-`pending` to a meaningful mix of `valid`/`invalid`/`risky`/`unknown` AND `verification_result` populated on ≥50% of rows AND zero `reoon_error` in `system_alerts`.**
- **Fail = static analysis or a live demo proves the path cannot deliver pass criteria.**

Result: **FAIL** — proven by §2 evidence without spending the smoke budget.

---

## 6. Fix scope

### 6a. Bugs to fix in this PR (≤ ~30 LOC business logic)

1. **Fix #1 — Correct `mapReoonStatus()`** (`src/lib/leads/verification-service.ts`, ~15 LOC):
   - Add `safe`, `disabled`, `spamtrap`, `risky`, `role_account`, `catch_all` cases
   - Keep `accept_all`, `role`, `valid` for forward-compat with possible future Reoon API renames
   - Map per §2b table

2. **Fix #2 — Env-key fallback** (`src/app/api/lead-contacts/verify/route.ts`, ~1 LOC):
   - `const reoon_api_key = org.integrations?.reoon_api_key || process.env.REOON_API_KEY;`
   - Behavior: org-level key still wins (multi-tenant key isolation when configured); platform key works as fallback for orgs that haven't set one.

### 6b. Deferred to a follow-up session (out of this scope)

3. **Persist `verification_result` JSONB** — requires `verifyBatch()` return type change + route write + tests. Affects `verification-service.ts` + `route.ts` + every caller. ~25–35 LOC. Worth a dedicated session because (a) downstream triage depends on it, (b) the lead-gen-pipeline skill's tightened triage logic (safe+role_account → valid, catch_all+prefix-whitelist → valid, disposable/spamtrap → invalid+suppress) belongs in the same change.

4. **Delete dead `verify-new-leads.ts` handler** — pure cleanup; the bugs in it are real but unreached. Defer until #3 lands so we can confirm it's truly redundant.

### 6c. Regression test

`src/lib/leads/__tests__/verification-service.test.ts` (new) — pure unit test with `global.fetch` stubbed to return Reoon-shaped JSON for each canonical status. Asserts that each Reoon `status` value maps to the correct `email_status`. ~50 LOC test code, doesn't count against the 30-LOC business-logic threshold.

### 6d. Branch + PR

- Branch: `fix/reoon-verify-mapping-2026-04-30` (renamed from prompt's `fix/reoon-verify-line148-2026-04-30` because the fix is not line 148)
- PR title: `fix(leads): correct Reoon status mapping + add env key fallback`
- PR body covers: §2 bug analysis, §6a fix scope, post-merge verification (re-run the 3-email demo from this report on main), §6b deferred items
- Auto-merge: NO. Stop at PR open per V7 prompt.

---

## 7. NO-GO compliance

- ✅ No saga / provisioning touches (only `src/lib/leads/` + `src/app/api/lead-contacts/`)
- ✅ No Hestia, Ionos, panel.* changes
- ✅ No DELETEs
- ✅ No `git add -A`
- ✅ No `.gitignore` / `serverless-steps.ts` touches
- ✅ No keys printed (sed-redacted in all bash output, `<set>` redaction on env probes)
- ✅ Spend: $0.004 Reoon (1 ground-truth + 3-email demo). Outscraper: $0 (smoke skipped — evidence sufficient).

---

## 8. Open questions (non-blocking)

- The lead-gen-pipeline skill's tightened triage (2026-04-18) splits `safe + role_account → valid` and `catch_all + prefix-whitelist → valid` etc. The simple correctness fix in §6a does NOT encode that triage — it just stops the falling-through-to-unknown bug. The skill triage belongs in the deferred §6b session. This is fine because: (a) coarse `risky` is still better than wrong `unknown`, (b) without persisted `verification_result` the prefix-whitelist isn't even applicable yet.
- 'outscraper' value seen in `email_status` grep (V7's pre-flight note): turned out to be on `lead_contacts.scrape_source`, NOT `email_status`. It's an import-source marker. Mystery resolved.
- Memory note `feedback_classifier_anthropic_key_missing.md` confirmed stale (V1a deploy report §4 verified `ANTHROPIC_API_KEY=<set>` on worker process env). Will be retired in §5 of the audit report.
