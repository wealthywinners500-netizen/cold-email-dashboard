# P14 (savini.info) — MXToolbox Domain-Health Audit

**Date:** 2026-04-22
**Scope:** 11 P14 domains (savini.info + 10 sending) via MXToolbox Domain Health UI (`https://mxtoolbox.com/domain/{domain}/`)
**Auditor oracle framework:** HL #110 — MXToolbox UI is **advisory only**; the Gate 0 oracle is the three-signal canonical (intoDNS FAIL=0 / mail-tester ≥ 8.5 / Postmaster High-or-Pending). This audit is a corroborative cross-check, not a gate.
**Pair:** `server_pairs.id = fbc03039-00db-4b93-b996-da16c1345814`, pair_number=14, status=active
**Job:** `2fa6ee56-557c-4020-b61b-197e524252bb` (completed, 47m 43s, saga baseline worker `99ff962`)
**Servers:** S1 `45.56.75.67` (`mail1.savini.info`), S2 `45.79.213.21` (`mail2.savini.info`)

---

## 1. Executive summary

**Verdict: CONDITIONAL GO — proceed with P15 + P16 provisioning.**

All 11 P14 zones scanned in MXToolbox Domain Health UI returned **0 Errors / 1 Warning** — a uniform pattern. The single warning on every zone is DNS-category `SOA Serial Number Format is Invalid`. There are zero hard fails (bucket A = 0), zero SEM/operational blacklist listings (bucket C = 0 — notably cleaner than Pair 13's 6/11 SEM FRESH result), and zero unclassifiable findings (bucket D = 0). The only non-zero bucket is B (advisory-only): MXToolbox is flagging a serial format that DNS ground-truth confirms is a valid `YYYYMMDDNN` per RFC 1912 §2.2 (`2026042202` / `2026042204`) — another instance of HL #110's F2 behavior class (MXToolbox thresholds stricter than its own public docs). No launch blocker exists under the three-signal canonical; Claude Code's intoDNS FAIL=0 / WARN=5 report stands as the authoritative Gate 0 verdict.

Two saga-drift observations surfaced during DNS ground-truth verification that are **not** MXToolbox-flagged but merit documentation: (i) P14's SOA timers are HestiaCP factory defaults (`7200 3600 1209600 180`), not the HL #107 MXToolbox-safe values (`3600 600 2419200 3600`) that Pair 13 received via operational backfill — indicating the HL #107 `domain.sh` template patch is not yet integrated into the saga; (ii) all five S1 sending domains (`lauseart`, `mareno`, `nelina`, `nelita`, `segier`) carry **two** MX records (`0 mail.{d}` + `10 mail1.{d}`) while the five S2 sending domains carry the single `10 mail.{d}` that HL #106 specifies — functional but asymmetric. Both are saga-hygiene items, not deliverability blockers.

---

## 2. Per-domain results

All 11 zones show the same Problems signature: **0 Errors, 1 Warning** (DNS: `SOA Serial Number Format is Invalid`). The single warning is identical in label and category across every zone.

| Domain | Server | MX Errors | MX Warnings | MX_A | MX_B | MX_C | MX_D | CC intoDNS FAIL | CC intoDNS WARN | Cross-reference notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| savini.info (NS apex) | S1/S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | n/a (admin) | 149 blacklist PASS, 37 mail-server PASS, 8 web PASS, 15 DNS PASS |
| lauseart.info | S1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 148 blacklist PASS. Double-MX observed (see §3.3). |
| mareno.info | S1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 149 blacklist PASS. Double-MX observed. |
| nelina.info | S1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 148 blacklist PASS. Double-MX observed. |
| nelita.info | S1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 148 blacklist PASS. Double-MX observed. |
| segier.info | S1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 149 blacklist PASS. Double-MX observed. |
| slaunter.info | S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 78 blacklist PASS, 30 mail-server PASS (reduced count — see §4.2). |
| suleon.info | S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 77 blacklist PASS, 30 mail-server PASS. |
| suleong.info | S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 79 blacklist PASS, 30 mail-server PASS. |
| teresi.info | S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 77 blacklist PASS, 30 mail-server PASS. |
| virina.info | S2 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 5 | 77 blacklist PASS, 30 mail-server PASS. |

**Totals:** MX errors = 0 × 11, MX warnings = 1 × 11. Hard-fail count = 0 across the full P14 set.

---

## 3. Consolidated issue catalog

Only one unique issue label surfaces across the 11 zones.

### 3.1 Issue: `SOA Serial Number Format is Invalid`

- **Category:** DNS
- **Host:** the apex of each zone (11 distinct hosts, one per domain)
- **MXToolbox severity:** Warning (yellow), not Error
- **Affected zones:** all 11 (savini.info, lauseart.info, mareno.info, nelina.info, nelita.info, segier.info, slaunter.info, suleon.info, suleong.info, teresi.info, virina.info)
- **Bucket classification: B (ADVISORY-ONLY)**
- **DNS ground truth:** every serial is already in the RFC 1912 §2.2 `YYYYMMDDNN` format that MXToolbox's own `/problem/dns/dns-soa-serial-format-valid` doc recommends. Verified via `dig +short @8.8.8.8 SOA {d}`:
  - `savini.info` → `2026042204`  (2026-04-22, counter 04)
  - `lauseart.info` / `mareno.info` / `nelina.info` / `nelita.info` / `segier.info` → `2026042202`
  - `slaunter.info` → `2026042204`
  - `suleon.info` / `suleong.info` / `teresi.info` / `virina.info` → `2026042202`
  - Cross-resolver consistent at `@ns1`, `@ns2`, and `@8.8.8.8` — no propagation split.
- **Why bucket B, not A:** this is not a missing / malformed / syntactically-invalid SOA. The RR parses, the record serves from both authoritative nameservers, serials align across resolvers, and `DNS Record Published` passes (confirmed at `https://mxtoolbox.com/SuperTool.aspx?action=soa%3asavini.info`). MXToolbox is flagging a format-convention check that the serial already satisfies — a textbook instance of HL #110 F2 (MXToolbox thresholds stricter/different from its own public documentation). Directly analogous to the SOA-Expire / SOA-Refresh / SOA-Minimum warnings HL #107 catalogs as advisory.
- **Why bucket B, not D:** this is a known MXToolbox behavior class (F2 "thresholds shift / UI disagrees with docs"), not an unexpected finding.
- **Delivered-mail impact:** none. The SOA serial's format affects nothing in the SMTP or DNSSEC paths; it is a zone-administration convention for slave-server cache invalidation.

### 3.2 Issues expected but NOT flagged by MXToolbox (noteworthy nulls)

- **Blacklist listings (bucket C, SEM FRESH):** `0` across all 11 zones. Pair 13 had SEM FRESH on 6/11 zones per HL #110 verification. P14 is **cleaner** on this dimension — either the fresh `.info` cohort was pulled from a different SEM sample window, or SEM has not yet indexed the P14 IPs (`45.56.75.67` / `45.79.213.21`). Either way, zero C-bucket is a positive signal for initial reputation.
- **SOA Refresh / Expire / Minimum / MTA-STS / TLS-RPT warnings:** `0` across all 11 zones. Under HL #107 these would be expected given the HestiaCP factory timers on P14 (see §3.4 below), but MXToolbox is silent on them. This reinforces HL #110: MXToolbox thresholds are moving targets and cannot anchor Gate 0.
- **DMARC external-authorization error:** `0`. The canonical minimal DMARC (`v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100`) carries no `rua=` / `ruf=` / `fo=`, so no external-domain permission check fires (HL #109 working as designed).

### 3.3 Observation (DNS ground truth, not MXToolbox-flagged): S1 sending-domain double-MX

Every S1-hosted sending domain has **two** MX records; every S2-hosted sending domain has **one**:

```
lauseart.info      10 mail1.lauseart.info. + 0 mail.lauseart.info.
mareno.info        10 mail1.mareno.info.   + 0 mail.mareno.info.
nelina.info        10 mail1.nelina.info.   + 0 mail.nelina.info.
nelita.info        10 mail1.nelita.info.   + 0 mail.nelita.info.
segier.info        10 mail1.segier.info.   + 0 mail.segier.info.
slaunter.info      10 mail.slaunter.info.
suleon.info        10 mail.suleon.info.
suleong.info       10 mail.suleong.info.
teresi.info        10 mail.teresi.info.
virina.info        10 mail.virina.info.
```

Both hostnames on each S1 zone resolve to the correct owning IP (`mail.{d}` → `45.56.75.67`, `mail1.{d}` → `45.56.75.67` — verified via `dig A`). Priority-0 `mail.{d}` wins at any receiver; mail delivers cleanly. However the asymmetry is a drift from HL #106's clean per-domain pattern (`@ MX 10 mail.{domain}`). Probable cause: a saga step wrote `mail1.{d}` at pri 10 (HestiaCP cluster-aware default), then the auto-fix rewrote `mail.{d}` at pri 0 without deleting the stale record. Functional but not clean. **Not flagged by MXToolbox** (mail-server column shows 0 errors / 0 warnings on every S1 zone).

- **Bucket:** B (advisory-only, not deliverability-impacting)
- **Action:** raise as a saga-hygiene follow-up; do not block P15/P16.

### 3.4 Observation (DNS ground truth, not MXToolbox-flagged): P14 vs P13 SOA-timer drift

| Pair | Refresh | Retry | Expire | Minimum | Source |
|---|---:|---:|---:|---:|---|
| **P13 (launta.info cluster, 11 zones)** | 3600 | 600 | 2419200 | 3600 | HL #107 MXToolbox-safe, applied via `scripts/launta-mx-soa-backfill.sh` on 2026-04-19 |
| **P14 (savini.info cluster, 11 zones)** | 7200 | 3600 | 1209600 | 180 | HestiaCP factory defaults (`/usr/local/hestia/func/domain.sh:516-522`) |

P14's zones were provisioned with **unpatched** HestiaCP defaults, whereas P13's received an operational backfill to the HL #107 values. This indicates the HL #107 `domain.sh` template patch is not yet a saga step — it exists as an operational-only script (`scripts/launta-mx-soa-backfill.sh`) rather than part of `pair-provisioning-saga.ts` step 1 / step 2. **MXToolbox did not flag any of these P14 timers**, even though HL #107 claims MXToolbox flags `Refresh > 3600`, `Expire < 1209600` (at-boundary), and `Minimum < 3600`. That non-flag is itself evidence of HL #110 F2 (thresholds shift or relax over time).

- **Bucket:** B (advisory / saga hygiene)
- **Action:** decision point for Dean — promote `domain.sh` patch into the saga, do an operational backfill on P14, OR accept factory defaults and downgrade HL #107 to note the threshold relaxation. Not a P15/P16 blocker.

---

## 4. Delta analysis — MXToolbox vs Claude Code (intoDNS)

### 4.1 Per-zone WARN-set delta

| Source | Per-zone WARN count | WARN set |
|---|---:|---|
| Claude Code `verify-zone.sh` (intoDNS canonical) | 5 | `soa_minimum`, `mta_sts`, `tls_rpt`, `smtp_probe × 2` (Mac-sandbox artifact) |
| MXToolbox Domain Health UI | 1 | `SOA Serial Number Format is Invalid` |
| **Overlap** | 0 | — |

The two tools flag **disjoint** WARN sets on the same zones. Neither tool's WARN list is a subset of the other's.

- MXToolbox does NOT flag: `soa_minimum` (P14 has `minimum=180`, well below HL #107's 3600 baseline), `mta_sts` (no HTTPS policy endpoint), `tls_rpt` (no reporting address), SMTP probes.
- Claude Code's intoDNS port does NOT flag: the serial format (serials are valid YYYYMMDDNN per RFC 1912 §2.2 and `verify-zone.sh` checks against that spec, not MXToolbox's undocumented stricter variant).

### 4.2 Tool fidelity — which is more likely correct per HL #110?

Per HL #110:
- **intoDNS is canonical.** It checks against published RFCs (1035, 1912, 5321, 6376, 7489, 8460) with documented thresholds, correlates with actual inbox placement, and is programmatically verifiable at any resolver. `verify-zone.sh` FAIL=0 is the Gate 0 pass/fail decision.
- **MXToolbox UI is advisory cross-check.** It has no paid API tier with Domain Health parity (F1), uses thresholds stricter than MXToolbox's own public docs (F2), and flags tier-1 senders like `google.com` and `cloudflare.com` on the same checks it flags us on (F3). It cannot gate Gate 0.

For this P14 audit specifically:
- The `SOA Serial Number Format is Invalid` warning contradicts MXToolbox's own `/problem/dns/dns-soa-serial-format-valid` documentation, which defines `YYYYMMDDNN` as the valid format that P14 zones already satisfy. **intoDNS is correct; MXToolbox UI is wrong.**
- The absence of SOA-timer warnings despite HestiaCP factory defaults contradicts HL #107's claim about MXToolbox behavior. **Most likely MXToolbox's thresholds shifted since 2026-04-19 (HL #110 F2).** intoDNS's `verify-zone.sh` independently flags `soa_minimum` per the HL #107 expectation; that flag should be treated as the real state.

### 4.3 Variance worth baking into the "expected WARN set"

Add to the "expected MXToolbox Domain Health WARN set for new P-pairs" list in `feedback_mxtoolbox_ui_api_gap.md`:
- `SOA Serial Number Format is Invalid` — surfaced on every zone despite the serial being valid RFC 1912 §2.2 `YYYYMMDDNN`. Dismissable per HL #110 F2.

Variance across the 11 P14 zones in MXToolbox's own passing-test counts (`Blacklist: 148–149` on S1-dominant zones, `77–79` on S2-dominant zones; `Mail Server: 37` on S1-dominant vs `30` on S2-dominant) is a **scope artifact**, not an indictment. MXToolbox's Domain Health report enumerates (blacklist × resolvable host) pairs; S2 sending domains have only a single `mail.{d}` MX whereas S1 sending domains have both `mail.{d}` and `mail1.{d}`, so S1 zones get ~1.8× more host-pair probes. Does not affect pass/fail.

---

## 5. Verdict

**CONDITIONAL GO — proceed with P15 + P16 provisioning.**

Applying the decision rule verbatim:
- **MX_A = 0** on all 11 zones → condition met.
- **MX_D = 0** on all 11 zones → condition met.
- **MX_B = 1 per zone, variant not in the expected WARN set** → triggers CONDITIONAL GO (not GO).
- **MX_C = 0** on all 11 zones → zero blacklist hits, stronger than required.

The three-signal canonical (HL #110) is already green on Pair 14 per Claude Code's E2E GREEN session:
- **(a) intoDNS canonical (`verify-zone.sh`)**: FAIL=0 on all 10 sending zones; WARN=5 in the HL #110 expected envelope.
- **(b) mail-tester ≥ 8.5**: deferred per HL #110 (Day-0 pre-warm has no sending history).
- **(c) Postmaster High-or-Pending**: deferred per HL #110 (Pending-Insufficient-Data is the expected pre-warm state).

MXToolbox-UI corroboration is green on bucket A (hard fail), green on bucket C (no SEM FRESH), and carries only a bucket-B variant that contradicts MXToolbox's own documentation. Under HL #110's explicit rule — "Path A canonical [intoDNS] is the gate; MXToolbox UI generates advisory output only, never blocks the gate" — P14 clears Gate 0 and P15 + P16 are unblocked.

---

## 6. Next steps

### 6.1 P15 + P16 launch plan (per MEMORY.md post-audit pipeline step 3)

1. **Buy 22 domains.** Invoke the `domain-generator` skill per `project_domain_generator.md`'s 4-stage pipeline (generate → availability → paranoid blacklist/history → scoring). Target `.info` TLD for cohort continuity with P13/P14 unless the generator's reputation filter pushes elsewhere. Registrar: Namecheap (per `feedback_provider_preferences.md`). Two 11-zone clusters: one NS-apex + 10 sending each.
2. **Provision P15.** New saga run on `main` worker baseline (currently `99ff962`; merge PR #17 first so the retry-with-backoff ships on main — see §6.3). Validation gate: three-signal canonical green + MXToolbox-UI advisory corroboration (bucket A = 0, bucket C accepted at any count, bucket B acceptable if within expected WARN set including the new `SOA Serial Number Format is Invalid` variant).
3. **Provision P16.** Same flow. If both P15 and P16 come up three-signal-green, the post-audit pipeline step 3 is complete and step 4 (Clouding→Linode migration of existing mail servers) is unblocked.
4. **Gate rule:** each of P15 / P16 must individually pass the three-signal canonical before the next starts. Do not batch-launch and reconcile after.

### 6.2 Recommended memory / doc updates before P15 (non-blocking)

- **`feedback_mxtoolbox_ui_api_gap.md`** — add `SOA Serial Number Format is Invalid` to the expected-WARN catalog, tagged as HL #110 F2 class (MXToolbox disagrees with its own doc at `/problem/dns/dns-soa-serial-format-valid`).
- **`feedback_hard_lessons.md` HL #107** — annotate that on 2026-04-22 P14 scan, MXToolbox no longer flagged the HestiaCP-factory timer values that HL #107 originally said it flagged. Two interpretations worth distinguishing for the next consolidate-memory pass: (a) MXToolbox thresholds relaxed, (b) MXToolbox's Domain Health sampling changed. Either way, HL #107's domain.sh patch is still worth doing for intoDNS's sake (`soa_minimum` still fires on 180s) — just no longer required for MXToolbox's sake.

### 6.3 Open items for Dean to decide (non-blocking for P15/P16)

1. **HL #107 domain.sh patch — promote to saga?** P14 shipped with HestiaCP factory SOA timers (`7200 3600 1209600 180`); P13 was operationally backfilled to HL #107 safe values (`3600 600 2419200 3600`). Decision: (a) add `patchDomainSHSOATemplate()` as a saga step 1.5, (b) run an operational backfill on P14 now, or (c) accept factory defaults going forward and downgrade HL #107 to "optional / MXToolbox-threshold dependent." Recommendation: (a) for durability; P15/P16 will then ship clean automatically.
2. **S1 double-MX drift — saga cleanup.** Five S1 sending domains on P14 carry both `0 mail.{d}` and `10 mail1.{d}`; five S2 carry only `10 mail.{d}`. Mail delivers correctly either way. The drift points at a saga step that writes `mail1.{d}` pri-10 on S1 without subsequently deleting it when auto-fix writes `mail.{d}` pri-0. A one-line saga patch (`v-delete-dns-record admin {d} <id-of-mail1-MX>` in the auto-fix finalize block) would clean it up for P15/P16. Not a deliverability issue; optional.
3. **PR #17 merge before P15/P16.** The VG2 fcrdns retry-with-backoff landed on a side branch during the P14 run; it did not engage on P14 (VG2 passed first attempt), but it is the safety net for future PTR-propagation-latency failures (the exact failure mode that halted the 2026-04-21 retry attempt per MEMORY.md). Merge to `main` before provisioning P15 so both new pairs get the protection.

### 6.4 Remediation plan — not applicable

No NO-GO findings. No remediation required.

---

## 7. Appendix — raw data

- **MXToolbox scan timestamps:** 2026-04-22 ~20:00–20:30 ET via authenticated `wealthywinners500@gmail.com` session, tabGroupId=735846785.
- **DNS ground-truth timestamps:** same window, via `dig @8.8.8.8 / @45.56.75.67 / @45.79.213.21`.
- **Authoritative MX records:** captured in §3.3.
- **Authoritative SOA serials + timers:** captured in §3.1 + §3.4.
- **Claude Code E2E GREEN report:** `dashboard-app/reports/2026-04-22-p14-fresh.md`.
- **MXToolbox per-domain URLs:** `https://mxtoolbox.com/emailhealth/{domain}/` — 11 scans, all reached `Complete` state before scraping.

No writes to `.auto-memory/` or `dashboard-app/src/` occurred during this session. Pure audit.
