# Phase 5a — P19 (`marketpartners.info`) zero-account mystery — VERDICT

**Run completed:** 2026-04-28T~16:45Z
**Saga golden tag sha:** `c1cc0bf96f7aed54a5e74c0f5cf20cb693263de1` ✓ unchanged
**Approach:** ULTRATHINK synthesis from Phase 1 + 3.0 + targeted Phase 5a Supabase deep-dive. Off-limits 5a.3 (Clouding S7/S8 SSH probe at `200.234.225.136` / `187.33.147.57`) skipped per audit prompt Appendix A — guardrail intact for THIS audit; lifts only for the next-next Clouding relay-migration workstream.

## TL;DR

P19 is a **pre-cutover destination pair**, NOT an orphan. The preserve-wave (session `fd86b0be`, 2026-04-25 13:35) landed Linode infrastructure (2 servers + 12 kroger-themed sending_domains) intended to receive the 45 Snov.io accounts currently tagged "Pair 4" (30) + "Pair 7" (15). Account cutover from the Snov.io side to the dashboard `email_accounts` table never landed. The 45 Snov accounts are `active=false` (warm-up disabled since 2026-04-04) and tagged with their old "Pair 4" / "Pair 7" labels — they have not been touched by P19's existence.

Dean's framing "P19 is on warm-up" is half-true: the destination INFRASTRUCTURE is provisioned and ready; the SOURCE accounts (Snov side) are present but warming-disabled and not yet bound to P19. **Resolution belongs to the next-next workstream (Clouding relay migration).**

## Live Supabase deep dive (5a.1)

### `server_pairs` row

```json
{
  "id": "b8850e04-3f3d-4e9a-9689-7fdbad8b60e4",
  "pair_number": 19,
  "ns_domain": "marketpartners.info",
  "s1_ip": "45.56.67.67",
  "s1_hostname": "mail1.marketpartners.info",
  "s2_ip": "72.14.189.188",
  "s2_hostname": "mail2.marketpartners.info",
  "status": "active",
  "warmup_day": 0,
  "total_accounts": 0,
  "provisioning_job_id": null,
  "created_at": "2026-04-25T15:23:32.731486+00:00"
}
```

Note: `provisioning_job_id=null` is the saga-vs-direct-insert tell. P19 was created via direct SQL by the preserve-wave session, not via the saga's `provisioning_jobs` orchestration. This is the same pattern as P11/P12/P13 historic preserve-wave inserts.

### 12 sending_domains attached to P19

All `blacklist_status='clean'`, all `last_dbl_check_at=null` (no DBL sweep has yet probed them). Domains:

```
krogerbrandreach.info
krogerentrancemedia.com
krogerinstoremedia.info
krogermediasolutions.info
krogerpartneraccess.info
krogerpartnerhub.info
krogerpartnernetwork.info
krogerpartnerplatform.info
krogerretailgrowth.info
krogerretailimpact.info
krogerretailnetwork.info
krogerstoremarketing.info
```

12 domains is anomalous vs the typical 10/pair. Per-pair convention is 5 sd × 2 servers = 10 (e.g. P11+P12 each have 5×2=10). P19's 12 reflects that Pair 4 (10 sd) + Pair 7 (5 sd) = 15 sd intended for cutover, but only 12 of those 15 made it into P19's preserve-wave insert. The 3 missing are likely sd that were already Spamhaus-DBL-burnt at preserve-wave time and dropped per HL #4 ("burnt domains never go to a healthy pair").

### `email_accounts` for P19: ZERO

`Range: 0-0` + `Prefer: count=exact` returns `*/0`. Confirms total_accounts=0 — no rows. The would-be cutover (binding Pair 4/7's 45 emails to P19) never occurred.

### `ssh_credentials` for `marketpartners.info` hostnames

| server_ip | hostname | created_at | provisioning_job_id |
|---|---|---|---|
| 200.234.225.136 | mail1.marketpartners.info | 2026-04-21 | null |
| 45.56.67.67 | mail1.marketpartners.info | 2026-04-25 | null |
| 72.14.189.188 | mail2.marketpartners.info | 2026-04-25 | null |

The 200.234.225.136 row is the historic Clouding S7 (the original Clouding mail server hosting Pair 4 / Pair 7 accounts); its row was preserved when DNS cut over to the new Linode IPs. 45.56.67.67 + 72.14.189.188 are the new Linode S1+S2 (preserve-wave-created). Three rows, two hostnames, three IPs — accurate snapshot.

The historic Clouding S8 (`187.33.147.57`) — the second half of the original Pair 4 — has **NO** row in `ssh_credentials`. Likely never recorded; pre-saga era (Pair 4 originated before automated provisioning). Out of audit scope to recover.

### `provisioning_jobs` for P19's `server_pair_id`: ZERO

```json
[]
```

Confirms P19 was created via direct SQL, not saga. Consistent with preserve-wave methodology (direct INSERTs to `server_pairs` + `sending_domains`, no saga invocation).

## Snov.io read (5a.2 — leveraging Phase 3.0 R1 evidence)

Per Phase 3.0's Snov.io live state read (`reports/audit/2026-04-29-phase-3.0-snovio-state.md`), the union "Pair 4" (30 accounts) + "Pair 7" (15 accounts) = 45 Snov-side accounts whose `From Email` domains are exactly the 12 P19 sending_domains:

| P19 dashboard sending_domain | Snov.io tag-owner |
|---|---|
| krogerbrandreach.info | Pair 4 |
| krogerinstoremedia.info | Pair 4 |
| krogermediasolutions.info | Pair 4 |
| krogerretailimpact.info | Pair 4 |
| krogerretailgrowth.info | Pair 4 |
| krogerstoremarketing.info | Pair 4 |
| krogerentrancemedia.com | Pair 7 |
| krogerpartneraccess.info | Pair 7 |
| krogerpartnerhub.info | Pair 7 |
| krogerpartnerplatform.info | Pair 7 |
| krogerpartnernetwork.info | Pair 4/7 |
| krogerretailnetwork.info | Pair 4/7 |

State per Phase 3.0 R1: all 45 Snov accounts have `active=false` (warm-up disabled globally since 2026-04-04 per `project_campaign_ops.md`). `usedCount=0`. SMTP/IMAP host config still points at the Clouding-era infrastructure (`mail1.marketpartners.info` resolved at the time to the Clouding S7 IP, but DNS has since cut to Linode 45.56.67.67 — the cert chain was the saga's per-domain LE re-issuance task per Phase 3.1).

## Off-limits 5a.3 (Clouding S7/S8 SSH probe) — SKIPPED

Per `feedback_clouding_panel_servers_offlimits.md` and audit prompt Appendix A: panel.* / Clouding mail-server SSH probes are out of scope for THIS audit. The off-limits guardrail explicitly remains in force; it lifts only for the next-next Clouding relay-migration workstream.

What this would have answered (deferred to relay-migration session):
- Are the historic Clouding mail accounts' mailboxes still on disk at S7?
- Does Hestia on S7 still have `marketpartners.info` mail-domain config + the 45 mailboxes?
- Are there inbox messages or follow-up state on those Clouding mailboxes that would need preservation in the cutover?

These are exactly the questions Phase 5c.1.5's `relay-account-classification.csv` is meant to seed. The audit produces the classification input; the relay-migration session reads it and SSHes the Clouding hosts.

## CC session-history search (5a.4) — already in Phase 1

Phase 1's master synthesis (`2026-04-29-phase-1-cc-session-review.md`) and the Master cross-check log identified session `fd86b0be` (2026-04-25 13:35) as the preserve-wave landing. That session inserted P19's `server_pairs` row + 12 `sending_domains` rows + 2 `ssh_credentials` rows + 0 `email_accounts` rows. The session's transcript explicitly defers account-cutover to "a separate workstream" (i.e. the planned Clouding relay-migration session — the next-next workstream).

No new session evidence to add in Phase 5a.

## Verdict (ULTRATHINK synthesis — 5a.5)

P19 is operationally an **empty-shell destination pair**, infrastructure complete. The 45 Pair-4/Pair-7 Snov.io accounts are intact but disconnected from the dashboard's `email_accounts` table. There is **NO orphan row** in any sense that warrants a delete — the row IS the destination of a planned cutover.

### Three paths for Dean's call

| Path | Action | Risk | Recommendation |
|---|---|---|---|
| **A** | Drop the orphan `server_pairs.P19` row + 12 `sending_domains` rows + 2 ssh_credentials rows. Discard infrastructure. | **HIGH** — destroys the destination of an in-flight migration; would force a future migration to re-provision identical Linode infrastructure. NOT recommended. | ✗ |
| **B** | Account cutover NOW: bind the 45 Snov "Pair 4" + "Pair 7" accounts to P19's `email_accounts` table via direct SQL inserts (preserve-wave pattern) + Hestia per-domain mail account creation on the new Linodes. Optional: warm-up-day preservation if any of the 45 had non-zero day before 2026-04-04 disable. | Medium — out of audit scope (the audit is read-only on data per Hard Rule #5; doing 45 inserts here would violate scope). Belongs to the relay-migration workstream's preserve scope. | ✗ in this audit |
| **C** | **Defer to the next-next workstream (Clouding relay-server migration).** Document the drift in this verdict. The relay-migration session inherits Phase 5c.1.5's `relay-account-classification.csv` as input; for each Snov-orphan account whose email matches one of P19's 12 sd, classify as `relay-with-followups-inapp` (preserve-cutover to P19) or `relay-no-followups-inapp` (recommission elsewhere). | Low — matches the audit prompt's R5 marker (Phase 10) and existing scope boundaries. | ✓ **RECOMMENDED** |

### Rationale for Path C

1. **Scope-adherent.** This audit is explicitly inventory-only on data deltas (Hard Rule #5: "Live data deletes only with per-row Dean ack"). Path B would require 45 INSERTs without per-row ack on each, plus Hestia mail-account creation on the new Linodes (out of audit hands).
2. **Off-limits intact.** The relay-migration session needs to SSH the Clouding S7/S8 to inventory mailboxes + follow-up state — and Path C waits for that session.
3. **Preserve-wave already half-landed Path B.** The infrastructure half is done. The migration session does the account half.
4. **No production risk.** P19's `total_accounts=0` means no live SMTP traffic flows through P19 today. Snov-side accounts are `active=false`. Nothing is silently broken.
5. **Aligns with Dean's stated next-next priority** (per audit prompt Phase 10 R5): "Clouding relay-server migration — the SINGLE next workstream after #1 [memory updates], AHEAD of campaigns."

### Master mental-model reconciliation

Dean's claim "P19 is on warm-up" is **factually wrong as of 2026-04-29** (warm-up state in Snov.io is `active=false` since 2026-04-04). The mental model conflates "P19's accounts exist somewhere" (true: in Snov) with "P19's accounts are warming up" (false: warm-up is disabled).

Correction for `MEMORY.md` / next session brief:
> P19 is a pre-cutover destination pair. The 45 Pair-4/Pair-7 Snov.io accounts intended to migrate to P19 are warm-up-disabled (Snov-side `active=false` since 2026-04-04), not actively warming. P19's account cutover is queued for the next-next Clouding relay-migration workstream.

Phase 9 candidate: surface this correction as a `MEMORY.md` patch proposal.

## Findings

| ID | Severity | Title |
|---|---|---|
| F-26 | **info** | P19 is a pre-cutover destination, not an orphan — resolves to relay-migration workstream (Path C) |
| F-27 | **P3** | `MEMORY.md` claim "P19 is on warm-up" is technically inaccurate — Snov accounts are `active=false`. Phase 9 patch candidate. |
| F-28 | **P3** | Pair 4 historic Clouding S8 IP `187.33.147.57` has no `ssh_credentials` row (pre-saga gap). Out of scope to recover; relay-migration session will rebuild from Hestia panel inventory if needed. |

## Outputs

- This verdict: `dashboard-app/reports/audit/2026-04-29-phase-5a-p19-verdict.md`
- Atomic commit: `audit: Phase 5a — P19 (marketpartners.info) zero-account verdict`

— end —
