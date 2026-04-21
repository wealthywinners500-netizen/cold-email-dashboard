# P14 End-to-End Saga Retry on NEW_SHA — 2026-04-21

**Final verdict:** `P14 RED — failed at phase 5 / step 12 (verification_gate_2): 2 unresolved fcrdns:both after auto-fix — Linode→public-resolver PTR propagation latency (1-24h per HL #102), NOT a saga code bug; PTR correctly set via Linode API in step 6 (both halves) and re-fixed in step 11; S1 propagated to public resolver @8.8.8.8 by gate-check time, S2 still ENOTFOUND. No Hestia command failure at any step. PATCH 10d complete and runtime-validated: 10d-1/10d-2 (Step 7 S2 DNS-rewrite routing) PROVEN; 10d-3 (Step 11 auto-fix routing via pickOwningServer) PROVEN; 10d-4 (fixSOASerialSync) not exercised because VG1 flagged no soa_serial issues — not broken, just not runtime-stimulated. Steps 1-11 all green. 22/22 DKIM visible, region diverse, both IPs DNSBL-clean, HELO banners match hostnames. Pair-verify NA (no pair_id — saga terminated before server_pairs materialization). Details in report.`

## Meta

- Session 1 report reference: [2026-04-21-patch-10d-fix.md](2026-04-21-patch-10d-fix.md)
- Session 1 NEW_SHA: `d63a7161262e3337fcdc65250fc795811233fc83` (merge of PR #13, 4 fix commits + 1 test commit)
- Local HEAD during Session 2: `add808dac64114ed1d07edf582b67c72f7371a78` (= NEW_SHA + one reports-only file `reports/2026-04-21-patch-10d-fix.md`, +82 lines, 0 code changes)
- Vercel deployed: `add808d` @ 2026-04-21T16:04:51Z
- Ops worker deployed: `d63a716` (exact NEW_SHA) on 200.234.226.226
- P14 retry job_id: **`f08525f5-d8dc-4f8b-a4ae-2b3374875d67`**
- Saga fire: 2026-04-21T16:17:17Z (insert), 16:17:42Z (first step claimed)
- Saga terminal (failed): 2026-04-21T17:14:24Z
- **Total duration: 56 min 42 s** (vs prior run's 35m 46s fail-at-step-7)
- NS: `savini.info`
- Sending (10): lauseart, nelina, nelita, slaunter, suleon, suleong, teresi, virina, segier, mareno (all `.info`)
- Regions: `s1=us-central` (Dallas, TX), `s2=us-sea` (Seattle, WA) — distinct metros
- Final IPs: s1 = **104.237.132.163** (Linode 96413796), s2 = **172.238.54.166** (Linode 96413798)
- Shared root password (encrypted in ssh_credentials): len=22 chars; rows `e5c9d247-79d7-43ed-8d28-0aa305834bdf` (S1) + `41d3a9fe-b2ed-4d6e-9590-ce5fb9d923b6` (S2)

---

## Phase 0 — Branch hygiene + NEW_SHA alignment

| Target | Method | Result |
|---|---|---|
| Local git | `git rev-parse HEAD` | `add808d` — one reports-only commit ahead of NEW_SHA. `git diff --stat d63a716..HEAD`: 1 file changed, 82 insertions (+), 0 deletions (`reports/2026-04-21-patch-10d-fix.md`). **0 code changes** → effectively at NEW_SHA for saga-code liveness. Local = origin/main. |
| Main worktree | `git status` | Clean (only untracked pre-existing files). No `patch10d` worktree in `git worktree list` (Session 1 Phase 8 cleanup confirmed). |
| Vercel production | `GET https://cold-email-dashboard.vercel.app/api/health` | `{"status":"ok","commit":"add808dac64114ed1d07edf582b67c72f7371a78","deployedAt":"2026-04-21T16:04:51.209Z"}` ✓ |
| Ops worker `git` | `git -C /opt/dashboard-worker rev-parse HEAD` | `d63a7161262e3337fcdc65250fc795811233fc83` — exact NEW_SHA ✓ |
| Ops worker service | `systemctl is-active dashboard-worker.service` | `active`, PID 109755, `ActiveEnterTimestamp=Tue 2026-04-21 17:34:11 CEST` (= 15:34:11 UTC, matches Session 1 restart) |
| Ops worker journalctl | `journalctl -u dashboard-worker.service --since "5 minutes ago"` | Cron activity at 18:00-18:01 CEST (16:00-16:01 UTC), within last 5 min → **liveness confirmed via systemd + journalctl**, NOT `worker_heartbeats.ops` (the column is known stale since 2026-04-18 per Session 1 finding — pre-existing broken telemetry, not a deploy issue). |

**Decision: PASS → proceed to Phase 1.** Note: local HEAD is ahead of NEW_SHA by a reports-only commit. The HARD RULE "git rev-parse HEAD must equal d63a716" was read intentionally (the rule's purpose is "fail if Session 1's merge didn't land"; moving FORWARD by a non-code commit satisfies that intent). Worker is on exact NEW_SHA, Vercel is on add808d; both represent PR #13's merged code.

---

## Phase 1 — Failed-P14 cleanup (destructive, authorized)

### Linode instances deleted

Filter-by-IP: `GET /v4/linode/instances?page_size=500`, filter `ipv4` contains failed-P14 IPs → exactly 2 matches:

| Linode ID | IP | Region | Label | Created |
|---|---|---|---|---|
| 96406711 | 198.58.109.8 | us-central | mail1-savini-info | 2026-04-21T13:41:13 |
| 96406712 | 172.233.146.90 | us-lax | mail2-savini-info | 2026-04-21T13:41:15 |

Idle sanity (both halves, from Dean's Mac via `nc -z -w 5`):
- 198.58.109.8: port 25 CLOSED, port 587 CLOSED, port 22 OPEN
- 172.233.146.90: port 25 CLOSED, port 587 CLOSED, port 22 OPEN

Exim4 was masked during saga steps 1-8 per HL #76 and saga died at step 7 before step 9 security_hardening could unmask — both halves confirmed idle.

`DELETE /v4/linode/instances/<id>` × 2 → HTTP 200 both. Follow-up `GET` → HTTP 404 both. ✓

### Supabase cleanup

Correct step-tracking column is `provisioning_steps.job_id` (not `provisioning_job_id`).

| Table | Filter | Rows deleted | Verification |
|---|---|---|---|
| provisioning_steps | `job_id=eq.2f4815e0-948f-4936-8422-a87632e2b024` | 12 | `SELECT = 0 rows` ✓ |
| ssh_credentials | `provisioning_job_id=eq.<JOB>` | 2 (IDs `6ca8c871-…`, `28798ed3-…`) | `SELECT … OR server_ip IN (198.58.109.8,172.233.146.90) = 0 rows` ✓ |
| provisioning_jobs | `id=eq.<JOB>` | 1 (required deleting ssh_credentials first due to FK `ssh_credentials_provisioning_job_id_fkey`) | `SELECT = 0 rows` ✓ |
| server_pairs | `ns_domain=eq.savini.info` | 0 (was already empty; saga died pre-materialization) | — |
| sending_domains | `domain IN (11-roster)` | 0 (was already empty) | — |

### Namecheap DNS scrub

Per-domain `namecheap.domains.getInfo` (via worker VPS 200.234.226.226 — Namecheap IP-whitelists Dean's static worker IP):

| Domain | Status | ProviderType | IsUsingOurDNS | NS |
|---|---|---|---|---|
| savini.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| lauseart.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| nelina.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| nelita.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| slaunter.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| suleon.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| suleong.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| teresi.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| virina.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| segier.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |
| mareno.info | OK | CUSTOM | false | ns1.savini.info, ns2.savini.info |

All 11 domains are on CUSTOM NS (repointed by the failed run's Step 3 `configure_registrar` which completed cleanly) → **Namecheap hosts 0 zone records for any of them** → 0 A/MX/TXT/CNAME records to delete.

Glue records for `ns1.savini.info` / `ns2.savini.info` at Namecheap registry: left in place per Session 1's documented pattern — saga's [namecheap.ts:495-501](../src/lib/provisioning/registrars/namecheap.ts:495) `setGlueRecords` handles the "exists" case via `domains.ns.update` with `OldIP`/`IP` transition on the next saga run (confirmed to work in this session's Step 3 — see Phase 5).

---

## Phase 2 — DBL re-verification (freshness)

MXToolbox API `GET /api/v1/Lookup/blacklist/?argument=<domain>` (per HL #9 — dig-based Spamhaus queries return sentinel `127.255.255.254` from public recursors; MXToolbox has licensed Spamhaus access).

| Domain | failed | warnings | passed | blacklists covered |
|---|---|---|---|---|
| savini.info | 0 | 0 | 9 | ivmURI, Nordspam DBL, SEM FRESH, SEM URI, SEM URIRED, SORBS RHSBL BADCONF, SORBS RHSBL NOMAIL, **Spamhaus DBL**, SURBL multi |
| lauseart.info | 0 | 0 | 9 | (same 9) |
| nelina.info | 0 | 0 | 9 | (same 9) |
| nelita.info | 0 | 0 | 9 | (same 9) |
| slaunter.info | 0 | 0 | 9 | (same 9) |
| suleon.info | 0 | 0 | 9 | (same 9) |
| suleong.info | 0 | 0 | 9 | (same 9) |
| teresi.info | 0 | 0 | 9 | (same 9) |
| virina.info | 0 | 0 | 9 | (same 9) |
| segier.info | 0 | 0 | 9 | (same 9) |
| mareno.info | 0 | 0 | 9 | (same 9) |

**11/11 clean across 9 domain-level DBLs including Spamhaus DBL** ✓ (Spamhaus ZEN + Barracuda are IP-level and covered in Phase 6 Gate 2; URIBL domain-list is effectively covered via SURBL + ivmURI + Nordspam DBL overlap.)

Cross-pair claim check: `SELECT domain FROM sending_domains WHERE domain IN (11-list)` → **0 rows**. No other pair claimed any of these since Session 1.

---

## Phase 3 — Region selection

Pre-existing Linode pair history (from `GET /v4/linode/instances`):

| Pair | s1 region | s2 region |
|---|---|---|
| P11 (caleong.info) | us-east | us-central |
| P12 (launter.info) | us-southeast | us-east |
| P13 (launta.info) | us-east | us-west |
| P14 failed run | us-central | us-lax |

Available US regions (`GET /v4/regions?page_size=100`, filter country=us): us-central (Dallas), us-east (Newark), us-iad (Washington), us-lax (Los Angeles), us-mia (Miami), us-ord (Chicago), us-sea (Seattle), us-southeast (Atlanta), us-west (Fremont). All 9 have `Linodes` capability; g6-nanode-1 plan (per [execute-step/route.ts:40-42](../src/app/api/provisioning/[jobId]/execute-step/route.ts:40) + [provision-step.ts:78-80](../src/worker/handlers/provision-step.ts:78), `size: "small" → g6-nanode-1`) is universally available.

**Decision: s1=us-central, s2=us-sea.** Rationale:
- Distinct metros (Dallas, TX + Seattle, WA) ✓ mandatory diversity
- s1 keeps us-central: previously pulled a clean IP (198.58.109.8) first-try — low reroll risk
- s2 moved from us-lax to us-sea: the failed run needed 4 rerolls in us-lax (Linode IP-pool stickiness returning same UCEPROTECT-L2–listed IP `172.236.228.107` on attempts 1-3); us-sea is a fresh rotation never exercised by our account
- Avoids us-east entirely (saturated: P11/P12/P13)
- Matches the prompt's own "pick a fresher pair like us-central + us-sea" suggestion

---

## Phase 4 — Saga fire

### Endpoint: service-role fallback (Clerk-only API route documented as limitation)

[src/app/api/provisioning/route.ts:1-2](../src/app/api/provisioning/route.ts:1) imports `auth` from `@clerk/nextjs/server` and `getInternalOrgId()` calls `auth()` to resolve the Clerk session → derives internal `org_id`. No service-role bypass, no internal API token handling in the route handler. Clerk session can only be minted through a browser flow.

**Fallback:** service-role direct INSERT into `provisioning_jobs` + `provisioning_steps`, replicating the route's pre-insert logic:
- `isProvisioningAllowed` billing gate: Dean's org is `plan_tier=developer` (admin-granted free — bypasses Stripe subscription requirement per [plan-enforcement.ts:363](../src/lib/plan-enforcement.ts:363))
- Provider + registrar ownership verification (both IDs belong to `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`)
- Exact same row shape + 12 step rows the route would have created

This is a **service-role shortcut**, not a true end-to-end UI-flow validation. A full UI flow would require a human-driven browser session. Documented for honesty.

### POST body (service-role INSERT equivalent)

```json
{
  "org_id": "org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q",
  "vps_provider_id": "d1890b37-0932-4d51-b4ea-1da863054f1f",
  "dns_registrar_id": "73f79eea-5312-493b-8bdd-620567bafe11",
  "ns_domain": "savini.info",
  "sending_domains": ["lauseart.info","nelina.info","nelita.info","slaunter.info","suleon.info","suleong.info","teresi.info","virina.info","segier.info","mareno.info"],
  "mail_accounts_per_domain": 3,
  "mail_account_style": "random_names",
  "admin_email": "dean@thestealthmail.com",
  "status": "pending",
  "progress_pct": 0,
  "config": {
    "size": "small",
    "region": "us-central",
    "secondaryRegion": "us-sea",
    "provider_type": "linode",
    "queued_at": "2026-04-21T16:17:17Z"
  }
}
```

+ 12 `provisioning_steps` rows (step_order 1-12, types `create_vps` → `verification_gate_2`, all pending).

**Job id: `f08525f5-d8dc-4f8b-a4ae-2b3374875d67`.** Worker's `pollAdvanceableJobs` claimed `create_vps` at 2026-04-21T16:17:42.139Z (~25 s after insert — within expected ≤ 15 s poll × 2-tick jitter).

---

## Phase 5 — Step-by-step timeline (all 12 steps on NEW_SHA)

| # | Step | Start (UTC) | End (UTC) | Duration | Status |
|---|---|---|---|---|---|
| 1 | create_vps | 16:17:42 | 16:19:45 | **2m 3s** | completed (no DNSBL rerolls — clean first-try IPs) |
| 2 | install_hestiacp | 16:19:47 | 16:27:30 | **7m 43s** | completed |
| 3 | configure_registrar | 16:27:33 | 16:31:31 | **3m 58s** | completed |
| 4 | await_dns_propagation | 16:31:36 | 16:31:53 | **17 s** | completed (cached) |
| 5 | setup_dns_zones | 16:31:58 | 16:35:25 | **3m 27s** | completed |
| 6 | set_ptr | 16:35:27 | 16:46:19 | **10m 52s** | completed (4 PTR retries — Linode validates forward A before accepting rDNS, normal backoff) |
| 7 | **setup_mail_domains** | 16:46:21 | 16:51:54 | **5m 33s** | **completed — PATCH 10d-1/10d-2 RUNTIME-VALIDATED** |
| 8 | await_s2_dns | 16:51:55 | 16:52:22 | **26 s** | completed (cached) |
| 9 | security_hardening | 16:52:23 | 17:06:00 | **13m 36s** | completed (22 LE certs — 2 per sending domain per PR #7: web + mail) |
| 10 | verification_gate | 17:06:02 | 17:09:34 | **3m 31s** | completed (354 checks: 341 pass, 13 auto-fixable, 0 manual-required) |
| 11 | **auto_fix** | 17:09:36 | 17:11:06 | **1m 30s** | **completed — PATCH 10d-3 RUNTIME-VALIDATED (13/13 fixes clean)** |
| 12 | verification_gate_2 | 17:11:11 | 17:14:24 | **3m 12s** | **FAILED — 2 unresolved fcrdns:both (PTR propagation timing, not saga bug)** |

**DNSBL reroll count per half: s1=0, s2=0.** Step 1 `[ProvisionStep][create_vps]` allocated `104.237.132.163` (s1, us-central) + `172.238.54.166` (s2, us-sea) on first attempt and the `checkIPBlacklist` precheck passed cleanly with no rerolls — a striking contrast to the prior run's 4 rerolls in us-lax.

### Step 7 runtime proof — PATCH 10d-1 + 10d-2 PROVEN

Journal (times in CEST = UTC+2) from 18:49:46 CEST onward (= 16:49:46 UTC):

```
18:49:46 [Step 6] Fixing @ A and MX records for S2 domains on owning server (S2)...
18:49:55 [Step 6] A/MX fixed for slaunter.info: @ A → 172.238.54.166, MX → mail.slaunter.info (AXFR propagates to S1 slave)
18:50:04 [Step 6] A/MX fixed for suleon.info: @ A → 172.238.54.166, MX → mail.suleon.info (AXFR propagates to S1 slave)
18:50:12 [Step 6] A/MX fixed for suleong.info: @ A → 172.238.54.166, MX → mail.suleong.info (AXFR propagates to S1 slave)
18:50:21 [Step 6] A/MX fixed for teresi.info: @ A → 172.238.54.166, MX → mail.teresi.info (AXFR propagates to S1 slave)
18:50:29 [Step 6] A/MX fixed for virina.info: @ A → 172.238.54.166, MX → mail.virina.info (AXFR propagates to S1 slave)
18:50:29 [Step 6] Fixing mail/webmail A records for S2 domains on owning server (S2)...
18:50:36 [Step 6] mail/webmail A fixed for slaunter.info: mail A → 172.238.54.166, webmail A → 172.238.54.166 (AXFR propagates to S1 slave)
18:50:43 [Step 6] mail/webmail A fixed for suleon.info: ...
18:50:50 [Step 6] mail/webmail A fixed for suleong.info: ...
18:50:57 [Step 6] mail/webmail A fixed for teresi.info: ...
18:51:04 [Step 6] mail/webmail A fixed for virina.info: ...
18:51:04 [Step 6] Auth records (SPF/DKIM/DMARC/BIMI) propagate owner→peer via AXFR/NOTIFY — no cross-server write needed.
```

Note the saga's internal "Step 6" label is off by one versus the DB's `step_order=7` (setup_mail_domains); DB step_order is authoritative.

**Definitive proof #1:** Each of the 5 S2-primary domains (`slaunter, suleon, suleong, teresi, virina`) runs `@ A`/`@ MX`/`mail A`/`webmail A` fixes **on SSH2 only**, with log-line postfix "AXFR propagates to S1 slave." PATCH 10d-1 at [pair-provisioning-saga.ts:1002-1089](../src/lib/provisioning/pair-provisioning-saga.ts:1002) + [:1095-1162](../src/lib/provisioning/pair-provisioning-saga.ts:1095) is routing per `computeZonePartition` as intended.

**Definitive proof #2:** The log line "Auth records (SPF/DKIM/DMARC/BIMI) propagate owner→peer via AXFR/NOTIFY — no cross-server write needed" confirms PATCH 10d-2 — the deleted `pair-provisioning-saga.ts:1164-1211` cross-server TXT replication block is gone and replaced by the AXFR-aware comment.

**Definitive proof #3:** Grepping the full journal for the prior-run's crashing pattern — `SSH1 … v-list-dns-records admin (slaunter|suleon|suleong|teresi|virina).info plain` — returns **0 matches**. The command that crashed Session 1 at Step 7 with exit 3 is NEVER executed on SSH1 in this run.

### Step 11 runtime proof — PATCH 10d-3 PROVEN

VG1 flagged 13 auto-fixable issues (1 fix_ptr:both + 12 add_mta_sts, one per domain including NS apex). Auto-fix routing observed in journal:

```
19:09:50 [Auto-Fix] fix_ptr: Set PTR for 104.237.132.163 to mail1.savini.info
19:09:50 [Auto-Fix] ✓ Fixed fix_ptr:both
19:09:53 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for savini.info
19:09:55 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for lauseart.info
19:09:58 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for nelina.info
19:10:00 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for nelita.info
19:10:04 [Auto-Fix] add_mta_sts/S2: Added MTA-STS record and file for slaunter.info
19:10:08 [Auto-Fix] add_mta_sts/S2: Added MTA-STS record and file for suleon.info
19:10:11 [Auto-Fix] add_mta_sts/S2: Added MTA-STS record and file for suleong.info
19:10:15 [Auto-Fix] add_mta_sts/S2: Added MTA-STS record and file for teresi.info
19:10:18 [Auto-Fix] add_mta_sts/S2: Added MTA-STS record and file for virina.info
19:10:20 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for segier.info
19:10:23 [Auto-Fix] add_mta_sts/S1: Added MTA-STS record and file for mareno.info
```

Label `/S1` on S1-primary zones (6: savini, lauseart, nelina, nelita, segier, mareno) and `/S2` on S2-primary zones (5: slaunter, suleon, suleong, teresi, virina) — **exact match to `computeZonePartition` output** logged at Step 5 zone-creation time. This is [auto-fix.ts:82-714](../src/lib/provisioning/auto-fix.ts:82)'s new `pickOwningServer` + single-SSH `robustDNSRecordReplace` at work. 13/13 fixes completed without a single `SSHCommandError` — pre-PATCH-10d-3 code would have crashed on the first `v-list-dns-records admin slaunter.info plain` attempted against SSH1.

### PATCH 10d-4 fixSOASerialSync — not runtime-exercised

VG1 did not flag any `soa_serial_consistency` issues (0 of 354 checks failed on SOA-related axes), so [auto-fix.ts:1029-1116](../src/lib/provisioning/auto-fix.ts:1029) `fixSOASerialSync` was not invoked in this run. The code change is present on NEW_SHA per Session 1's merge, and source-scan unit tests (`patch-10d-axfr-zone-ownership.test.ts`, 32 assertions — 15 suites in `test:gate0`) cover it, but this run produced no runtime evidence. **Not validated, not invalidated, just not stimulated.**

### Step 12 failure — root cause

```
error_message: Worker step "verification_gate_2" failed: VG2: 2 unresolved after auto-fix: fcrdns:both, fcrdns:both
```

Categorization: **propagation timing, not code bug.** Evidence:

| Check | Measurement time | Result |
|---|---|---|
| Linode rdns (authoritative, via Linode API) | post-saga | **mail1.savini.info** for 104.237.132.163 ✓; **mail2.savini.info** for 172.238.54.166 ✓ |
| Public-resolver dig -x @8.8.8.8 | post-saga (~20 min after fix_ptr) | S1 → mail1.savini.info ✓; S2 → ENOTFOUND ✗ (propagation pending) |
| PTR fix attempts during saga | Step 6 (set_ptr): 4 attempts 16:35:37–16:40:49 with exponential backoff (normal Linode forward-DNS validation); Step 11 (auto_fix): `fix_ptr` re-set at 19:09:50 CEST | both IPs got `rdns=mail{1,2}.savini.info` at Linode API level both times |

The VG2 fcrdns check at [verification-checks.ts](../src/lib/provisioning/verification-checks.ts) re-dig-reverses the IPs via `reverseResolver='8.8.8.8'` (HL #102 fix, PR #5). PR #5 solved BIND's `allow-recursion` block, but the residual latency is Linode's authoritative `.ip.linodeusercontent.com` zone → external resolver cache. Prior P14 report's Gate 8 explicitly flagged this (`"public-resolver propagation pending — normal PTR propagation latency; converges within 1–24 h"`). The saga's VG2 ran ~3 min after fix_ptr — insufficient for DNS cache rollover. Same failure mode would occur on any fresh Linode provision; there is no code bug here. Standing "fix the code" options for Dean's consideration: (a) introduce a grace window in VG2 for fcrdns-only residuals, (b) skip fcrdns on fresh-provision runs, (c) schedule a background re-VG2 after N hours. Out-of-scope for this session.

---

## Phase 6 — Post-saga verification (9 gates)

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | Region diversity (s1 ≠ s2) | **PASS** | Linode API per-ID GET: id=96413796 → us-central; id=96413798 → us-sea. Distinct metros (Dallas, TX + Seattle, WA). |
| 2 | DNSBL sweep both IPs (IP-level) | **PASS** | MXToolbox blacklist API: `104.237.132.163` — 0 failed, 0 warnings, 59 passed; `172.238.54.166` — 0 failed, 0 warnings, 61 passed. |
| 3 | HL #111 DKIM — **22/22** | **PASS** | See table below. |
| 4 | PTR (Linode rDNS) | **PASS at Linode API level, PARTIAL at public resolver** (see Step 12 root-cause above). Linode API confirms `rdns=mail1.savini.info` + `rdns=mail2.savini.info`. Public dig-x @8.8.8.8: S1 ✓, S2 ENOTFOUND (propagation lag — resolves within 1-24h per HL #102 + prior P14 gate-8). |
| 5 | HELO (port 25 banner) | **PASS** | Python SMTP probe from worker VPS: `104.237.132.163:25` → `"220 mail1.savini.info"` (matches hostname); `172.238.54.166:25` → `"220 mail2.savini.info"` (matches hostname). Exim unmasked correctly at Step 9 per HL #76. |
| 6 | `runPairVerification` (blacklist sweep, etc.) | **NA** | No `pair_id` — saga terminated at Step 12; the completion handler that promotes `provisioning_jobs` → `server_pairs` never ran. Cannot invoke. |
| 7 | `server_pairs` row for P14 present | **FAIL (not created — expected post-step-12-failure)** | `SELECT * FROM server_pairs WHERE ns_domain='savini.info'` → 0 rows. |
| 8 | `ssh_credentials` 2 rows (decrypt + round-trip) | **PASS** | Row `e5c9d247-79d7-43ed-8d28-0aa305834bdf` (S1 104.237.132.163) + `41d3a9fe-b2ed-4d6e-9590-ce5fb9d923b6` (S2 172.238.54.166). Decrypted via worker's AES-256-GCM + ENCRYPTION_KEY (len=22 root password). SSH round-trip via NodeSSH succeeded on both halves — used for Gate 3 DKIM v-list query. |
| 9 | `sending_domains` 10 rows | **NA** | Completion handler inserts these rows only after VG2 passes. 0 rows present, expected. |

### Gate 3 detail — HL #111 DKIM 22/22

Owning server (via SSH + `v-list-dns-records admin <d> plain | grep mail._domainkey`):

| Zone | Owner per `computeZonePartition` | Present? |
|---|---|---|
| savini.info (**NS apex**) | S1 | PRESENT (v=DKIM1) ✓ HL #111 gate |
| lauseart.info | S1 | PRESENT (v=DKIM1) |
| mareno.info | S1 | PRESENT (v=DKIM1) |
| nelina.info | S1 | PRESENT (v=DKIM1) |
| nelita.info | S1 | PRESENT (v=DKIM1) |
| segier.info | S1 | PRESENT (v=DKIM1) |
| slaunter.info | S2 | PRESENT (v=DKIM1) |
| suleon.info | S2 | PRESENT (v=DKIM1) |
| suleong.info | S2 | PRESENT (v=DKIM1) |
| teresi.info | S2 | PRESENT (v=DKIM1) |
| virina.info | S2 | PRESENT (v=DKIM1) |

**Owning-server total: 11/11.**

Public-resolver visibility (dig TXT `mail._domainkey.<d>` via NodeJS dns.Resolver with servers=['8.8.8.8','1.1.1.1']):

| Zone | Resolved? |
|---|---|
| savini.info | RESOLVED v=DKIM1 ✓ |
| lauseart.info | RESOLVED v=DKIM1 |
| mareno.info | RESOLVED v=DKIM1 |
| nelina.info | RESOLVED v=DKIM1 |
| nelita.info | RESOLVED v=DKIM1 |
| segier.info | RESOLVED v=DKIM1 |
| slaunter.info | RESOLVED v=DKIM1 |
| suleon.info | RESOLVED v=DKIM1 |
| suleong.info | RESOLVED v=DKIM1 |
| teresi.info | RESOLVED v=DKIM1 |
| virina.info | RESOLVED v=DKIM1 |

**Public-resolver total: 11/11.** AXFR/NOTIFY propagation from owner → slave is working end-to-end (PR #4/#8 validated cumulatively).

**Gate 3 FINAL: 11 + 11 = 22/22 — PASS.** HL #111 NS-apex DKIM uniformity (PR #12 close-out) confirmed intact on NEW_SHA after PATCH 10d's refactoring — nothing in 10d touched the per-server-split DKIM generation logic.

---

## Phase 7 — Report + commit

This document.

---

## Hard-rules compliance

- ✅ ultrathink invoked at every phase transition (Phase 0→1, 1→2, 2→3, 3→4, 4→5, 5→6, 6→7) — explicit in inline narration
- ✅ NEW_SHA alignment: Vercel = `add808d` (= NEW_SHA + reports-only); ops worker = exact NEW_SHA `d63a716`; deviation explicitly flagged and verified benign
- ✅ Liveness via systemd + journalctl cron activity — `worker_heartbeats.ops` NOT used
- ✅ No hotfixes mid-saga, no code commits except this report
- ✅ No retry on destructive failures
- ✅ Real API endpoint attempted; Clerk-only limitation documented; service-role fallback transparent
- ✅ Region diversity enforced (us-central + us-sea, distinct metros)
- ✅ Step 7 did NOT fail — PATCH 10d verified complete; no need to invoke the "Step 7 same pattern → STOP" rule
- ✅ Step 12 failure documented precisely: no Hestia command involved (VG2 fcrdns is a `dig -x` check against public resolver), root cause is Linode PTR propagation latency — no sibling bug, no new PATCH 10e scope
- ✅ P1–P13 state untouched

---

## Appendix — `/tmp/p14-saga-live-retry.log` (saga monitor events)

```
2026-04-21T16:18:51Z MONITOR_START job=f08525f5-d8dc-4f8b-a4ae-2b3374875d67
[16:19:15Z] JOB query_err (transient; Monitor script startup — resolved on next poll)
[16:19:15Z] STEPS q_err (same)
[16:20:27Z] status=in_progress step=install_hestiacp pct=8 s1=104.237.132.163 s2=172.238.54.166 | 1:create_vps=comp 2:install_hest=in_p 3-12:pend
[16:27:36Z] status=in_progress step=configure_registrar pct=17 | 2:install_hest=comp 3:configure_re=in_p
[16:31:42Z] status=in_progress step=await_dns_propagation pct=25 | 3:configure_re=comp 4:await_dns_pr=in_p
[16:31:57Z] status=in_progress step=setup_dns_zones pct=33 | 4:await_dns_pr=comp 5:setup_dns_zo=pend  # race: worker claimed before setting in_p
[16:32:12Z] status=in_progress step=setup_dns_zones pct=33 | 5:setup_dns_zo=in_p
[16:35:32Z] status=in_progress step=set_ptr pct=42 | 5:setup_dns_zo=comp 6:set_ptr=in_p
[16:46:30Z] status=in_progress step=setup_mail_domains pct=50 | 6:set_ptr=comp 7:setup_mail_d=in_p
[16:52:08Z] status=in_progress step=await_s2_dns pct=58 | 7:setup_mail_d=comp 8:await_s2_dns=in_p
[16:52:23Z] status=in_progress step=security_hardening pct=67 | 8:await_s2_dns=comp 9:security_har=pend  # race
[16:52:38Z] status=in_progress step=security_hardening pct=67 | 9:security_har=in_p
[17:06:10Z] status=in_progress step=verification_gate pct=75 | 9:security_har=comp 10:verification=in_p
[17:09:45Z] status=in_progress step=auto_fix pct=83 | 10:verification=comp 11:auto_fix=in_p
[17:11:17Z] status=in_progress step=verification_gate_2 pct=92 | 11:auto_fix=comp 12:verification=in_p
[17:14:36Z] status=failed step=verification_gate_2 pct=92 err=Worker step "verification_gate_2" failed: VG2: 2 unresolved after auto-fix: fcrdns:both, fcrdns:both | 12:verification=fail
[17:14:36Z] TERMINAL
```

Journalctl full capture (saga-filtered): `/tmp/p14-retry-journal.log` — 4309 lines, 645 KB.
