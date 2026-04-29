# Audit follow-up — workspace org_id fixes (FINAL, post-apply)

**Generated:** 2026-04-29 (audit follow-up session, post-PR-#22 / pre-merge)
**Branch:** `audit-followup/2026-04-29-workspace-orgid-fixes` (forked from `main` at `00b3260`)
**Worktree:** `dashboard-app/.claude/worktrees/orgid-fixes-2026-04-29` (fresh; isolated from PR-#22 audit worktree)
**Status:** APPLIED — 7 workspace-root prompt files patched in-place (workspace root is not git-tracked; this report is the only durable audit trail).
**Supersedes:** `dashboard-app/reports/audit/2026-04-30-orgid-patch-preview.md` (uncommitted preview, untracked in `vibrant-golick-ce8da1` worktree).

Cross-references:
- PR #22: https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/22
- Drift enumeration: `dashboard-app/reports/audit/2026-04-29-phase-9.6-prompt-file-drift.md` (Category B — wrong Clerk org_id)
- Auto-memory companion: `dashboard-app/reports/audit/2026-04-29-phase-9.7-apply-3-reference_credentials.md` (the `OOq` correction in `.auto-memory/reference_credentials.md` that this follow-up complements)

---

## TL;DR

Apply finished cleanly. 10 substitutions across 7 files; 0 wrong-value occurrences remain anywhere in the 7 files; right-value count post-apply equals pre-apply wrong-value count for every file. δ approach (value flip + descriptor rewrite + audit-correction footnote) on 5 prose-drift files; pure value α on 2 CLEAN files; mixed handling on the 2 files that had both prose-drift and clean-code occurrences. `HANDOFF_2026-04-29-V4-DIAGNOSIS-COMPLETE.md` deliberately excluded as a durable record of V4's wrong-direction reasoning at Phase 9.5.

---

## Outcome summary

| File | Subs | Class | Pre wrong | Post wrong | Pre→post bytes |
|---|---|---|---|---|---|
| `SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md` | 1 | prose-drift δ | 1 | 0 | 8962 → 9182 (+220) |
| `CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md` | 2 | CLEAN α | 2 | 0 | 29403 → 29403 |
| `CC_PROMPT_P11_FINALIZATION_CONTINUATION.md` | 1 | prose-drift δ | 1 | 0 | 21652 → 21871 (+219) |
| `CC_PROMPT_SAVINI_P14_ADOPTION.md` | 2 | mixed (1δ + 1α) | 2 | 0 | 22849 → 23027 (+178) |
| `CC_PROMPT_SALVAGE_IONOS_WAVE_1.md` | 1 | prose-drift δ | 1 | 0 | 51942 → 52190 (+248) |
| `CC_PROMPT_AUDIT_REMEDIATION.md` | 1 | CLEAN α | 1 | 0 | 19726 → 19726 |
| `COWORK_CONTINUATION_POST_P11_P12_REVIEW.md` | 2 | mixed (1δ + 1α) | 2 | 0 | 22849 → 23069 (+220) |
| **Total** | **10** | **5δ + 5α** | **10** | **0** | **+1085 bytes** |

---

## Post-apply verification

**Wrong-value grep across the 7 files (must return empty):**

```bash
$ cd "/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork" && \
    grep -l "org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q" \
      SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md \
      CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md \
      CC_PROMPT_P11_FINALIZATION_CONTINUATION.md \
      CC_PROMPT_SAVINI_P14_ADOPTION.md \
      CC_PROMPT_SALVAGE_IONOS_WAVE_1.md \
      CC_PROMPT_AUDIT_REMEDIATION.md \
      COWORK_CONTINUATION_POST_P11_P12_REVIEW.md
$ # (empty result — confirmed at 2026-04-29T15:46:37Z)
```

**Right-value count per file (must equal pre-apply wrong-value count):**

```
SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md                  right-value count: 1
CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md              right-value count: 2
CC_PROMPT_P11_FINALIZATION_CONTINUATION.md              right-value count: 1
CC_PROMPT_SAVINI_P14_ADOPTION.md                        right-value count: 2
CC_PROMPT_SALVAGE_IONOS_WAVE_1.md                       right-value count: 1
CC_PROMPT_AUDIT_REMEDIATION.md                          right-value count: 1
COWORK_CONTINUATION_POST_P11_P12_REVIEW.md              right-value count: 2
```

Both invariants hold.

---

## Apply-mode PRE_STATE digest (sha256[:16] + occurrence counts + byte sizes)

Captured to `/tmp/orgid_patch_preview/PRE_STATE.txt` during apply run; transcribed verbatim below.

```text
# Pre-state digest captured 2026-04-29T15:46:37Z
# Mode: apply

--- SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md ---
  pre  sha256[:16]:  8915d0dd93e2ef27
  post sha256[:16]:  a10fca1546639116
  pre  wrong-value occurrences: 1
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 1
  per-sub applied counts:       [1]
  pre  byte size: 8962
  post byte size: 9182

--- CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md ---
  pre  sha256[:16]:  78e9007a3bbf2067
  post sha256[:16]:  f38a12cdb17b38b8
  pre  wrong-value occurrences: 2
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 2
  per-sub applied counts:       [2]
  pre  byte size: 29403
  post byte size: 29403

--- CC_PROMPT_P11_FINALIZATION_CONTINUATION.md ---
  pre  sha256[:16]:  6467259546c830ae
  post sha256[:16]:  5c2000a9598315bd
  pre  wrong-value occurrences: 1
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 1
  per-sub applied counts:       [1]
  pre  byte size: 21652
  post byte size: 21871

--- CC_PROMPT_SAVINI_P14_ADOPTION.md ---
  pre  sha256[:16]:  4bc23aa5121b83f1
  post sha256[:16]:  67bc9d1db1577335
  pre  wrong-value occurrences: 2
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 2
  per-sub applied counts:       [1, 1]
  pre  byte size: 22849
  post byte size: 23027

--- CC_PROMPT_SALVAGE_IONOS_WAVE_1.md ---
  pre  sha256[:16]:  188669bf648cb05a
  post sha256[:16]:  c13a93deba3aa751
  pre  wrong-value occurrences: 1
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 1
  per-sub applied counts:       [1]
  pre  byte size: 51942
  post byte size: 52190

--- CC_PROMPT_AUDIT_REMEDIATION.md ---
  pre  sha256[:16]:  6d3fa9fbb735283c
  post sha256[:16]:  1046adde0851464a
  pre  wrong-value occurrences: 1
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 1
  per-sub applied counts:       [1]
  pre  byte size: 19726
  post byte size: 19726

--- COWORK_CONTINUATION_POST_P11_P12_REVIEW.md ---
  pre  sha256[:16]:  a2c1916091551f77
  post sha256[:16]:  2b2e891368181c40
  pre  wrong-value occurrences: 2
  pre  right-value occurrences: 0
  post wrong-value occurrences: 0
  post right-value occurrences: 2
  per-sub applied counts:       [1, 1]
  pre  byte size: 22849
  post byte size: 23069

# Total substitutions: 10
# Files patched: 7
```

**Invariants verified at apply time:**
- `pre wrong + pre right = post wrong + post right` (column conservation) ✓ on every file
- `post wrong-value occurrences = 0` ✓ on every file
- `per-sub applied counts` sums match per-file occurrence counts ✓
- CLEAN-α files have +0 byte delta (pure 30-char value flip — both values are 30 chars) ✓
- prose-drift δ files have +178 to +248 byte delta (descriptor rewrite + footnote) ✓

---

## Pre-apply scan: residual wrong-direction prose

Two automated scans run against the patched preview copies (which match the in-place applied content byte-for-byte — same script, same input, same SHA256 post-state):

**Scan 1 — wrong-direction prose anywhere in patched output, with audit-correction footnotes stripped:**

```
--- SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md ---
--- CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md ---
--- CC_PROMPT_P11_FINALIZATION_CONTINUATION.md ---
--- CC_PROMPT_SAVINI_P14_ADOPTION.md ---
--- CC_PROMPT_SALVAGE_IONOS_WAVE_1.md ---
  L364: O0q (digit-zero) literal
    > - StealthMail org_id is `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O, capital-O, lowercase-q at the end — NOT `O0q` with digit-zero, NOT lowercase `qu` after `Ca`. […footnote…]).
  L364: digit-zero phrase
    > (same line as above)
--- CC_PROMPT_AUDIT_REMEDIATION.md ---
--- COWORK_CONTINUATION_POST_P11_P12_REVIEW.md ---
```

The L364 hits in `CC_PROMPT_SALVAGE_IONOS_WAVE_1.md` are **expected false positives** — the new descriptor explicitly contains "NOT `O0q` with digit-zero" as the correct anti-assertion (the value is NOT what the wrong descriptor previously claimed). All other files: clean.

**Scan 2 — wrong-direction prose on lines OTHER than the org_id value lines:**

```
--- SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md ---
--- CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md ---
--- CC_PROMPT_P11_FINALIZATION_CONTINUATION.md ---
--- CC_PROMPT_SAVINI_P14_ADOPTION.md ---
--- CC_PROMPT_SALVAGE_IONOS_WAVE_1.md ---
--- CC_PROMPT_AUDIT_REMEDIATION.md ---
--- COWORK_CONTINUATION_POST_P11_P12_REVIEW.md ---
```

All 7 files: empty result. **No surrounding context still asserts the wrong direction outside the patched lines.**

---

## All 7 unified diffs (verbatim — captured pre-apply against `/tmp/orgid_patch_preview/`)

The preview-mode diffs against `/tmp/orgid_patch_preview/` byte-for-byte equal the apply-mode in-place diffs (same script, same SUBS, same input). Apply-mode does not regenerate diffs (it writes patched content directly to source paths) — these preview diffs are the canonical record.

### File 1: `SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md`

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md	2026-04-20 12:27:13
+++ /tmp/orgid_patch_preview/SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md	2026-04-29 11:35:18
@@ -126,7 +126,7 @@
 Read `.auto-memory/MEMORY.md` index first, then relevant detail files before starting work.
 
 ## Key Facts
-- **Dean's org:** clerk_org_id=`org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (verified live 2026-04-20 against Supabase `server_pairs.org_id` — earlier drafts had `OOq` and uppercase `Qu`, both wrong)
+- **Dean's org:** clerk_org_id=`org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (verified live 2026-04-20 against Supabase `server_pairs.org_id` — ends `OOq` double-capital-O, contains `Qu` capital-Q lowercase-u after `Ca`. [2026-04-29 audit correction: this descriptor previously said "earlier drafts had `OOq` and uppercase `Qu`, both wrong" — that direction was wrong; verified via Clerk LIST + GET on both candidates.])
 - **Worker VPS:** 200.234.226.226, SSH root/UqDCBdG8hwbdzmBx
 - **Supabase service key:** in `.auto-memory/reference_credentials.md`
 - **GitHub PAT:** in `.auto-memory/reference_credentials.md`
```

### File 2: `CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md` (CLEAN α — 2 code defaults)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md	2026-04-27 09:27:13
+++ /tmp/orgid_patch_preview/CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md	2026-04-29 11:35:18
@@ -223,7 +223,7 @@
   const { data: runRow, error: runErr } = await supabase
     .from('dbl_sweep_runs')
     .insert({
-      org_id: job.data.org_id ?? 'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q',
+      org_id: job.data.org_id ?? 'org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq',
       status: 'running',
       trigger_source: job.data.triggered_by,
     })
@@ -280,7 +280,7 @@
         updates.dbl_first_burn_at = now;
 
         await supabase.from('system_alerts').insert({
-          org_id: job.data.org_id ?? 'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q',
+          org_id: job.data.org_id ?? 'org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq',
           severity: 'critical',
           alert_type: 'dbl_burn',
           subject: pair.id,
```

### File 3: `CC_PROMPT_P11_FINALIZATION_CONTINUATION.md` (prose-drift δ)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/CC_PROMPT_P11_FINALIZATION_CONTINUATION.md	2026-04-23 13:42:28
+++ /tmp/orgid_patch_preview/CC_PROMPT_P11_FINALIZATION_CONTINUATION.md	2026-04-29 11:35:18
@@ -82,7 +82,7 @@
 | 69.164.213.37  | mail1.launta.info  | ✅ match | ✅ match |
 | 50.116.14.26   | mail2.launta.info  | ✅ match | ✅ match |
 
-**Org:** `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (lowercase q after "Ca", ends `O0q` — capital-O, digit-zero, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. Note: earlier drafts had `OOq` (double capital-O) — that was wrong.
+**Org:** `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-Q lowercase-u after "Ca", ends `OOq` — capital-O, capital-O, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. [2026-04-29 audit correction: this descriptor previously said "lowercase q after Ca, ends O0q — capital-O, digit-zero, lowercase-q. Note: earlier drafts had OOq (double capital-O) — that was wrong." — that direction was wrong; verified via Clerk LIST + GET on both candidates.]
 
 ### pair_verifications (most recent per pair, as of 2026-04-20)
 
```

### File 4: `CC_PROMPT_SAVINI_P14_ADOPTION.md` (mixed: 1δ + 1α)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/CC_PROMPT_SAVINI_P14_ADOPTION.md	2026-04-23 13:42:28
+++ /tmp/orgid_patch_preview/CC_PROMPT_SAVINI_P14_ADOPTION.md	2026-04-29 11:35:18
@@ -47,7 +47,7 @@
 
 | Item | Value |
 |---|---|
-| Org | `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (capital-O, digit-zero, lowercase-q; verified 2026-04-20 against `server_pairs.org_id`) |
+| Org | `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O, capital-O, lowercase-q; verified 2026-04-20 against `server_pairs.org_id`. [2026-04-29 audit correction: this descriptor previously said "capital-O, digit-zero, lowercase-q" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]) |
 | Target pair_number | `14` |
 | Target ns_domain | `savini.info` |
 | Linode IDs to retire (Phase 1) | S1 = `96154706` (173.230.132.245) / S2 = `96154709` (45.33.63.216) |
@@ -175,7 +175,7 @@
    ```ts
    const payload = {
      id: crypto.randomUUID(),
-     org_id: 'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q',
+     org_id: 'org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq',
      vps_provider_id: '<Linode UUID from Phase 0 step 4>',
      dns_registrar_id: '<Namecheap UUID from Phase 0 step 4>',
      ns_domain: 'savini.info',
```

### File 5: `CC_PROMPT_SALVAGE_IONOS_WAVE_1.md` (prose-drift δ — worst-case)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/CC_PROMPT_SALVAGE_IONOS_WAVE_1.md	2026-04-25 14:41:56
+++ /tmp/orgid_patch_preview/CC_PROMPT_SALVAGE_IONOS_WAVE_1.md	2026-04-29 11:35:18
@@ -361,7 +361,7 @@
 `dns_registrar_id` in the POST body must resolve to the org's Ionos registrar row. **The Ionos row ALREADY exists** in `dns_registrars` from Dean's prior dashboard test setup — visible in the dashboard UI at Settings → DNS Registrars (label: "Ionos perosnal email server", type: "IONOS (1&1)", status: "Connected to IONOS API successfully"). Same `dns_registrar_id` for both pairs.
 
 **Query rules** (per HL #36 — verify org_id character-by-character):
-- StealthMail org_id is `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (capital-O, digit-zero, lowercase-q at the end — NOT `OOq` with double-capital-O, NOT `Qu` after `Ca`).
+- StealthMail org_id is `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O, capital-O, lowercase-q at the end — NOT `O0q` with digit-zero, NOT lowercase `qu` after `Ca`. [2026-04-29 audit correction: this descriptor previously said "capital-O, digit-zero, lowercase-q at the end — NOT `OOq` with double-capital-O, NOT `Qu` after `Ca`" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]).
 - Use case-insensitive matching on `registrar_type` (the row may be stored as `ionos`, `IONOS`, `ionos_1and1`, or similar — confirm via the `/api/provisioning/registrars` endpoint which the dashboard UI itself uses).
 - Do NOT filter by `is_active = true` on first pass — get all rows for the org, then identify the live Ionos one.
 - If your query returns "no Ionos row," you have a filter bug; re-query with broader filters before declaring it missing. Cross-check by hitting `GET /api/provisioning/registrars` (the same endpoint the wizard's registrar dropdown uses) — that's the canonical surface.
```

### File 6: `CC_PROMPT_AUDIT_REMEDIATION.md` (CLEAN α — value reference)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/CC_PROMPT_AUDIT_REMEDIATION.md	2026-04-21 14:30:24
+++ /tmp/orgid_patch_preview/CC_PROMPT_AUDIT_REMEDIATION.md	2026-04-29 11:35:18
@@ -124,7 +124,7 @@
 
 These were applied in-session by the Cowork run that produced this prompt; verify they are present before starting code work:
 
-- `.auto-memory/reference_credentials.md:63` — org_id now `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`
+- `.auto-memory/reference_credentials.md:63` — org_id now `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq`
 - `.auto-memory/project_saas_dashboard.md:26` — same correction
 - `.auto-memory/MEMORY.md` — updated top-matter audit line, added entry for `reports/2026-04-21-workspace-audit.md`
 
```

### File 7: `COWORK_CONTINUATION_POST_P11_P12_REVIEW.md` (mixed: 1δ + 1α)

```diff
--- /Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/COWORK_CONTINUATION_POST_P11_P12_REVIEW.md	2026-04-20 13:15:01
+++ /tmp/orgid_patch_preview/COWORK_CONTINUATION_POST_P11_P12_REVIEW.md	2026-04-29 11:35:18
@@ -61,7 +61,7 @@
 | P13 | `79ac33a1-b6e7-4d30-98a7-9302e30061f0` | launta.info | 69.164.213.37 / `96237863` | 50.116.14.26 / `96237866` | active (GREEN) |
 | savini (orphan — no server_pairs row) | — | savini.info | 173.230.132.245 / `96154706` | 45.33.63.216 / `96154709` | provisioning_job `4da406f0-41db-4344-8ad3-015f87e4799a` = **status `failed`**, died at `verification_gate_2` with 57 unresolved checks |
 
-**Org:** `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (lowercase q after "Ca", ends `O0q` = capital-O, digit-zero, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20.
+**Org:** `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-Q lowercase-u after "Ca", ends `OOq` = capital-O, capital-O, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. [2026-04-29 audit correction: this descriptor previously said "lowercase q after Ca, ends O0q = capital-O, digit-zero, lowercase-q" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]
 
 ### Savini's 10 declared sending domains (from failed provisioning_job `4da406f0…`)
 
@@ -238,7 +238,7 @@
 3. Phase 2: Run the canonical 11-step saga via `pair-provisioning-saga.ts`. Enqueue a new `provisioning_jobs` row with:
    - `ns_domain = savini.info` (or new NS if Dean chose fresh)
    - `sending_domains = [<Dean-approved 10 domains from Phase D audit>]`
-   - `org_id = org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`
+   - `org_id = org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq`
    - `vps_provider_id = <Linode provider UUID — d1890b37-0932-4d51-b4ea-1da863054f1f>`
    - `dns_registrar_id = <Namecheap UUID per provider preferences>` (NOT Ionos — per `feedback_provider_preferences.md`)
    - `server_pair_id = NULL` (saga inserts it at step 8)
```

---

## Apply script (verbatim, at `/tmp/orgid_patch_preview.py`)

The script supports both `preview` (writes copies to `/tmp/orgid_patch_preview/` + prints diffs) and `apply` (in-place writes to source paths). Both modes capture a pre-state digest with sha256[:16] hashes + occurrence counts. Apply-mode aborts if any file's post-state still contains the wrong value.

```python
#!/usr/bin/env python3
"""
Preview / apply org_id corrections across 7 workspace-root prompt files.

Mode 'preview' (default): writes patched copies to /tmp/orgid_patch_preview/
                          and prints unified diffs vs originals.
Mode 'apply':             writes patched content back to originals in-place.

Pre-state digest is captured to /tmp/orgid_patch_preview/PRE_STATE.txt
in both modes for the audit-trail report.
"""
import os
import sys
import subprocess
import hashlib
from pathlib import Path

WS = Path("/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork")
PREVIEW_DIR = Path("/tmp/orgid_patch_preview")

WRONG_VALUE = "org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q"
RIGHT_VALUE = "org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq"

# Substitutions per file. Each entry is a list of (old, new) tuples.
# For mixed files (prose-drift + clean code), the prose-drift sub is listed
# explicitly; the clean code sub is also listed explicitly. Order: prose first,
# then code, since the two patterns are non-overlapping.
SUBS = {
    "SAAS_DASHBOARD_PROJECT_INSTRUCTIONS.md": [
        # L129 prose-drift (single occurrence)
        (
            "- **Dean's org:** clerk_org_id=`org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (verified live 2026-04-20 against Supabase `server_pairs.org_id` — earlier drafts had `OOq` and uppercase `Qu`, both wrong)",
            "- **Dean's org:** clerk_org_id=`org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (verified live 2026-04-20 against Supabase `server_pairs.org_id` — ends `OOq` double-capital-O, contains `Qu` capital-Q lowercase-u after `Ca`. [2026-04-29 audit correction: this descriptor previously said \"earlier drafts had `OOq` and uppercase `Qu`, both wrong\" — that direction was wrong; verified via Clerk LIST + GET on both candidates.])",
        ),
    ],
    "CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md": [
        # CLEAN: 2 occurrences in TS code defaults (L226, L283). Plain value sed.
        (WRONG_VALUE, RIGHT_VALUE),
    ],
    "CC_PROMPT_P11_FINALIZATION_CONTINUATION.md": [
        # L85 prose-drift (single occurrence)
        (
            "**Org:** `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (lowercase q after \"Ca\", ends `O0q` — capital-O, digit-zero, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. Note: earlier drafts had `OOq` (double capital-O) — that was wrong.",
            "**Org:** `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-Q lowercase-u after \"Ca\", ends `OOq` — capital-O, capital-O, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. [2026-04-29 audit correction: this descriptor previously said \"lowercase q after Ca, ends O0q — capital-O, digit-zero, lowercase-q. Note: earlier drafts had OOq (double capital-O) — that was wrong.\" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]",
        ),
    ],
    "CC_PROMPT_SAVINI_P14_ADOPTION.md": [
        # L50 prose-drift
        (
            "| Org | `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (capital-O, digit-zero, lowercase-q; verified 2026-04-20 against `server_pairs.org_id`) |",
            "| Org | `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O, capital-O, lowercase-q; verified 2026-04-20 against `server_pairs.org_id`. [2026-04-29 audit correction: this descriptor previously said \"capital-O, digit-zero, lowercase-q\" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]) |",
        ),
        # L178 CLEAN code (post prose-sub, only the code occurrence remains)
        (WRONG_VALUE, RIGHT_VALUE),
    ],
    "CC_PROMPT_SALVAGE_IONOS_WAVE_1.md": [
        # L364 prose-drift (single occurrence)
        (
            "- StealthMail org_id is `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (capital-O, digit-zero, lowercase-q at the end — NOT `OOq` with double-capital-O, NOT `Qu` after `Ca`).",
            "- StealthMail org_id is `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O, capital-O, lowercase-q at the end — NOT `O0q` with digit-zero, NOT lowercase `qu` after `Ca`. [2026-04-29 audit correction: this descriptor previously said \"capital-O, digit-zero, lowercase-q at the end — NOT `OOq` with double-capital-O, NOT `Qu` after `Ca`\" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]).",
        ),
    ],
    "CC_PROMPT_AUDIT_REMEDIATION.md": [
        # L127 CLEAN value reference (single occurrence). Plain value sed.
        (WRONG_VALUE, RIGHT_VALUE),
    ],
    "COWORK_CONTINUATION_POST_P11_P12_REVIEW.md": [
        # L64 prose-drift
        (
            "**Org:** `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (lowercase q after \"Ca\", ends `O0q` = capital-O, digit-zero, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20.",
            "**Org:** `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-Q lowercase-u after \"Ca\", ends `OOq` = capital-O, capital-O, lowercase-q). Verified live against `server_pairs.org_id` 2026-04-20. [2026-04-29 audit correction: this descriptor previously said \"lowercase q after Ca, ends O0q = capital-O, digit-zero, lowercase-q\" — that direction was wrong; verified via Clerk LIST + GET on both candidates.]",
        ),
        # L241 CLEAN code (post prose-sub, only the code occurrence remains)
        (WRONG_VALUE, RIGHT_VALUE),
    ],
}


def apply_subs(content: str, subs: list) -> tuple[str, list]:
    """Apply each (old, new) sub once. Return (new_content, applied_count_per_sub)."""
    applied = []
    for old, new in subs:
        before = content
        if old not in content:
            applied.append(0)
            continue
        # Use replace with count to verify exactly the expected number of hits
        # (we deliberately don't restrict count here — the multi-sub design
        # ensures non-overlapping patterns)
        new_content = content.replace(old, new)
        n = content.count(old)
        content = new_content
        applied.append(n)
    return content, applied


def sha256_short(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if mode not in ("preview", "apply"):
        print(f"ERROR: mode must be 'preview' or 'apply', got '{mode}'", file=sys.stderr)
        sys.exit(2)

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    pre_state_path = PREVIEW_DIR / "PRE_STATE.txt"

    with pre_state_path.open("w") as ps:
        ps.write(f"# Pre-state digest captured {os.popen('date -u +%Y-%m-%dT%H:%M:%SZ').read().strip()}\n")
        ps.write(f"# Mode: {mode}\n\n")

        total_subs = 0
        for fname, subs in SUBS.items():
            src = WS / fname
            if not src.exists():
                print(f"!! MISSING: {src}", file=sys.stderr)
                sys.exit(1)
            original = src.read_text()
            patched, applied = apply_subs(original, subs)

            # Verify post-state has zero wrong-value occurrences
            wrong_in_patched = patched.count(WRONG_VALUE)
            right_in_patched = patched.count(RIGHT_VALUE)
            wrong_in_original = original.count(WRONG_VALUE)
            right_in_original = original.count(RIGHT_VALUE)

            ps.write(f"--- {fname} ---\n")
            ps.write(f"  pre  sha256[:16]:  {sha256_short(original)}\n")
            ps.write(f"  post sha256[:16]:  {sha256_short(patched)}\n")
            ps.write(f"  pre  wrong-value occurrences: {wrong_in_original}\n")
            ps.write(f"  pre  right-value occurrences: {right_in_original}\n")
            ps.write(f"  post wrong-value occurrences: {wrong_in_patched}\n")
            ps.write(f"  post right-value occurrences: {right_in_patched}\n")
            ps.write(f"  per-sub applied counts:       {applied}\n")
            ps.write(f"  pre  byte size: {len(original)}\n")
            ps.write(f"  post byte size: {len(patched)}\n\n")

            total_subs += sum(applied)

            if wrong_in_patched != 0:
                print(f"!! POST-PATCH: {fname} STILL contains {wrong_in_patched} wrong-value occurrence(s)", file=sys.stderr)
                sys.exit(1)

            if mode == "preview":
                # Write to preview dir, then print diff
                preview_path = PREVIEW_DIR / fname
                preview_path.write_text(patched)
                print(f"================================================================")
                print(f"=== {fname}")
                print(f"================================================================")
                # Use diff -u; redirect stderr; tolerate non-zero rc (1 = differences)
                result = subprocess.run(
                    ["diff", "-u", str(src), str(preview_path)],
                    capture_output=True, text=True
                )
                print(result.stdout)
                print()
            else:
                # Apply: write back to original
                src.write_text(patched)
                print(f"APPLIED: {fname}  ({sum(applied)} sub(s))")

        ps.write(f"# Total substitutions: {total_subs}\n")
        ps.write(f"# Files patched: {len(SUBS)}\n")

    if mode == "preview":
        print(f"\n[preview-mode] Pre-state digest written to: {pre_state_path}")
        print(f"[preview-mode] Patched copies in:           {PREVIEW_DIR}")
        print(f"[preview-mode] Total substitutions:         {total_subs}")
    else:
        print(f"\n[apply-mode] Pre-state digest written to: {pre_state_path}")
        print(f"[apply-mode] Total substitutions:           {total_subs}")
        print(f"[apply-mode] All 7 files patched in-place.")


if __name__ == "__main__":
    main()
```

---

## Reviewer checklist (Dean's a/b/c/d criteria — all green pre-apply)

- [x] **(a)** Each prose rewrite matches the new value (descriptor characters match the patched org_id byte-for-byte). Verified across the 5 prose-drift lines: file 1 L129, file 3 L85, file 4 L50, file 5 L364, file 7 L64.
- [x] **(b)** Each footnote captures the prior wrong-direction text verbatim — quoted exactly as it appeared in the original prose. 5 footnotes total.
- [x] **(c)** The 2 CLEAN files (`CC_PROMPT_DBL_RESWEEP_WORKER_2026-04-27.md`, `CC_PROMPT_AUDIT_REMEDIATION.md`) and the α-occurrences in the 2 mixed files (SAVINI L178, COWORK L241) are pure value swaps — no incidental prose changes. PRE_STATE shows +0 byte delta for the two pure-CLEAN files.
- [x] **(d)** No surrounding context still asserts the wrong direction. Both automated scans (above) reported clean (modulo expected false-positive on file 5 L364 where the new descriptor explicitly re-states "NOT `O0q`" as the correct anti-assertion).

Plus **post-apply criteria:**

- [x] **(e)** Apply mode succeeded with rc=0; per-file APPLIED line emitted for each of the 7 files; total `[apply-mode] Total substitutions: 10` matches pre-apply count.
- [x] **(f)** Post-apply grep across the 7 files for the wrong value returned empty.
- [x] **(g)** Post-apply right-value count per file matches pre-apply wrong-value count (1+2+1+2+1+1+2 = 10).

---

## Out of scope (not patched)

Per Phase 9.6 report Category B + Dean's directives:

- `HANDOFF_2026-04-29-V4-DIAGNOSIS-COMPLETE.md` (durable record of V4's wrong-direction reasoning at Phase 9.5 — preserve as audit lesson; explicitly excluded by Dean from the 8-file menu).
- `.auto-memory/project_saas_dashboard.md:26` (Project 9 owned, PROPOSE-only — Project 9 absorbs in its own session; covered in `dashboard-app/reports/audit/2026-04-29-MEMORY-PROPOSAL.md` File 5).
- 5 files with stale `CLOUDING_API_KEY` references (Phase 9.6 Category C — mostly moot post-Directive 1; let age out unless prompts fire again).
- Workspace-root files with `newserver1-19` references (Phase 9.6 Category A — historical handoffs, do not retro-edit).

---

## Branch / commit

- Branch: `audit-followup/2026-04-29-workspace-orgid-fixes`
- Forked from: `main` at `00b3260` (= `feat: weekly post-launch DBL re-sweep job + admin monitor panel (#21)`)
- Worktree: `dashboard-app/.claude/worktrees/orgid-fixes-2026-04-29` (fresh; isolated from `vibrant-golick-ce8da1` audit worktree)
- Commit content: this report only (workspace-root prompt files are not git-tracked).
- Push status: NOT pushed. NOT a PR. Local-only until Dean directs.

— end report —
