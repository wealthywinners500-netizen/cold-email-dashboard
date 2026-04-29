# Phase 9.3 + 9.4 — `.auto-memory/` updates proposal

**Generated:** 2026-04-28 (V4 streamlined finish, Phase 9.3 + 9.4)
**Status:** PROPOSAL — CC writes; Dean acks per-file at the 9.7 HALT; CC then applies the changes for files Project-8 owns. `project_server_deployment.md` is PROPOSE-ONLY (Project 1 owns per CLAUDE.md memory-ownership rule).

---

## File 1 — `.auto-memory/MEMORY.md` (Project 8 owns; CC applies w/ ack)

### 1a. INSERT new top-of-file dated entry (2026-04-29 audit-close)

Insert AFTER line 1 (`## Core Memory Files...`), BEFORE the existing 2026-04-24 entry. The new entry becomes lines 2-X (and existing 2026-04-24 entry shifts to lines X+1...).

```markdown
*2026-04-29 — **Full audit completed (Phases 0–10) on branch `audit/full-2026-04-29` PR open + UNMERGED.** 32 findings cataloged (5×P1 / 8×P2 / 13×P3 / 4×info / F-33 DROPPED per Directive 1 / F-24 RESOLVED Path A REFINED). 9 new HLs landed (#146 single-line zone delete, #147 post-TLS-fix re-enable manual, #148 env-var gaps must block saga close, #149 PV scoring plumbing-vs-infra distinction, #150 smtp_pass two-column storage split, #151 rolling-anchor pXX-golden-saga-YYYY-MM-DD convention, #152 cascade-disable rollback operator-driven, #153 pooler mode per consumer surface, #154 pre-DELETE FK enumeration via pg_constraint). 11 audit-prompt patches enumerated for the next iteration. **Phase 8 fixes applied:** F-1 (DATABASE_URL added to Vercel prod env, port 6543 transaction-mode pooler — initial port-5432 attempt surfaced HL #153) + 12 P2 cross-pair collision `email_accounts` rows DELETED via cascade-cleanup with 48 dependent `system_alerts` (forensic snapshot in [reports/audit/2026-04-29-phase-8.3-collision-delete.md](../dashboard-app/reports/audit/2026-04-29-phase-8.3-collision-delete.md)). **F-14 deferred** (no Docker / no sbp_ token; remediation queued in [FIX-BACKLOG.md](../dashboard-app/reports/audit/2026-04-29-FIX-BACKLOG.md)). **Clerk org_id re-correction:** actual = `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (ends `OOq`, double capital-O); 2026-04-21 audit's correction went the wrong way (claimed ends `O0q` digit-zero). Verified via `LIST /v1/organizations` (StealthMail row) + direct `GET /v1/organizations/<id>` on both candidates (`O0q` returns `resource_not_found`, `OOq` returns full org object with `name="StealthMail"`, `created_by="user_3C2CZ4ZPd7Ud5CjqJLZ9WarMln9"`, `created_at=1775574340466`). `reference_credentials.md` patched in this audit; `project_saas_dashboard.md:26` deferred to Project 9 per memory-ownership rule (PROPOSE-only in this audit). The 2026-04-21 historical entry above stays untouched as the durable record of when the wrong direction was first applied. **Live state post-audit:** `server_pairs`=14 / `email_accounts` active=258 / disabled=48 / total=306 / `sending_domains`=119 / `pair_verifications`=20 / `system_alerts`=605 (deltas: -12 email_accounts, -48 system_alerts vs Phase 8.3 pre). Saga golden tag `p16-golden-saga-2026-04-23` sha unchanged at `c1cc0bf96f7aed54a5e74c0f5cf20cb693263de1`. F-24 baseline (auto-fix.ts only, +10/-2 since p16) holds. **NEW tag `p17-golden-saga-2026-04-29` to be applied manually by Dean at audit close**: `git tag p17-golden-saga-2026-04-29 00b3260 && git push origin p17-golden-saga-2026-04-29`. Old tag stays immutable (rolling-anchor convention per HL #151). **Directive 1 propagated:** newserver1-19 (the 19 original Clouding mail servers) DELETED 2026-04-28 by Dean; surviving Clouding infra = 10 panel.* relay servers + worker VPS (200.234.226.226) only. `feedback_clouding_panel_servers_offlimits.md` STILL applies to the 10 panel.* set; relay-migration session is the right scope. **F-33 (P2 EHOSTUNREACH cascade) is expected state, not a finding** — old IPs route nowhere because the servers behind them are deleted. Post-audit roadmap (Dean stated order, 2026-04-25): preserve waves continuation (Salvage-Ionos Wave 3, Pair B re-launch) → P18+P19 reactivation (relay-migration session, 45 Snov accounts) → 10 panel.* relay-server preserve wave → P2 recommission (rebind 18 non-collision rows to NEW Linode pair, NOT reactivate Clouding) → app-building (B16 hands-free, etc.). Audit reports: `dashboard-app/reports/audit/2026-04-29-*.md` (~22 files: phase-0 through phase-10 + 5 deliverable PROPOSALs + FIX-BACKLOG + 4 cross-infra drift + 9.6 prompt-file drift). PR: <link added at Phase 10 close>.*
```

### 1b. EDIT line 35 — Project 1 server-deployment description (annotate newserver1-19 deletion)

```diff
-- [Server Deployment State](project_server_deployment.md) — **server_pairs live state 2026-04-24:** 10 rows = P1/P2/P3 Clouding + P11–P17 Linode, MAX pair_number=17. P4/P7/P8 are Clouding-era with zero DB rows (INSERT pending per migration scope §5 D2). P5/P6/P9/P10 historical Clouding, never materialized. α/β/γ = P18/P19/P20 in-flight via Phase 02c. *(Legacy narrative: P1-4 complete, P5 needs 9 swaps, P6-P8 complete, P9-10 planned — historical only; not reflected in server_pairs)*
+- [Server Deployment State](project_server_deployment.md) — **server_pairs live state 2026-04-29 (post-audit):** 14 rows = P1/P2/P3 Clouding-era (mail-server side DELETED 2026-04-28; only Ionos zones survive) + P11–P17 Linode (live) + P18/P19/P20 Linode preserve-wave (P18+P19 preserve-protected, awaiting relay-migration session; P20 = Pair A live with 9 sd / 27 accounts after krogerengage.info DBL drop). MAX pair_number=21 (P21 = Pair B in-flight). **Surviving Clouding infra is 10 panel.* relay servers + worker VPS (200.234.226.226) ONLY** — newserver1 through newserver19 (the 19 original Clouding mail servers) DELETED by Dean 2026-04-28. The 10 panel.* set is OFF-LIMITS per `feedback_clouding_panel_servers_offlimits.md` until the relay-migration preserve wave activates. *(Legacy narrative: P1-4 complete, P5 needs 9 swaps, P6-P8 complete, P9-10 planned — historical only; not reflected in server_pairs)*
```

### 1c. EDIT line 68 — Hard Lessons file description (HL count 144 → 154 + corrections)

```diff
-- [Hard Lessons](feedback_hard_lessons.md) — 144 hard lessons (#85/#93 UNRECOVERED stubs; #138–#140 2026-04-23 (writer/reader contracts + rerun-vg2 scope + live-auth preflight); #141 2026-04-23 sk_test_ key-collision; #142 2026-04-24 SSH credential-ladder pattern (non-destructive 6-source recovery); #143 2026-04-24 scope-narrowing overrides server-level preservation inferences; **#144 2026-04-24 Ionos DNS-scoped API key + LAN UDP-53 hijack (TCP DNS mandatory) + known-set identity proxy**; pre-existing #73/#87 duplication flagged for next consolidate-memory pass) — check before ANY work
+- [Hard Lessons](feedback_hard_lessons.md) — 154 hard lessons (#85/#93 UNRECOVERED stubs; #138–#140 2026-04-23 (writer/reader contracts + rerun-vg2 scope + live-auth preflight); #141 2026-04-23 sk_test_ key-collision; #142 2026-04-24 SSH credential-ladder pattern; #143 2026-04-24 scope-narrowing overrides server-level preservation inferences (**STALE re: "the other 14 Clouding servers retire" — the relay-tagged subset of those 14 is NOT retiring, see correction note in 9.4 sweep**); #144 2026-04-24 Ionos DNS-scoped API key + LAN UDP-53 hijack; #145 2026-04-25 real-auth preflight MUST be external STARTTLS not localhost EHLO; **#146–#149 2026-04-29 from Phase 1 CC session review (single-line zone delete; post-TLS-fix re-enable manual; env-var gaps must block saga close; PV scoring plumbing-vs-infra distinction)**; **#150 2026-04-29 smtp_pass two-column storage split (plaintext on email_accounts, AES-GCM on ssh_credentials); #151 2026-04-29 rolling-anchor pXX-golden-saga tag convention; #152 2026-04-29 cascade-disable rollback operator-driven; #153 2026-04-29 pooler mode per consumer surface (worker 5432 / Vercel 6543); #154 2026-04-29 pre-DELETE FK enumeration via pg_constraint**; pre-existing #73/#87 duplication still flagged for next consolidate-memory pass) — check before ANY work
```

### 1d. INSERT a new dated entry under Project 1 section (NEW)

After line 37 (P14 Orphan Resolution link), add:

```markdown
- **Pair sd-count note (Phase 2 Q4 2026-04-27):** When a Linode-saga pair shows fewer than 10 sending_domains (the convention is 5 sd × 2 servers = 10), the standard cause is DBL-burn detection that dropped 1 or more domains at provisioning. Examples: P16 mareno = 8 sd (2 burnt at provisioning), P20 = 9 sd (1 burnt + 1 dropped post-launch). P19 = 12 sd is by Dean's intentional design at preserve-wave time, not a DBL-drop pattern.
- **F-15 (TS-only tables) clarification 2026-04-29 audit:** 11 TS-only tables (e.g. `campaigns`, `lead_lists`, `lead_imports`, etc.) EXIST as empty scaffolding (HTTP 200 with `*/0`) — they were created by Make.com automation expectations during early planning. The 113 `src/` callers get empty results, NOT failures. NOT P1 critical as the Wave 4.1.a agent initially over-claimed; corrected to P3 by Wave 4.2.a empirical re-probe.
- **P18 + P19 status (2026-04-29 audit close):** PRESERVE-PROTECTED per Dean. P18 (`partnerwithkroger.store`) has 30 disabled accounts after the 2026-04-25 TLS fix landed but the operator-driven re-enable was never run (HL #147 specific case + HL #152 broader rule); 8/10 sd DBL-burnt (preserve treatment, not a drop). P19 (`marketpartners.info`) is a pre-cutover destination for the relay-migration session — Linode infra ready (S1=45.56.67.67, S2=72.14.189.188, 12 sd), 45 source Snov accounts (Pair 4 + Pair 7 tags) await cutover. **Not orphans. Bundle P18 + P19 reactivation into one relay-migration session per F-32.**
- **P2 framing post-2026-04-28:** 30 active rows on P2 cascade-disabled mid-audit when newserver1-19 deletion left mail1/mail2.krogernetworks.info routing to dead IPs (`27.0.174.55:587`, `217.71.202.214:587`, EHOSTUNREACH). Post-audit recommission means **rebind the 18 non-collision rows to a NEW Linode pair**, NOT reactivate the deleted Clouding mail-server side. (12 collision rows already DELETED in Phase 8.3.) Rebind effort: 1 CC session, ~2-3 hr per Workstream 4 in V4 post-audit roadmap.
```

### 1e. (Optional) Move pre-2026-04-23 dated entries to archive

MEMORY.md is 80 lines (well under the 200 limit). Adding the audit-close entry brings it to ~95 lines. **No truncation needed.** If a future session brings the count near 200, archive lines 21-28 (the 2026-04-19 → 2026-04-20 entries about session 04c/04d/PR #10/PR #11) to `dashboard-app/reports/audit/MEMORY-archive-pre-2026-04-23.md`. Skip for now.

---

## File 2 — `.auto-memory/feedback_hard_lessons.md` (Project 8 owns; CC applies w/ ack)

### 2a. APPEND HL #146–#154 verbatim from `2026-04-29-HL-PROPOSALS.md`

See sibling file [2026-04-29-HL-PROPOSALS.md](2026-04-29-HL-PROPOSALS.md) for full prose. CC appends all 9 entries to the END of `feedback_hard_lessons.md` after Dean's per-file ack.

### 2b. INSERT correction note for HL #143 (was incorrectly speculative re: "the other 14 Clouding servers retire")

Per `feedback_clouding_panel_servers_offlimits.md` line 15: "HL #143 ... claims 'the other 14 Clouding servers retire' — that's stale. The relay-tagged subset of those 14 is NOT retiring."

Now that newserver1-19 are deleted (per Directive 1), the 14-server framing in HL #143 is dated. The correct framing post-2026-04-28: 19 deleted (newserver1-19), 10 surviving (panel.* relay set, off-limits per the dedicated feedback file).

**Proposed APPEND (last paragraph of HL #143 in `.auto-memory/feedback_hard_lessons.md`):**

```markdown
**2026-04-29 audit correction (Phase 9.4 sweep):** The "the other 14 Clouding servers retire" framing in this HL is now dated. Per Directive 1 (V3 reviewer round 2026-04-28): newserver1 through newserver19 (the 19 original Clouding mail servers) were DELETED by Dean 2026-04-28. Surviving Clouding infrastructure is the 10 panel.* relay servers + the worker VPS (200.234.226.226) only. The 10 panel.* set carries ~150 follow-ups on relay infrastructure and is OFF-LIMITS until the relay-migration preserve wave activates per `feedback_clouding_panel_servers_offlimits.md`. The lesson's CORE rule (account-activity scope-narrowing overrides server-level preservation inferences) STILL applies — only the count framing is updated.
```

---

## File 3 — `.auto-memory/reference_credentials.md` (Project 8 owns; CC applies w/ ack)

### 3a. EDIT — Clerk org_id re-correction (CRITICAL — F-NEW-9.5-CLERK-1)

**Anchor:** the line currently says (per `.auto-memory/reference_credentials.md`):
```
- **Dean's Org:** StealthMail — org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q (created 2026-04-07; corrected 2026-04-21 audit — ends `O0q` = capital-O + digit-zero + lowercase-q)
```

**Patch:**
```diff
-- **Dean's Org:** StealthMail — org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q (created 2026-04-07; corrected 2026-04-21 audit — ends `O0q` = capital-O + digit-zero + lowercase-q)
+- **Dean's Org:** StealthMail — `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (created 2026-04-07; **2026-04-29 audit re-correction:** actual ID ends `OOq` = capital-O + capital-O + lowercase-q. The 2026-04-21 "correction" went the wrong direction. Verified via `LIST /v1/organizations` (StealthMail = `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq`) + direct `GET /v1/organizations/<id>` on both candidates: `O0q` returns `resource_not_found`, `OOq` returns the full org object with `name=StealthMail`. 3-character delta from prior wrong value: positions 9-10 case-swapped (`qU` → `Qu`) AND last-3 had `0` (digit-zero) where actual is `O` (capital-O).)
```

This is the only auto-memory write that touches credentials. The runtime dashboard works fine because it uses `auth().orgId` from the live Clerk session — NOT a hardcoded constant. But scripts / one-off CC sessions that copy-paste the org_id from credentials hit 404. Patch must land before the next CC operator picks up the wrong value.

### 3b. EDIT line 22 — annotate stale CLOUDING_API_KEY reference

```diff
-- Older stale key `St/Ewg6WyfoabNA40J3tm+fFUE/69n+fT4LjoXpwXrI=` appears in several CC_PROMPT_*.md files — do not use; superseded by the Q14Q1 key above
+- Older stale key `St/Ewg6WyfoabNA40J3tm+fFUE/69n+fT4LjoXpwXrI=` appears in several CC_PROMPT_*.md files — do not use; superseded by the Q14Q1 key above. **2026-04-29 audit note:** newserver1-19 deletion means most Clouding API uses are now moot — the 10 surviving panel.* servers are the only remaining Clouding consumers, and they're off-limits per `feedback_clouding_panel_servers_offlimits.md`. Phase 9.6 prompt-file sweep enumerates the prompt files that still reference the stale key for cleanup.
```

### 3c. INSERT new "post-audit notes" subsection at the END of the Clouding.io section (after line 22)

```markdown
- **2026-04-29 audit note — newserver1-19 SSH access:** The 19 original Clouding mail servers are DELETED. Any prompt or doc that says "SSH to newserverN" is operating against deleted infrastructure. Surviving Clouding SSH targets: 10 panel.* hostnames (off-limits until relay-migration preserve wave activates) and the worker VPS at 200.234.226.226 (live, pubkey-authed for `dean-mac-dashboard-20260418` ed25519 since 2026-04-23).
- **2026-04-29 audit note — Vercel DATABASE_URL** added to production env (id `X2Xjg3qtO5sjIvqb`, encrypted) at Phase 8.1 close. Value uses **transaction-mode pooler at port 6543** (not the worker's session-mode 5432). Per HL #153, pooler mode is per-consumer-surface — same host/user/password/db, port differs by surface. This was added to fix F-1 (the Pair Verify route's `enqueue_failed` cascade).
```

### 3d. (Optional) Add SUPABASE_ACCESS_TOKEN slot

Add to Supabase section at end:

```markdown
- **SUPABASE_ACCESS_TOKEN:** (not yet provisioned; mint at https://supabase.com/dashboard/account/tokens, save here as `sbp_...`). Required for non-interactive `npx supabase gen types typescript --project-id <ref>` invocations (F-14 backlog item — see `dashboard-app/reports/audit/2026-04-29-FIX-BACKLOG.md` for the 5-min remediation steps).
```

---

## File 4 — `.auto-memory/project_server_deployment.md` (Project 1 owns; PROPOSE-ONLY — CC does NOT apply)

Per CLAUDE.md memory-ownership rule + V3/V4 plan, Project 1 owns this file. CC writes the proposal here; Project 1 absorbs the changes in its own session.

### 4a. PROPOSED EDITS (Project 1 to apply)

**Section: Clouding pairs P1/P2/P3 description (likely top-of-file or early section)**

Annotate with: "Mail-server side DELETED 2026-04-28 (newserver1-19 retirement). Ionos DNS zones survive. Surviving Clouding infrastructure: 10 panel.* relay servers + worker VPS (200.234.226.226) only — these are off-limits until the relay-migration preserve wave activates per `feedback_clouding_panel_servers_offlimits.md`."

**Section: Pair-status / pair-inventory table (whatever the canonical form is)**

Add P18/P19/P20/P21 status rows reflecting:
- P18: preserve-protected, 30 accounts disabled post-TLS-fix awaiting operator re-enable per HL #147/#152, 8/10 sd DBL-burnt (preserve treatment), bundled with relay-migration session
- P19: pre-cutover destination for relay-migration session (Linode S1=45.56.67.67 + S2=72.14.189.188, 12 sd by design), 45 Snov accounts (Pair 4 + Pair 7 tags) await cutover
- P20 (Pair A): live, 9 sd / 27 accounts after krogerengage.info DBL drop 2026-04-27
- P21 (Pair B): in-flight (Salvage-Ionos Wave 3 — see `CC_PROMPT_PAIR_B_WAVE_3_2026-04-25.md`)

**Section: Operational topology (whatever section describes deployed infra)**

Update to reflect post-2026-04-28 surviving topology: 14 server_pairs in `server_pairs` table; mail-server side of P1/P2/P3 deleted (DNS-only survivors); P11-P17 Linode live; P18-P21 Linode preserve-wave/in-flight. Drop any "newserver1-19" references; replace with "10 panel.* + worker VPS (off-limits + live respectively)."

CC does NOT apply these edits. Project 1 absorbs in a follow-on session referencing this proposal.

---

## File 5 — `.auto-memory/project_saas_dashboard.md` (Project 9 owns; PROPOSE-ONLY — CC does NOT apply)

### 5a. PROPOSED EDIT — Clerk org_id re-correction at line 26

The same wrong org_id propagated from `reference_credentials.md` into `project_saas_dashboard.md` line 26 during the 2026-04-21 audit's "correction." Per CLAUDE.md memory-ownership rule, Project 9 owns this file. CC writes the proposal here; Project 9 absorbs in its own session.

**Anchor:**
```
- **Dean's Org:** org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q (StealthMail; corrected 2026-04-21 audit — ends `O0q`)
```

**Proposed patch (Project 9 to apply):**
```diff
-- **Dean's Org:** org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q (StealthMail; corrected 2026-04-21 audit — ends `O0q`)
+- **Dean's Org:** `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (StealthMail; 2026-04-29 audit re-correction — ends `OOq` = capital-O + capital-O + lowercase-q. The 2026-04-21 "correction" went the wrong way. Verified against `GET /v1/organizations` LIST endpoint 2026-04-29 + direct GET on both candidates. Same value patched in `.auto-memory/reference_credentials.md` per Project-8 ack.)
```

CC does NOT apply this edit. Project 9 absorbs in a follow-on session referencing this proposal. Cross-link: `2026-04-29-phase-9.5-clerk-drift.md` for the verification evidence.

---

## File 6 — `.auto-memory/feedback_clouding_panel_servers_offlimits.md` (Project 8 owns; verify-only)

### 6a. VERIFY still accurate (PASS)

Re-read at audit close: still accurate. The off-limits guardrail still applies to the 10 panel.* set. HL #143 stale-claim flag at line 15 is correctly noted; the correction landing in HL #143 (per File 2 §2b) honors the file's "don't fix HL #143 now per Dean's 'don't add to gameplan yet' directive" instruction by adding a 2026-04-29 audit annotation to HL #143 instead of rewriting it.

No edits required.

---

## Application order (per Dean's per-file ack at the 9.7 HALT)

1. **`.auto-memory/MEMORY.md`** — file 1 (1a + 1b + 1c + 1d). CC applies on ack. NOTE: do NOT rewrite the 2026-04-21 historical entry; the audit-close entry (1a) explicitly notes the re-correction and the historical entry stays as the durable record.
2. **`.auto-memory/feedback_hard_lessons.md`** — files 2a (HL #146–#154 verbatim from sibling file) + 2b (HL #143 audit correction). CC applies on ack.
3. **`.auto-memory/reference_credentials.md`** — file 3a (Clerk org_id re-correction — CRITICAL) + 3b (Clouding stale-key annotation) + 3c (post-audit notes incl. DATABASE_URL pooler-mode) + (optional 3d SUPABASE_ACCESS_TOKEN slot). CC applies on ack.
4. **`.auto-memory/project_server_deployment.md`** — file 4. **PROPOSE ONLY**; Project 1 owns; surface to Dean and Project 1 takes it from here.
5. **`.auto-memory/project_saas_dashboard.md`** — file 5. **PROPOSE ONLY**; Project 9 owns; same wrong org_id propagation as `reference_credentials.md` File 3a; Project 9 absorbs in a follow-on session.
6. **`.auto-memory/feedback_clouding_panel_servers_offlimits.md`** — file 6. **NO EDIT**; verify-only confirmation.

Phase 9.7 will surface each file in turn for explicit per-file ack before CC writes.
