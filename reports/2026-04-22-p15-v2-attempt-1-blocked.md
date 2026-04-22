# P15-v2 Launch Validation — 2026-04-22

## VERDICT: BLOCKED — saga halted at Step 1 (create_vps), all 6 Linode IP rerolls hit Barracuda blacklist; SOA-fix chain (PR #18 @ 7b64ad3) NOT exercised end-to-end

**Dean: do NOT click Provision on P16.** The SOA fix chain shipped in PR #18 has still never been validated end-to-end by a real saga run. The P15-v2 saga died inside `create_vps` without ever reaching Step 2 `install_hestiacp` where `patchDomainSHSOATemplate` runs or the verification gates where `validateSOASerialFormat` + `fix_soa_serial_format` fire.

---

## Identifiers

| Key | Value |
|---|---|
| `P15V2_JOB_ID` | `c0d3a1d1-a44c-4f90-b666-604d6300c4dc` |
| `P15V2_PAIR_ID` | *(null — no `server_pairs` row ever written)* |
| `P15V2_NS_DOMAIN` | `lavine.info` |
| `P15V2_S1_IP` | *(null — Step 1 never persisted an IP)* |
| `P15V2_S2_IP` | *(null — Step 1 never persisted an IP)* |
| Region config | s1=`us-central`, s2=`us-southeast` |
| Provider | Linode |
| Admin email | `admin@lavine.info` |
| Job created | `2026-04-22T15:24:42Z` |
| Step 1 started | `2026-04-22T15:24:45Z` |
| Step 1 terminal | `2026-04-22T15:35:10Z` (duration `613,454 ms` = **10m 13s**) |
| Job status (final) | `failed` |
| Repo HEAD at run | `a573f9b` (ahead of PR #18 merge `7b64ad3`) |

---

## Saga Step Timing

| # | Step | Start (UTC) | End (UTC) | Duration | Status |
|---|---|---|---|---|---|
| 1 | `create_vps` | 15:24:45Z | 15:35:10Z | 10m 13s | **FAILED — IP pre-check exhausted** |
| 2 | `install_hestiacp` | — | — | — | pending (never reached) |
| 3 | `configure_registrar` | — | — | — | pending (never reached) |
| 4 | `await_dns_propagation` | — | — | — | pending (never reached) |
| 5 | `setup_dns_zones` | — | — | — | pending (never reached) |
| 6 | `set_ptr` | — | — | — | pending (never reached) |
| 7 | `setup_mail_domains` | — | — | — | pending (never reached) |
| 8 | `await_s2_dns` | — | — | — | pending (never reached) |
| 9 | `security_hardening` | — | — | — | pending (never reached) |
| 10 | `verification_gate` | — | — | — | pending (never reached) |
| 11 | `auto_fix` | — | — | — | pending (never reached) |
| 12 | `verification_gate_2` | — | — | — | pending (never reached) |

Terminal error (from `provisioning_steps.error_message` + `provisioning_jobs.error_message`):

> `IP pre-check failed after 6 attempts. Last failure: BLACKLISTED [72.14.190.77: Barracuda]. All 6 Linode IP pairs either had blacklist hits or shared a /12 subnet. Try different regions or contact Linode support.`

---

## Gate A–E Results

| Gate | Requirement | Result |
|---|---|---|
| A (`TZ=UTC`) | S1 + S2 `timedatectl` shows `Etc/UTC` before Step 2 | **N/A — Step 2 never ran.** No SSH session ever opened to an S1/S2 because no Linode made it past IP pre-check. |
| B (`domain.sh` patch) | `PATCHED_BY_PROVISIONING_SAGA` marker in `/usr/local/hestia/data/templates/dns/domain.sh` on S1 + S2, above `update_domain_zone()` | **N/A — `patchDomainSHSOATemplate` never executed.** This is the PR #18 mutation that the whole run was designed to validate. |
| C (`v-change-dns-domain-soa` surfaces errors) | Un-swallowed exit-code handling at `hestia-scripts.ts:285-290` visible in step logs | **N/A — zone-setup step never ran.** |
| D (Check 5 runs) | `validateSOASerialFormat` in `verification-checks.ts` evaluates each zone | **N/A — verification gate never ran.** |
| E (`fix_soa_serial_format`) | If any zone `yyyymmdd > today_UTC`, auto-fix fires | **N/A — auto-fix phase never ran.** |

**Every gate this run was supposed to prove is still unproven.**

---

## Root Cause

**Saga code behaved correctly.** The `create_vps` pre-check at `src/worker/handlers/provision-step.ts:325-366` enforces **zero-tolerance DNSBL policy** per PATCH 20 (`src/lib/provisioning/ip-blacklist-check.ts:9-11`): any IP listed on ANY of ~40 DNSBL zones triggers a reroll. Barracuda is **intentionally FATAL** at this gate — Dean's standing rule is "never launch a dirty IP." The saga burned all 6 attempts (`MAX_IP_REROLL_ATTEMPTS = 5` + initial = 6) against Linode's `us-central` + `us-southeast` allocation pools and every pair either had a Barracuda listing on at least one IP or the two IPs shared a `/12` block (`PAIR_SUBNET_MIN_PREFIX = 12`, per `ip-blacklist-check.ts:407`).

**Not a saga bug.** HL #130 designates Barracuda + UCEPROTECT as WARN-only, but that scope is the **operational blacklist sweep at Gate 2** (`verification.ts:155-161`) — post-launch monitoring where transient listings shouldn't keep paging the operator. The **pre-launch gate** is zero-tolerance by design, and `checkIPBlacklist` in `ip-blacklist-check.ts` correctly enforces that. The two policies are consistent, not contradictory:

- **Step 1 `create_vps` pre-check:** ALL DNSBL listings FATAL → reject the IP, delete the Linode, reroll. Never launch dirty.
- **Step 12 `verification_gate_2` operational sweep:** Barracuda + UCEPROTECT L1 WARN-only → don't block a live, verified pair on their known-noisy output.

**Blocker is Linode IP-pool pollution, not saga logic.** The `us-central` (Dallas) + `us-southeast` (Atlanta) pools were delivering Barracuda-listed IPs on all 6 attempts — consistent with Barracuda's "~80% of Linode IPs" characterization in the HL #130 context. The last-seen dirty IP was `72.14.190.77`; the full list of the other 11 IPs tried during the 6 rerolls is not surfaced in `provisioning_steps.error_message` (only the last failure is captured — worth noting as a diagnostic gap, see Residual Risks below).

---

## E2E GREEN Validation (Phase 3)

**SKIPPED.** Phase 3 only runs if the saga reaches terminal status `SUCCESS`. This run terminated `FAILED` at Step 1. There is no SSH target, no HestiaCP install, no zone list, no AXFR to compare, no verify-zone.sh to run, no MXToolbox scan to execute, no mail-tester score to capture.

---

## Per-Zone Table

**Empty.** No zones were created. The 11-domain slate (`lavine.info` NS + `carosi/cirone/lodema/luvena/marife/morice/norita/renita/valone/verina.info`) is intact at Namecheap (per `2026-04-22-namecheap-inventory-p15-v2.md`) and remains available for the next attempt.

---

## Auto-fix Firings

**None.** `fix_soa_serial_format` cannot fire before `verification_gate` (Step 10), and the saga never got past Step 1.

---

## Residual Risks / Diagnostic Gaps

1. **Only the *last* reroll's IP is preserved in `error_message`.** `provisioning_steps.error_message` captures the final failure's reasonText but not the intermediate 5 rerolls' IPs/listings. To get the full 12-IP audit trail you need the worker's stdout log on `200.234.226.226` — `journalctl -u dashboard-worker --since "2026-04-22 15:24:00"` and grep `[ProvisionStep][create_vps] IP pre-check FAILED`. The `metadata` JSONB column is empty (`{}` effectively — just the dispatch markers). Worth considering: persist each reroll attempt's `{attempt, ip1, ip2, listings, sameSubnet}` into `provisioning_steps.metadata.rerolls[]` so a future BLOCKED run doesn't require SSH-to-worker spelunking to learn which regions churned.

2. **Region combo `us-central` + `us-southeast` is effectively unusable for create_vps right now.** Both regions delivered Barracuda listings aggressively enough that 6 rerolls couldn't find a clean pair. P14's successful retry on 2026-04-21 used `us-central` + `us-sea` (Seattle, `104.237.132.163` + `172.238.54.166`) which passed IP pre-check on the first try (`reports/2026-04-21-p14-e2e-saga-retry.md:200`). The `us-sea` rotation appears meaningfully cleaner than `us-southeast` for this account.

3. **No new `ssh_credentials` rows were written** (confirmed via `ssh_credentials WHERE created_at > '2026-04-22T15:00:00Z'` → 0 rows). Good — nothing to clean up from the failed attempt.

4. **P14 orphan state unchanged** (per prompt instruction). `server_pairs.id=fbc03039-00db-4b93-b996-da16c1345814` (savini.info) + `ssh_credentials` rows for `173.230.132.245` + `45.33.63.216` all still present, all deliberately untouched.

5. **Job row still shows `current_step='create_vps'` and `progress_pct=0`**, but `status='failed'` and `error_message` is populated — consistent with the saga-engine convention of leaving `current_step` as the last-attempted step on terminal failure.

6. **The earlier P15 attempt (`13bb6949-51fb-4fab-aa6a-e53962712dad`, NS `camire.info`) remains in `provisioning_jobs`** with `status=failed` from the Linode service-count cap. That's a different failure mode from this one; no cleanup needed.

---

## Recommended Next Step (for Dean, not for CC)

Retry P15-v2 with a fresh region combo. Two options ordered by empirical cleanliness on this account:

1. **`us-central` + `us-sea`** — proven clean on first try for P14 (2026-04-21) and P11/P12/P13 earlier. This is the safest re-roll target.
2. **`us-central` + `us-ord`** (Chicago) or **`us-iad`** (Washington) — never exercised by this account, fresh rotation.

**Do NOT retry with** `us-southeast` (Atlanta), `us-east` (Newark — saturated with P11/P12/P13), or `us-lax` (which ate 4 rerolls on the April P14 run per `2026-04-21-p14-e2e-saga-retry.md:134`).

Once a fresh region combo succeeds at Step 1, the remaining 11 steps should execute as normal and validate the PR #18 SOA-fix chain. No code change required; just a region swap in the Provision form.

If Linode continues to deliver polluted IP pools across multiple region attempts, the Leaseweb-as-second-provider path on the backlog becomes load-bearing — but that's out of scope for tonight.

---

## Memory Updates (Phase 5)

See commit message "P15-v2 saga validation BLOCKED 2026-04-22 + memory sync" for:

- `.auto-memory/MEMORY.md` — new dated entry under 2026-04-22 with BLOCKED verdict + job_id
- `.auto-memory/project_server_deployment.md` — new "Halted attempts" sub-section row
- `.auto-memory/project_saas_dashboard.md` — Gate 0 remains BLOCKED, reason updated with this run's failure mode
- `.auto-memory/feedback_rebuild_assessment.md` — Gate 0 status preserved as BLOCKED; this run added on top with date + root cause
- `.auto-memory/feedback_hard_lessons.md` — **NOT appended.** No new, non-obvious lesson here. The saga worked as designed; the blocker is an external IP-pool pollution condition that HL #130 already describes in principle, and the per-reroll diagnostic-gap observation in Residual Risks #1 is a quality-of-life improvement, not a rule worth an HL. (If the same BLOCKED pattern recurs across multiple region attempts, *that* would warrant a lesson — but one instance of "Linode us-central/us-southeast pool is dirty today" is weather, not climate.)

---

## Final Status

- **Verdict:** BLOCKED
- **What passed:** domain slate selection (`lavine.info` + 10 sending, all CLEAN) — retained for the retry attempt, no domain churn needed
- **What blocked:** `create_vps` IP pre-check exhausted 6 attempts in `us-central` + `us-southeast`
- **P16:** **DO NOT provision.** Retry P15-v2 first with `us-central` + `us-sea` to validate the PR #18 SOA-fix chain end-to-end. P16 is gated on that proof.
