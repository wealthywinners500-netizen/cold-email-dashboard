# P14 step-12 fcrdns failure — diagnostic (2026-04-22)

## Verdict: **PROPAGATION-RESOLVED**

The 04-21 `verification_gate_2` failure (`fcrdns:both × 2` on job `f08525f5-d8dc-4f8b-a4ae-2b3374875d67`) was Linode PTR propagation latency. ~18 h later, all four major resolver providers (Google / Cloudflare / Quad9 / OpenDNS) now return the expected reverse DNS, forward DNS is consistent, and `tools/verify-zone.sh` on a sample P14 sending domain reports FAIL=0.

**Recommendation:** a write-session prompt is now safe to draft for creating a fresh `provisioning_jobs` row pointed at the existing Linode infra (104.237.132.163 + 172.238.54.166) and re-driving the saga. Completed-step idempotency must be validated before re-firing — detail below in the "Implications" section.

---

## Session rules (all honored)

- READ-ONLY. Zero writes to Supabase, zero changes on any Linode, zero worker restarts, zero code changes in `dashboard-app/src/`.
- Single commit — this diagnostic report only.
- No worker sync (worker stayed on `d63a716`, 2 behind baseline `e60e4ab` — diagnostic does not require it).
- Circuit breakers 1–4: none tripped. See "Circuit breaker review" section.

Baseline SHA: `e60e4ab7969757c9410665eea7a6a3d34a285823`.

---

## Part 1 — Identified 04-21 attempt (extracted verbatim from reports)

| Field                   | Value                                                                                                                                |
|-------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `provisioning_jobs.id`  | `f08525f5-d8dc-4f8b-a4ae-2b3374875d67`                                                                                               |
| `ns_domain`             | `savini.info`                                                                                                                        |
| S1 IP                   | `104.237.132.163` (us-central / Dallas TX, Linode 96413796)                                                                          |
| S2 IP                   | `172.238.54.166` (us-sea / Seattle WA, Linode 96413798)                                                                              |
| S1 expected HELO / PTR  | `mail1.savini.info`                                                                                                                  |
| S2 expected HELO / PTR  | `mail2.savini.info`                                                                                                                  |
| Step 12 failure message | `Worker step "verification_gate_2" failed: VG2: 2 unresolved after auto-fix: fcrdns:both, fcrdns:both`                               |
| Step 12 failed at       | 2026-04-21T17:14:24Z                                                                                                                 |
| Sending domains (10)    | `lauseart.info`, `nelina.info`, `nelita.info`, `slaunter.info`, `suleon.info`, `suleong.info`, `teresi.info`, `virina.info`, `segier.info`, `mareno.info` |
| S1-primary zones (6)    | `savini.info`, `lauseart.info`, `mareno.info`, `nelina.info`, `nelita.info`, `segier.info`                                           |
| S2-primary zones (5)    | `slaunter.info`, `suleon.info`, `suleong.info`, `teresi.info`, `virina.info`                                                         |
| Sources                 | [reports/2026-04-21-p14-e2e-saga-retry.md](2026-04-21-p14-e2e-saga-retry.md), [reports/2026-04-22-p14-retry-halt.md](2026-04-22-p14-retry-halt.md) |

**Prompt-drift flag:** the diagnostic prompt hinted IPs `173.230.132.245` (S1) / `45.33.63.216` (S2) per "MEMORY.md top-matter 2026-04-20." Those IPs do NOT match the 04-21 attempt and are not referenced in either of the two 04-21 reports; they appear to be from an earlier savini attempt (job `4da406f0-41db-4344-8ad3-015f87e4799a` from 2026-04-17 per the halt report's `provisioning_jobs savini.info` query — IPs there not captured). Used the 04-21 report's IPs, which are the ones the failed VG2 actually ran against.

---

## Part 2 — PTR ground truth (reverse DNS) — CLEAN

Issued from the sandbox Mac at 2026-04-22 (~18h after VG2 failure). Run: `dig +short -x <ip> @<resolver>`.

| IP                 | @8.8.8.8            | @1.1.1.1 (UDP)                               | @1.1.1.1 (TCP)                        | @1.0.0.1 (TCP)        | @9.9.9.9             | @208.67.222.222      |
|--------------------|---------------------|----------------------------------------------|----------------------------------------|-----------------------|----------------------|----------------------|
| `104.237.132.163`  | `mail1.savini.info.`| *intercept by LAN `192.168.0.1#53` (artifact)* | *TCP refused (filtered at edge)*        | `mail1.savini.info.`  | `mail1.savini.info.` | `mail1.savini.info.` |
| `172.238.54.166`   | `mail2.savini.info.`| *intercept by LAN `192.168.0.1#53` (artifact)* | *TCP refused (filtered at edge)*        | `mail2.savini.info.`  | `mail2.savini.info.` | `mail2.savini.info.` |

The two `1.1.1.1` failures are network-path artifacts from the Mac sandbox, not DNS signals:
- UDP reply came from `192.168.0.1#53` instead of `1.1.1.1#53` → local router is intercepting UDP/53 to that destination.
- TCP to `1.1.1.1#53` was actively refused → same edge filter at the TCP layer.
- Cloudflare's secondary anycast IP `1.0.0.1` over TCP resolved cleanly → Cloudflare's authoritative cache agrees with the other providers.

**Four distinct providers (Google, Cloudflare via 1.0.0.1, Quad9, OpenDNS) all see PTR clean. Not ambiguous.**

For direct comparison to the VG2 check: `src/lib/provisioning/verification-checks.ts` uses `reverseResolver='8.8.8.8'` (per PR #5 / HL #102). That resolver returned `mail1.savini.info.` and `mail2.savini.info.` cleanly — the exact check-class that failed at VG2 would now pass.

---

## Part 3 — Forward DNS (A records) — CLEAN and aligned with PTR

Run: `dig +short A <hostname> @<resolver>`.

| Hostname               | @8.8.8.8          | @1.0.0.1          | @9.9.9.9          | @208.67.222.222   |
|------------------------|-------------------|-------------------|-------------------|-------------------|
| `mail1.savini.info`    | `104.237.132.163` | `104.237.132.163` | `104.237.132.163` | `104.237.132.163` |
| `mail2.savini.info`    | `172.238.54.166`  | `172.238.54.166`  | `172.238.54.166`  | `172.238.54.166`  |

Forward-confirmed reverse DNS (fcRDNS) satisfied on both halves:
- `104.237.132.163` ⇄ `mail1.savini.info` (PTR and A agree)
- `172.238.54.166` ⇄ `mail2.savini.info` (PTR and A agree)

---

## Part 4 — `tools/verify-zone.sh lauseart.info savini.info 104.237.132.163 172.238.54.166`

```
=== Zone: lauseart.info (NS: savini.info, S1: 104.237.132.163, S2: 172.238.54.166) ===
  [PASS] parent_delegation
  [PASS] ns_consistent
  [PASS] soa_serial_consistent (2026042124)
  [PASS] soa_refresh (7200)
  [PASS] soa_retry (3600)
  [PASS] soa_expire (1209600)
  [WARN] soa_minimum — 180 outside 300-86400
  [PASS] mx_present
  [PASS] mx_resolves (mail.lauseart.info → 104.237.132.163)
  [PASS] mx_ptr_server_identity (mail1.savini.info) — per-domain MX + shared HELO per HL #106
  [PASS] mx_resolves (mail1.lauseart.info → 104.237.132.163)
  [PASS] mx_ptr_server_identity (mail1.savini.info) — per-domain MX + shared HELO per HL #106
  [PASS] spf_present
  [PASS] spf_lookups (0)
  [PASS] spf_hardfail
  [PASS] dmarc_present
  [PASS] dmarc_policy (p=quarantine)
  [PASS] dmarc_rua_informational (present — fine but not required under cold-email canonical)
  [WARN] dmarc_adkim — adkim=r not set (relaxed alignment preferred for subdomain bounces)
  [WARN] dmarc_aspf — aspf=r not set
  [PASS] dkim_present
  [PASS] dkim_algo
  [PASS] caa_letsencrypt
  [PASS] mta_sts_txt
  [WARN] mta_sts_policy_reachable — HTTPS policy file missing or wrong format
  [WARN] tls_rpt_present — no TLS-RPT record at _smtp._tls.lauseart.info
  [WARN] smtp_starttls_advertised — STARTTLS not in EHLO response
  [WARN] smtp_cert_cn — could not parse cert CN from STARTTLS handshake
  [PASS] spamhaus_zen (104.237.132.163) — clean on 7/10 checkable resolvers
  [PASS] spamhaus_zen (172.238.54.166) — clean on 7/10 checkable resolvers
=== Summary: lauseart.info — WARN=7 FAIL=0 ===
Exit=1 (script's "at least one WARN" exit code, FAIL=0)
```

### Classification of the 7 WARNs (all known / expected for a pre-canonical-DMARC saga deployment)

| # | WARN                                   | Category       | Root cause                                                                                                                                                                                                                         | Gate-authoritative? |
|---|----------------------------------------|----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| 1 | `soa_minimum — 180 outside 300-86400`  | SOA            | SOA minimum/negative-TTL deferred per HL #107 follow-up. Same class as the WARNs the 04-20 Pair 13 validation accepted.                                                                                                             | No                  |
| 2 | `dmarc_adkim — adkim=r not set`        | DMARC template | The 04-21 saga fired at 16:17 UTC — **before PR #14 merged at 19:14 UTC** on 2026-04-21. PR #14 introduced `src/lib/provisioning/dns-templates.ts` with the canonical `v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100`. Existing zones on these VPS were written with the old template. | No                  |
| 3 | `dmarc_aspf — aspf=r not set`          | DMARC template | Same as #2.                                                                                                                                                                                                                        | No                  |
| 4 | `mta_sts_policy_reachable`             | MTA-STS        | HTTPS policy file deferred per prior Pair 13 validation WARN set ("MTA-STS HTTPS deferred"). Not required for inbox placement.                                                                                                     | No                  |
| 5 | `tls_rpt_present`                      | TLS-RPT        | Not mandated by cold-email canonical. Same WARN on Pair 13.                                                                                                                                                                        | No                  |
| 6 | `smtp_starttls_advertised`             | SMTP probe     | Recurring Mac-sandbox artifact per prior reports ("SMTP probe Mac-artifact"). Worth re-confirming from the worker VPS if this becomes gate-blocking, but is non-blocking under HL #110.                                            | No                  |
| 7 | `smtp_cert_cn`                         | SMTP probe     | Dependent on #6 (can't parse cert if STARTTLS probe didn't land).                                                                                                                                                                  | No                  |

**FAIL = 0.** This is the single gate-authoritative axis per HL #110. intoDNS canonical is green on lauseart.info.

Extrapolation caveat: verify-zone.sh was run on 1 of 10 P14 sending domains. All 10 were configured identically by the same saga steps (5/6/7), and all 10 share the same two servers, so zone-state divergence is unlikely — but full 10/10 verification is a follow-up task for the actual write-session retry.

---

## Verdict rationale

The three signals under HL #110's canonical:

| Signal                                | Result                                                                   | Status |
|---------------------------------------|--------------------------------------------------------------------------|--------|
| (a) intoDNS — `verify-zone.sh` FAIL=0 | lauseart.info: FAIL=0, WARN=7 (all known-expected)                       | **GREEN (gate-authoritative)** |
| (b) mail-tester ≥ 8.5/10              | Not measurable in a read-only session (would require live send)          | Deferred to post-retry |
| (c) Google Postmaster Tools           | Pending-Insufficient-Data expected pre-warm-up                           | N/A pre-warm-up |
| (d) MXToolbox UI                      | Advisory only per HL #110 — not exercised in this session                | N/A (advisory) |

PTR + forward-DNS alignment is the direct prerequisite for fcrdns PASS. Both confirmed clean across 4 distinct providers. The `verification-checks.ts` fcrdns check uses `@8.8.8.8` which returned clean on both IPs.

**Therefore: PROPAGATION-RESOLVED.** No evidence of infra or code bug. The 04-21 VG2 failure was exactly what the 04-21 report categorized it as — Linode authoritative `.ip.linodeusercontent.com` zone → public resolver cache lag, which has since resolved.

---

## Implications for a write-session retry (NOT performed here)

These are *proposed for a future write session*, not taken in this one.

1. **Fresh `provisioning_jobs` row vs. resume-from-step-12.**
   - The saga has no resume-from-step-N mechanism per the 04-21 report. Every retry goes through all 12 steps.
   - Steps 1–9 are NOT idempotent in practice: Step 1 (`create_vps`) would allocate two new Linodes; Step 3 (`configure_registrar`) would try to re-set NS at Namecheap (safe per namecheap.ts:495 glue-record handling); Step 6 (`set_ptr`) would reset PTR on NEW Linodes; etc. Firing a fresh job naïvely re-creates infrastructure and wastes the existing pair.
   - Correct approach: a fresh `provisioning_jobs` row whose `config` + implementation path points at the EXISTING Linode IDs (96413796 + 96413798). That requires either (a) a saga-resume code path that does not currently exist (would violate the retry-only circuit breaker), or (b) re-running only the "verify" tail (steps 10–12) from a one-off TS harness — which is what `runPairVerification` logically is. Needs design in the write-session prompt.

2. **DMARC template drift on the 04-21-provisioned zones.**
   - All 10 sending zones + `savini.info` were written with the pre-PR-#14 DMARC template (rua present, `adkim=r` + `aspf=r` missing). A fresh saga run on the same domains would overwrite with the canonical — but a "resume verify" would not.
   - Implication: if the retry is "resume verify," a separate DMARC-rewrite pass is needed. If the retry is "fresh saga," the DMARC will self-heal via Step 7's current template.
   - Call this out in the write-session prompt so Dean picks path consciously.

3. **mail-tester + Postmaster are out-of-band signals.**
   - Per HL #110, signals (b) and (c) are gate-authoritative alongside (a). A "green verdict" on this diagnostic does NOT imply mail-tester ≥ 8.5 on every domain — that needs live send tests after retry completion.

4. **Worker VPS drift.**
   - Worker is on `d63a716`, baseline is `e60e4ab` (2 commits behind — PR #14 + PR #15). PR #14 adds `dns-templates.ts` which the SAGA code at Step 7 calls; running a fresh saga on a behind worker means the old DMARC template runs again.
   - Write-session must sync worker before firing any retry.

---

## Circuit breaker review

| # | Trigger                                                                                              | Status       |
|---|------------------------------------------------------------------------------------------------------|--------------|
| 1 | Cannot locate 04-21 P14 report or Linode IPs + ns_domain                                             | Not tripped. All data located and cited. |
| 2 | Linode IP unreachable via SSH using creds from the 04-21 report / `ssh_credentials` table            | Not tripped. This session made no SSH attempts to the Linodes — diagnostic is dig-only, read-only, from the sandbox. |
| 3 | Any write to Supabase / change on a Linode / git commit other than this report / worker restart      | Not tripped. One commit (this report). Zero Supabase writes, zero Linode changes, zero worker restarts. |
| 4 | Ambiguous diagnostic (one resolver says clean, another says stale after 5-min re-check)              | Not tripped. 4 distinct providers all see PTR clean; the 1.1.1.1 failures are network-path artifacts identified by their error signatures (`reply from unexpected source 192.168.0.1#53` = LAN interception; TCP `connection refused` = edge filter), not PTR staleness. |

---

## Wall-time and command summary

Issued from the sandbox, all read-only:
- 8 reverse-DNS probes (`dig -x`) — UDP to 4 resolvers × 2 IPs
- 4 reverse-DNS probes (`dig +tcp -x`) — Cloudflare 1.1.1.1 / 1.0.0.1 × 2 IPs
- 8 forward-DNS probes (`dig A`) — 4 resolvers × 2 hostnames
- 1 `tools/verify-zone.sh` invocation on `lauseart.info`
- 3 read-only file reads on existing reports and `.auto-memory/*.md`

No network calls to Linode API, no SSH, no Supabase query, no code execution in `dashboard-app/src/`.

---

## Appendix — reference files read

- [reports/2026-04-21-p14-e2e-saga-retry.md](2026-04-21-p14-e2e-saga-retry.md) (authoritative for 04-21 job id, IPs, step timeline, fcrdns root cause).
- [reports/2026-04-22-p14-retry-halt.md](2026-04-22-p14-retry-halt.md) (captures actual `server_pairs` + `sending_domains` schema; flags `saga_status` / `server_pair_id` prompt drift).
- `.auto-memory/feedback_mxtoolbox_ui_api_gap.md` (HL #110 canonical, closed 2026-04-20 — three-signal stack, intoDNS gate-authoritative).
- `.auto-memory/feedback_schema_verify_before_prompt.md` (confirms column names; reaffirms `server_pairs.status` not `saga_status`, `sending_domains.pair_id` not `server_pair_id`).
