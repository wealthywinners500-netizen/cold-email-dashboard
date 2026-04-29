# Phase 5b — P18 (`partnerwithkroger.store`) all-30-disabled mystery — VERDICT (synth-only)

**Run completed:** 2026-04-28T~17:00Z
**Saga golden tag sha:** `c1cc0bf96f7aed54a5e74c0f5cf20cb693263de1` ✓ unchanged
**Approach:** ULTRATHINK synthesis from Phase 1 + Master's pre-flight context (synth-only per Dean directive — 5b.1 SSH cert probe + 5b.2 DBL re-DQS + 5b.3 Linode VPS health all skipped; Phase 1 evidence is sufficient).

## CRITICAL POLICY ANCHOR (Dean directive 2026-04-29)

**P18 is preserve-protected.** Both P18 + P19 are excluded from Spamhaus-blacklist-burnt retirement treatment. The 8-of-10 DBL-burnt sd status is NOT operationally dispositive for retirement decisions. Both pairs were on prior warm-up and need to be used soon. **Path A (retire / drop / "non-recoverable as a sending pair") is OFF THE TABLE.**

This verdict frames P18 as a **preserve-protected asset queued for re-activation**, not as an orphan candidate for retirement.

## TL;DR

P18 has been all-30-disabled for **~5 days** (since 2026-04-24 21:34Z). Phase 1 + Master's pre-flight pinned the proximate cause (Exim STARTTLS error → 5-failure threshold → auto-disable cascade) and confirmed the 2026-04-25 11:25Z TLS plumbing fix landed successfully. **The mystery is NOT "TLS broken" — it is "no automated re-enable after TLS-fix-success."** No re-enable PATCH followed the fix; no operator manually flipped the 30 rows back to `status='active'`. Five days later the rows are still `disabled`.

The 8-of-10 sd DBL burns were detected 2026-04-27 18:36Z by the weekly DBL sweep cron — **3 days AFTER the TLS fix landed**. DBL burn timing is independent of disable timing; root causes are unrelated.

**Recommendation: Path B-variant — scope P18 re-enable into the relay-migration workstream alongside P19's account cutover.** Both are preserve-protected pairs in pre-cutover/pre-reactivation state; both queue naturally to the same next-next session.

## Critical timeline (the anchor of this verdict)

| UTC timestamp | Event | Source |
|---|---|---|
| **2026-04-24 20:18Z** | P18 saga created (job `1f8e4ba8`, ns_domain `partnerwithkroger.store`, S1=198.58.113.202, S2=45.79.111.192) | Phase 0.4 / Master pre-flight |
| **2026-04-24 21:34Z** | All 30 P18 `email_accounts` hit `last_error_at` with `Error upgrading connection with STARTTLS: 454 TLS currently unavailable`; auto-disabled via 5-failure threshold | Phase 1 + `2026-04-28-blast-exceptions-HALT.md` |
| **2026-04-25 11:25Z** | TLS plumbing fix lands on both P18 servers (43+57+39 host commands per Phase 1 session `68b428b9`) | Phase 1 master synthesis |
| **2026-04-25 11:25Z → 2026-04-27 18:36Z** | **54-hour window: TLS plumbing is fixed; no re-enable PATCH fires; no operator intervention** | Inference from Phase 1 + dashboard `email_accounts` state |
| **2026-04-27 18:36Z** | Weekly DBL sweep cron (PR #21 / commit `00b3260`) first detects 8/10 P18 sd as DBL-burnt | Master pre-flight |
| **2026-04-29 (now)** | All 30 accounts still `status='disabled'`, 5-day total downtime | Phase 0/1/4 baseline |

## Per-Phase-1 evidence (re-cited, not re-fetched)

### Disable cascade (proximate cause — RESOLVED at infra layer)

Phase 1 + the `2026-04-28-blast-exceptions-HALT.md` report documented:
- All 30 P18 `email_accounts` rows: `disable_reason='smtp_connection_failures'`, `consecutive_failures=5`, `last_error='Error upgrading connection with STARTTLS: 454 TLS currently unavailable'`, `last_sent_at=null`.
- The `consecutive_failures=5` means the dashboard's `smtp-connection-monitor` (worker-side cron) attempted 5 sequential authenticated SMTP connections to each account's `smtp_host:smtp_port`, all failed with the same TLS error, and the monitor flipped each row to `status='disabled'`.
- Root cause was the saga's HL #145-era cert-perm gap (per-domain cert keys at mode `0644` instead of `0640`, OR the per-domain `mail.<sd>` cert never installed). The 2026-04-25 11:25Z fix re-permed all per-domain cert keys + re-issued any missing per-domain LE certs on both servers (43+57+39 host commands across both halves).
- Post-fix: external STARTTLS:587 against `mail.<P18_sd>:587` succeeds (Phase 1 verified one account). The Exim daemon now negotiates TLS correctly with the per-domain certs.

### What the fix did NOT do — re-enable the 30 disabled rows

The cascade-disable side effect of the original TLS error left 30 `email_accounts` rows in `status='disabled'`. Nothing in the saga or the worker re-enables a row once it has been auto-disabled by `consecutive_failures >= 5` — that flag is a sticky state requiring an explicit `PATCH email_accounts SET status='active', consecutive_failures=0, disable_reason=null WHERE...`.

The Phase 1 review found NO PATCH commit / SQL statement / dashboard-UI-action that did this for P18 between 2026-04-25 11:25Z and 2026-04-29.

### DBL burns are independent

The 8 DBL-burnt sd:
- krogerpromopartners.info, krogerpromotions.info, krogerreach.info, krogerretailreach.info, krogerstoreadvertising.info, localgrocerymarketing.info, localgrocerymarketingpro.info, marketmygrocery.info

The 2 clean sd:
- krogerretailpartners.info, krogerstoregrowth.info

All 10 last DBL-checked 2026-04-27 18:36-37Z (the FIRST sweep that reached P18). The timing means the burns existed BEFORE 2026-04-27 (they were already on Spamhaus DBL when the cron first probed) — but by exactly when, no one can know without older sweep history. The DBL data point does NOT correlate with the disable cascade because:
1. Disabled rows have `last_sent_at=null` — P18 has never sent a single email.
2. Spamhaus DBL listings come from spam-trap hits or content-based pattern matching against domains that have *already sent* spam-flagged email. P18 has no send history.
3. Therefore the burns must have inherited some external context — either domain-name semantic similarity to known-burnt domains (Spamhaus DBL flags brand-impersonation patterns including "kroger*" + "*grocery*"), or (less likely) a registrar-history flag from when the domains were first registered.

The DBL burns are an independent signal — relevant for sd-rotation planning but NOT the cause of the disabled state.

## Master's pre-flight context (used directly per directive)

| Fact | Value | Source |
|---|---|---|
| P18 IS Linode (off-limits guardrail does NOT apply) | S1=198.58.113.202, S2=45.79.111.192 | Master |
| P18 ns_domain | `partnerwithkroger.store` | Master |
| P18 saga creation | 2026-04-24 by job `1f8e4ba8` | Master |
| `ssh_credentials` rows for both P18 IPs | EXIST (created 2026-04-24 19:22 by job `1f8e4ba8`) | Master |
| Worker-VPS password-decrypt recipe applicability | viable for future SSH if needed | Phase 3.1.5 inheritance |
| P18 email_accounts: status breakdown | 30 disabled / 0 active | Master + Phase 0/4 |
| P18 sd: blacklist breakdown | 8 burnt / 2 clean (last sweep 2026-04-27 18:36-37) | Master |

5b.1 / 5b.2 / 5b.3 SSH+DBL+Linode-API probes skipped per directive. The above facts are sufficient for synthesis.

## Verdict (ULTRATHINK — 5b.5)

P18 is NOT a "broken pair" in the sense the term usually carries. P18 is a **fully provisioned + TLS-correct + currently-disabled pair** with:
- 30 valid `email_accounts` rows (passwords intact, smtp_user correct, sending_domain bindings correct)
- 10 sd attached (8 DBL-burnt + 2 clean)
- Both Linode mail servers operational, certs correct (per Phase 1 fix)
- Zero send history (never sent any mail; warm-up never started)
- Both `ssh_credentials` rows in place for future SSH

The 5-day downtime is a **process-level gap**: the disable was triggered by a TLS error that has since been fixed, but the auto-disable side effect was never reversed. This is not a pair-specific issue — it's a systemic operational gap that any future TLS-related cascade-disable would replicate.

### Two paths for Dean's call (Path A retired per policy)

| Path | Action | Risk | Recommendation |
|---|---|---|---|
| **B (re-enable now)** | Bulk PATCH the 30 P18 accounts to `status='active'` + clear `consecutive_failures`/`disable_reason`. Run live-auth preflight on one account first (HL #140 — never bulk PATCH without external preflight). Optionally rotate the 8 burnt sd before warm-up start. | Medium — re-enables the 5-day-stale accounts, may surface new failure modes that have accumulated. Live-auth preflight catches the obvious blockers. The 8 burnt sd would warm up onto IPs already reputation-clean but the From-domain reputation would carry the DBL listing into Snov.io's per-domain reputation calculation. | Acceptable for an active-launch posture, but premature given the relay-migration workstream is queued and will touch P18 anyway. |
| **B-variant (defer to relay-migration workstream — RECOMMENDED)** | Preserve P18 in current state. Schedule re-enable as part of the next-next Clouding relay-migration session, alongside P19 account cutover. The relay session has the right scope (mail-server SSH allowed, Hestia mailbox state inspectable, etc.) and can re-enable with proper sd-rotation if needed. | Low — preserves the asset, defers the medium-risk re-enable to the right scope. Aligns with audit Hard Rule #5 (no live data PATCHes without per-row ack — re-enable would be 30 PATCHes). | **✓ RECOMMENDED** |

### Rationale for Path B-variant

1. **Same scope as Phase 5a Path C.** P19 is queued for relay-migration; P18 has the same shape (preserve-protected, pre-reactivation). One session resolves both.
2. **DBL-burnt-sd handling.** 8 of P18's 10 sd are DBL-burnt. The relay-migration session can decide whether to (a) start warm-up on all 10 (relying on per-domain isolation per HL #117 — the burns are From-domain-level, the IPs are clean), (b) swap the 8 burnt for new clean sd before warm-up start, or (c) keep all 10 and accept reduced inboxing on the burnt 8. This decision is migration-scope, not audit-scope.
3. **Live-auth preflight cleanly fits the migration session.** That session will SSH the new Linodes (and the old Clouding hosts for P19 sources), so running a `swaks --tls --auth PLAIN` preflight against `mail.<P18_sd>:587` is just a step in the same workflow.
4. **No production risk in deferral.** P18 has zero send history. Warm-up has not started. Snov-side accounts for these 10 sd: zero (Phase 3.0 R1 — no `Pair 18` tag in Snov inventory). Nothing depends on P18 being active today.

### Recommendation phrasing for Phase 7 fix-backlog

`P18 re-enable: defer to Clouding relay-migration workstream (next-next session). Preserve-protected per Dean policy. Re-enable scope includes: live-auth preflight, bulk PATCH of 30 disabled rows, decision on 8 burnt sd (keep / rotate / swap), warm-up start coordination with Snov.io import. NOT in scope for this audit's Phase 8.`

## P3 process-level finding — HL-promotion candidate

### F-29 (P3) — No automated re-enable after TLS-fix landing

The 54-hour window between TLS plumbing fix (2026-04-25 11:25Z) and any meaningful re-engagement of P18 (still ongoing 5 days later) reveals a systemic gap:

> When the saga or an operator lands a fix that addresses the root cause of an `email_accounts` cascade-disable (e.g., HL #145 cert-perm, HL #138 missing smtp_pass), there is NO automated re-enable. The 5-failure auto-disable threshold doesn't auto-clear when the underlying cause is resolved. Affected rows stay `disabled` until an explicit operator-initiated PATCH.

**Why this matters:**
- Future TLS / cert / auth fixes will replicate this gap on whichever pair gets cascade-disabled next.
- The dashboard UI doesn't surface "this disabled set is recoverable post-fix" — it shows the 30 rows as red-bar disabled with no remediation path.
- The audit prompt's R4 (Pair Verify oracle) doesn't gate this either — Pair Verify checks live infra, not stale row state.

**Proposed HL #152 (Phase 9 candidate):**

> **HL #152 — Cascade-disable rollback is operator-driven, not saga-driven.** When a saga or post-launch fix resolves the root cause of an `email_accounts` cascade-disable (e.g., a TLS plumbing fix, a cert-perm sweep, a DKIM key rotation), affected rows DO NOT auto-rehabilitate. The 5-failure auto-disable flag (`consecutive_failures >= 5` → `status='disabled'`) is sticky and requires explicit `PATCH ... SET status='active', consecutive_failures=0, disable_reason=null`. Always pair an infra fix with: (a) one live-auth preflight on a representative account (HL #140), (b) bulk PATCH of the affected disabled rows, (c) post-PATCH wait for the next `smtp-connection-monitor` cycle to re-validate. P18 sat 5+ days disabled after its 2026-04-25 TLS fix because no operator/process closed step (b). (2026-04-29 audit).

This is a process-level pattern, not pair-specific — promote to HL.

## Findings

| ID | Severity | Title |
|---|---|---|
| F-29 | **P3 → HL-promotion** | 54-hour TLS-fix-to-no-re-enable gap on P18 reveals systemic cascade-disable rollback is operator-driven (HL #152 candidate) |
| F-30 | **info** | P18 is preserve-protected per Dean policy; retirement off the table; re-enable defers to relay-migration workstream |
| F-31 | **info** | P18's 8 DBL-burnt sd are independent of the disable cascade (P18 has zero send history); DBL detection lagged disable by 3 days |
| F-32 | **info** | P18 + P19 share migration-shape (preserve-protected, pre-reactivation); naturally bundle into one relay-migration session |

## Outputs

- This verdict: `dashboard-app/reports/audit/2026-04-29-phase-5b-p18-verdict.md`
- Atomic commit: `audit: Phase 5b — P18 (partnerwithkroger.store) all-30-disabled verdict`

## Phase 9 patch candidates accumulated through 5b

(running list)

1. "13 saga files" → "16 saga files" (or dynamic FORBIDDEN_FILES read) — audit prompt
2. `/dashboard/pairs/[id]` → `/dashboard/servers/[id]` — audit prompt
3. F-9 `email_accounts.smtp_pass` plaintext clarification — audit prompt
4. F-22 `commandForIgnoringBuildStep` conditional engagement — audit prompt
5. F-27 `MEMORY.md` "P19 is on warm-up" → "P19 is pre-cutover destination"
6. **NEW: 5a verdict prose patch** — drop speculative "3 sd dropped per HL #4 DBL-burn at preserve-wave time" framing in §"12 sending_domains attached to P19"; replace with "P19 has 12 sd by design (Dean's intentional choice at preserve-wave time)."
7. **NEW: HL #152 candidate** — Cascade-disable rollback is operator-driven, not saga-driven (F-29 promotion)
8. HL #150 candidate (F-9) — two-column storage-format split
9. HL #151 candidate (F-24) — rolling-anchor convention for `pXX-golden-saga-YYYY-MM-DD` tags

— end —
