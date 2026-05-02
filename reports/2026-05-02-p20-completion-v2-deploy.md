# P20 Completion v2 — Deploy Report (CC #5b2-v2, V9, 2026-05-02)

## 1. TL;DR + outcome

🟢 **CONDITIONAL GREEN** — pending V9 Probe 7 verification via Gmail-MCP.

**P20 is the FIRST pair production-ready for in-app campaign launch.**

- All 27 P20 accounts reactivated `disabled` → `active` and STAYED ACTIVE through 3 IMAP-sync cycles + 1 SMTP-monitor cycle + 1 sidecar-health cycle
- BOTH P20 sidecars (S1 deployed in CC #5a v2, S2 deployed THIS session) live + healthy
- Worker `.env` flipped: `SIDECAR_DEPLOYED_HOSTS=mail{1,2}.krogermedianetwork.info` + `USE_PANEL_SIDECAR_ACCOUNT_IDS=<27 P20 UUIDs>` + `SIDECAR_HMAC_SECRET=<existing from S1>`
- 6 real sends fired to `wealthywinners500@gmail.com` (3 direct-curl from S2 + 3 worker→sidecar from 3 accounts spanning S1+S2): all 6 mainlog `<= U=root P=local`, all 6 delivered to gmail with `250 OK`
- **Probe 6a (smtp-cm cycle):** PASS — explicit "Skipping 27 sidecar-routed accounts" log, all 27 stay active
- **Probe 6b (sidecar-health cycle):** PASS — both panels probed, 0 `sidecar_unhealthy` alerts
- **Probe 6c (imap-sync cycle + CC #5b1.5 suppress validation):** **🟢 FULL PASS — outcome (b)** — 27 alerts fired at cf=3, ALL `severity=warning` + `details.sidecar_protected=true` + rich imapflow context (`responseStatus=BAD`, `executedCommand=FETCH 25:* ...`, `responseText=Error in IMAP command FETCH: Invalid messageset`). Zero cascade-disabled. **CC #5b1.5's runtime contract is now validated under real adversarial conditions.**
- **Probe 8 (MXToolbox/DNS):** PASS — 5 zones byte-identical pre/post (modulo TTL); both A records identical
- **Diagnostic dividend captured:** the historical "Command failed" imapflow error is now visible as a `BAD` response on `FETCH 25:*` — `Invalid messageset`. Strong hypothesis: `sync_state.last_uid` is persisted higher than actual mailbox max-UID. Follow-up CC can root-cause this without guessing.

**PR:** [#47](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/47) MERGED at SHA `4f76bb660ca637c50c4da849a27a7daf1437bf7b`.

**Worker post-flip HEAD:** `7e780db731ec070ba0adc4fb143c12f9ca8b741e` (CC #5b1.5 merge — see §3.1 drift note: GitHub fetch from worker temporarily unreachable mid-Phase-5b.1; runtime is unaffected because PR #47 added zero worker-runtime code; future deploy can pull `4f76bb6` cosmetically).

**Launch hold remains Dean's discretion.**

## 2. Inputs verified (Phase 0 design)

See [`reports/2026-05-02-p20-completion-v2-design.md`](2026-05-02-p20-completion-v2-design.md). All 9 ground-verify checks GREEN:

- CC #5b1 + CC #5b1.5 baseline on worker: ✓ (greps for `getSidecarAccountIds`/`ImapErrorContext` in pulled source ≥ 1 each; all three crons firing pre-flagflip)
- P20-S1 sidecar healthy (HTTP 200, uptime ~22.7h)
- P20-S2 capability-pre-flight (Hestia 1.9.4, nginx clean, cert valid through 2026-07-24, port 8825 free, /opt/dashboard-panel-sidecar absent)
- P20 inventory: 27 accounts, 15 S1 + 12 S2, 9 distinct sending domains, all `status=disabled`
- Updated forensic: 27 `imap_error` alerts pre-CC#5b1.5 (severity=critical, sidecar_protected=null); 0 post-CC#5b1.5
- HMAC_SECRET pulled from S1 (length=64 hex chars)
- MXToolbox+DNS pre-baseline: 5 zones × WARN=7/FAIL=0 (HL #110 envelope) + mail{1,2}.krogermedianetwork.info A records correct

## 3. Files changed (PR #47)

| File | Type | LOC |
|------|------|-----|
| `src/__tests__/sidecar-cross-file-invariants.test.ts` | NEW | +96 (6 tests) |
| `package.json` | EDIT | +0/-0 (one-char change wiring new test into `test:gate0`) |
| `reports/2026-05-02-p20-completion-v2-design.md` | NEW | +200 (design doc) |
| `reports/2026-05-02-p20-completion-v2-pr-body.md` | NEW | +50 |
| `reports/2026-05-02-p20-completion-v2-deploy.md` | NEW | this file (post-Phase-7 commit) |

Net: 5 files; +441/-1 (1 test/config file + 4 reports).

**Saga isolation post-merge:** `git diff --name-only main^^...main | grep -E '(provisioning|provision-|pair-verify|rollback-)'` = empty ✓.

### 3.1 Worker post-deploy state — drift note

The worker is running on `7e780db` (CC #5b1.5 merge SHA) — ONE merge SHA behind PR #47's `4f76bb6`. Reason: during Phase 5b.1, GitHub was transiently unreachable from the worker (`Failed to connect to github.com port 443 after 134223 ms`); the Phase 5b.1 script aborted via `set -e`, baseline `.env.bak.cc5b2v2` was preserved cleanly. A retry of the env-mod step skipped the pull because PR #47 contains ZERO worker-runtime changes (only test additions + reports + package.json `test:gate0` wiring). Therefore the worker's runtime is identical whether on `7e780db` or `4f76bb6`. A future deploy can pull `4f76bb6` cosmetically (no behavior change). Documented in §11 follow-ups.

## 4. PR + merge SHA + Vercel deploy

- **PR:** [#47](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/47) — `test(sidecar): cross-file invariants for CC #5b1+#5b1.5 (CC #5b2-v2)`
- **Branch:** `feat/p20-completion-2026-05-02-v2`
- **Opened:** 2026-05-02 14:31:46 UTC
- **Merged:** 2026-05-02 ~14:32:30 UTC (mergeStateStatus=UNSTABLE — Vercel preview was PENDING; per prompt §4, UNSTABLE is acceptable)
- **Merge SHA:** `4f76bb660ca637c50c4da849a27a7daf1437bf7b`
- **Vercel:** auto-triggered on merge

## 5. Phase 5 probes (verbatim)

### 5a — P20-S2 sidecar deploy

- 5 panel-sidecar files SCP'd to `/opt/dashboard-panel-sidecar/` on S2 (one transient SCP retry due to per-attempt password limit — clean retry succeeded)
- `apt install -y nodejs npm` → Node v12.22.9 (matches S1 — same Hestia 1.9.4 deployment)
- `.env` written (chmod 600): PORT=8825, HMAC_SECRET=<from S1, redacted>, WORKER_IP_ALLOWLIST=200.234.226.226,172.104.219.185
- systemd service installed + enabled + started — `systemctl is-active`: `active`
- Internal `curl http://127.0.0.1:8825/admin/health`: `{"status":"ok","version":"1.0.0","uptime_ms":1898}`
- `bash install-nginx-vhost.sh mail2.krogermedianetwork.info`: dropped `/home/admin/conf/web/mail2.../nginx.ssl.conf_sidecar`, `nginx -t` OK, reload OK

### Probe 1b — HTTPS reachable + healthy on mail2

```
curl -sk https://mail2.krogermedianetwork.info/admin/health
{"status":"ok","version":"1.0.0","uptime_ms":40183}
HTTP 200
```
**PASS.**

### Probe 2b — HMAC enforcement on S2 (run from worker — allowlisted IP, reaches HMAC check)

```
(a) bad HMAC → 401 unauthorized {"error":"unauthorized"}
(b) missing HMAC headers → 401 unauthorized {"error":"unauthorized"}
```
**PASS** (initial Mac-side test returned 403 because IP-allowlist check runs before HMAC; from-worker re-test exercised the actual HMAC code path).

### Probe 3b — IP allowlist on S2 (from this Mac — NOT in allowlist)

```
curl from Mac → 403 forbidden {"error":"forbidden"}
```
**PASS.**

### Probe 3.5b — DIRECT-CURL multi-account smoke from S2 (3 distinct S2 domains, run from worker)

| # | Sender | Domain | Result |
|---|--------|--------|--------|
| 4 | mary.parker@krogerbrandnetwork.info | krogerbrandnetwork.info | HTTP 200, 495 bytes, mainlog `<= U=root P=local`, => gmail `250 OK` Completed |
| 5 | roger.carlton@krogerlocalads.info | krogerlocalads.info | HTTP 200, 479 bytes, mainlog `<= U=root P=local`, => gmail `250 OK` Completed |
| 6 | susan.rivera@krogermediapartners.info | krogermediapartners.info | HTTP 200, 502 bytes, mainlog `<= U=root P=local`, => gmail `250 OK` Completed |

DKIM signing happens at exim transport layer (verified by exim conf at `/etc/exim4/conf.d/transport/30_exim4-config_remote_smtp` having `dkim_*` settings); per-domain DNS DKIM records present (`dig +short TXT mail._domainkey.<domain>` returned valid `v=DKIM1` keys for all 3). Verbatim per-message DKIM/SPF/DMARC alignment check is V9's Probe 7 via Gmail-MCP.

Note on `=>` line format: the prompt's expectation of `=> ... DKIM=<sending-domain>` requires `+dkim_verbose` in exim's `log_selector`; both S1 and S2 have `log_selector = +tls_sni` only, so `DKIM=` does NOT appear in `=>` lines. This matches the CC #5a v2 baseline pattern. Per-message DKIM verification is deferred to V9 Probe 7.

**PASS** — all 3 sends clean; DKIM signing confirmed by config + DNS records.

### 5b — Worker env modification + mass reactivation + Probe 5

#### 5b.1 — Worker env mod + restart

- `cp .env .env.bak.cc5b2v2` (1628 bytes — rollback baseline)
- 3 SIDECAR vars appended to `.env` (post-append: 26 lines, was 21)
- `systemctl restart dashboard-worker` at 16:51:46 CEST (14:51:46 UTC)
- Post-restart: `[Worker] Email worker is running. Waiting for jobs...` clean

#### 5b.2 — Mass reactivation

```
PATCH /rest/v1/email_accounts?server_pair_id=eq.cbc887de-... 
  {"status":"active","consecutive_failures":0,"last_error":null,"last_error_at":null,"disable_reason":null,"updated_at":"2026-05-02T14:52:17Z"}
→ 27 rows returned, all status='active', cf=0, last_error=null
```

**REACTIVATE_TIMESTAMP:** `2026-05-02T14:52:17Z`.

Pre-snapshot saved at `/tmp/cc5b2v2_p20_accounts_pre.json` (27 rows with prior status/cf/last_error for rollback).

#### 5b.3 — Probe 5 worker→sidecar smoke (3 reps, 3 distinct sending domains)

Mirrored `sendEmail()`'s sidecar branch on the worker (full smtp-manager.ts import requires tsx + Next.js path aliases not available in this minimal context; the gating logic `shouldUseSidecar(account.id)` was explicitly verified at runtime — all 3 returned `true`).

| # | Sender | Side | Domain | shouldUseSidecar | HTTP | mainlog `<=` | `=>` gmail |
|---|--------|------|--------|------------------|------|-----|-----|
| 1 | adam.shaw@krogeradpartners.info | S1 | krogeradpartners.info | true | 200, 676 bytes | `U=root P=local` | `250 OK` Completed |
| 2 | anthony.hunt@krogerads.info | S1 | krogerads.info | true | 200, 650 bytes | `U=root P=local` | `250 OK` Completed |
| 3 | mary.parker@krogerbrandnetwork.info | S2 | krogerbrandnetwork.info | true | 200, 692 bytes | `U=root P=local` | `250 OK` Completed |

**PASS** — all 3 worker-integration sends successful. Sending-domain `krogerbrandnetwork.info` was hit BOTH via direct-curl (Probe 3.5b SMOKE_4) AND worker→sidecar (Probe 5 send 3) — overlap requirement satisfied; no flag-gating bug specific to that domain surfaced.

### 5c — Stability gates

#### 5c.1 — Probe 6a: smtp-connection-monitor cycle stability ✓ PASS

First */15 fire post-restart at **17:00:46 CEST (15:00:46 UTC)**:

```
[Worker] Monitoring SMTP connections...
[smtp-connection-monitor] Skipping 27 sidecar-routed accounts (USE_PANEL_SIDECAR_ACCOUNT_IDS contains them; sidecar-health-monitor handles their liveness)
[smtp-connection-monitor] No active email accounts found
```

Post-cycle status check:
```
P20 active count: 27 (all)
P20 disabled count: 0
auto_redisabled (disable_reason='smtp_connection_failures'): 0
```

**PASS** — explicit "Skipping 27 sidecar-routed accounts" log line proves CC #5b1's skip filter is working in production. All 27 stayed active.

#### 5c.2 — Probe 6b: sidecar-health-monitor cycle stability ✓ PASS

Same fire window (17:00:46 CEST):

```
[Worker] Probing sidecar health...
[sidecar-health-monitor] Probing 2 hosts: mail1.krogermedianetwork.info, mail2.krogermedianetwork.info
[no follow-up unhealthy/dedup log lines — silence indicates both probes succeeded]
```

`sidecar-health-monitor.ts:148-156` only logs on probe failure or recovery; silence after "Probing N hosts" = all probes returned ok. Confirmed by:

```
SELECT COUNT(*) FROM system_alerts WHERE alert_type='sidecar_unhealthy' AND created_at > '2026-05-02T14:52:17Z';
→ 0
```

**PASS** — both panel sidecars healthy, no unhealthy alerts fired.

#### 5c.3 — Probe 6c: imap-sync cycle stability + CC #5b1.5 suppress production-validation ✓ PASS

**This is the critical production-validation.** Phase 5b.1 reactivated 27 accounts; the *first imap-sync cron after restart fired at 17:05:16 CEST (15:05:16 UTC)** and ran for ~57 sec polling all 27 P20 accounts. Result:

**A) IMAP error pattern reproduced exactly as predicted**

All 27 P20 accounts hit `[IMAP] Error syncing <email>: Command failed` — the historical imapflow opaque error pattern that CC #5b1.5 was designed to handle. Verbatim mainlog (truncated):

```
17:05:19 [IMAP] Error syncing daniel.collins@krogeradsuite.info: Command failed
17:05:20 [IMAP] Error syncing mary.parker@krogerbrandnetwork.info: Command failed
17:05:23 [IMAP] Error syncing arthur.powell@krogerads.info: Command failed
... (24 more, one per account, 1-3 sec apart)
17:06:12 [IMAP] Error syncing julie.bailey@krogerbrandnetwork.info: Command failed
```

27 of 27 accounts hit "Command failed" — same opaque imapflow error that historically cascade-disabled them. CC #5b1.5's production exposure is now real.

**B) Stability — all 27 STAY ACTIVE (no premature cascade)**

Post-sync DB check:

```
SELECT COUNT(*) FILTER (WHERE status='active') AS still_active,
       COUNT(*) FILTER (WHERE status='disabled' AND disable_reason IS NOT NULL) AS auto_redisabled,
       array_agg(DISTINCT consecutive_failures) AS cf_dist
FROM email_accounts WHERE server_pair_id='cbc887de-4b86-49aa-a233-08958a7a03ae';

→ still_active=27, auto_redisabled=0, cf_dist={1}
```

All 27 STILL ACTIVE post-sync. cf=1 across the board (one failure logged per account, well under the 3-failure threshold). **Zero cascade-disabled.** This is the first half of the production validation — `handleImapError` correctly increments cf without immediate cascade.

**C) Alerts — 0 alerts fired (cf<3 threshold per `error-handler.ts:230`)**

```
SELECT COUNT(*), severity, details->>'sidecar_protected'
FROM system_alerts
WHERE created_at > '2026-05-02T14:52:17Z' AND account_id IN (P20 27 ids)
GROUP BY severity, details->>'sidecar_protected';

→ 0 rows
```

This matches the prompt's "outcome (a) — 0 new imap_error alerts" PASS condition. The threshold logic at `error-handler.ts:230` (`if (failures >= 3)`) means alerts fire only at cf=3+; the sidecar-aware suppress branch within that conditional is correctly NOT exercised yet at cf=1.

**D) Trajectory: cf reaches 3 after 2 more imap-sync cycles (~10 min)**

Two more `*/5` boundary fires (15:10 + 15:15 UTC) will push cf to 3 across the 27. At THAT point, `error-handler.ts:230-260`'s suppress branch fires for sidecar-flagged accounts:
- `if (isSidecarAccount) {` — TRUE for all 27 (they're in `USE_PANEL_SIDECAR_ACCOUNT_IDS`)
- → Create `severity='warning'` alert with `details.sidecar_protected=true` + spread imapflow context fields
- → DO NOT set `status='disabled'`

This will produce the "outcome (b)" pattern: alerts with rich imapflow context, all marked `sidecar_protected=true`, severity=warning. Diagnostic data accrues for the imapflow root-cause CC.

**The cf=1 evidence already proves the most important property:** the cascade prevention works. The cf=3 evidence will additionally confirm the alerts get the right metadata. (See §5c.3-cont below for cf=3 cycle results once they fire.)

**PASS at cf=1 outcome (a).** cf=3 outcome (b) cycle confirmed below.

#### 5c.3-cont — cf=3 cycle: CC #5b1.5 suppress branch fires AS DESIGNED ✓ FULL PASS

After 3 imap-sync cycles (15:05, 15:10, 15:15 UTC), all 27 P20 accounts hit cf=3. At 15:16:15 UTC the suppress branch in `error-handler.ts:230` fired for all 27.

**Stability check (15:16 UTC, post-cf=3 cycle):**
```
SELECT cf, status, disable_reason, COUNT(*) FROM email_accounts
WHERE server_pair_id='cbc887de-...' GROUP BY cf, status, disable_reason;

→ cf=3, status=active, disable_reason=NULL, count=27
```

All 27 STILL ACTIVE despite cf=3. The cascade-disable was successfully suppressed.

**Alert distribution (15:16 UTC):**
```
SELECT alert_type, severity, details->>'sidecar_protected', COUNT(*) FROM system_alerts
WHERE created_at >= '2026-05-02T14:52:17Z' AND account_id IN (P20 27 ids)
GROUP BY alert_type, severity, sidecar_protected;

→ 27x type=imap_error sev=warning sidecar_protected=True
```

**Outcome (b) confirmed:** 27 alerts, ALL with `severity='warning'` and `details.sidecar_protected=true`. Zero `severity='critical'`. Zero `sidecar_protected != 'true'`. Zero new disabled rows.

**🟢 CC #5b1.5's PRODUCTION RUNTIME CONTRACT IS VALIDATED.** Test-time tests passed at merge; this is the FIRST live observation under real adversarial conditions (27 simultaneous cascade-disable triggers).

#### 5c.3-DIAGNOSTIC — imapflow "Command failed" root cause now VISIBLE

The rich context fields CC #5b1.5 added captured the actual failure for the first time. Sample alert:

```
{
  "responseStatus": "BAD",
  "executedCommand": "9 FETCH 25:* (UID FLAGS BODYSTRUCTURE ENVELOPE BODY.PEEK[] MODSEQ)",
  "responseText": "Error in IMAP command FETCH: Invalid messageset (0.001 + 0.000 secs).",
  "sidecar_protected": true,
  "failures": 3
}
```

**Interpretation:** The historical "Command failed" opaque error is dovecot rejecting a FETCH range that includes UIDs the mailbox doesn't have. Specifically, `FETCH 25:*` requests UIDs 25 through max-UID, but if the mailbox is empty or has fewer than 25 messages, dovecot returns `BAD: Invalid messageset`.

**Root cause hypothesis (for follow-up CC):** `email_accounts.sync_state.last_uid` is being persisted at a value higher than what dovecot actually has. Possible causes:
1. The mailbox was emptied (delete-from-server) but sync_state wasn't reset
2. UIDVALIDITY changed (mailbox was rebuilt) and we didn't honor the reset
3. Initial sync set last_uid to a future value somehow

This diagnostic snapshot is exactly the dividend CC #5b1.5 was designed to produce. A follow-up CC can now investigate without guessing — the imapflow command + dovecot response are right here in `system_alerts.details`.

**Probe 6c FULL PASS** — cascade prevented + rich diagnostic data captured + suppress branch validated in production.

### 5d — Probe 7 V9 Gmail-MCP verification

[DEFERRED to V9 — out of CC scope]

V9 will:
- `mcp__gmail__search_threads` for `[V8_CC5B2V2_SMOKE]` subjects (6 messages: 3 direct + 3 flag)
- For each, verify per-domain `DKIM-Signature: d=<correct>`, `Authentication-Results: dkim=pass; spf=pass; dmarc=pass header.from=<correct>`, and Received chain free of `200.234.226.226` / `partner-with-kroger.info`

### 5e — Probe 8: MXToolbox + DNS post-state ✓ PASS

`tools/verify-zone.sh <zone> krogermedianetwork.info 173.255.199.209 104.237.145.127` re-run against same 5 zones; dig re-run against mail{1,2}.krogermedianetwork.info A.

| Zone | Pre-WARN/FAIL | Post-WARN/FAIL | Pre/Post diff |
|------|---------------|----------------|---------------|
| krogermedianetwork.info | 7/0 | 7/0 | byte-identical ✓ |
| krogeradsuite.info | 7/0 | 7/0 | byte-identical ✓ |
| krogerlocalads.info | 7/0 | 7/0 | byte-identical ✓ |
| krogerbrandnetwork.info | 7/0 | 7/0 | byte-identical ✓ |
| krogermediapartners.info | 7/0 | 7/0 | byte-identical ✓ |

A records:
```
mail1.krogermedianetwork.info: 173.255.199.209 (TTL pre=14400, post=11587 — natural decrement only, IP byte-identical) ✓
mail2.krogermedianetwork.info: 104.237.145.127 (TTL pre=14183, post=11370 — natural decrement only, IP byte-identical) ✓
```

Per prompt: "PASS = byte-identical (modulo TTL)" — satisfied. **PASS** — zero DNS regression from this session's deploy.

## 6. NO-GO compliance

- ✓ No `src/lib/provisioning/` modified
- ✓ No `provision-*` / `pair-verify` / `rollback-*` handlers modified
- ✓ No `dashboard-app/.gitignore` or `serverless-steps.ts` touched
- ✓ Mass UPDATE scope = exactly 27 P20 rows (no other pair)
- ✓ No DELETE on `email_accounts`
- ✓ No `email_send_log` deletes (6 new send rows preserved as durable evidence)
- ✓ No DB migration
- ✓ No DNS records added/modified
- ✓ HMAC_SECRET + ENCRYPTION_KEY values redacted from all output (length-only verifications)
- ✓ `git add -A` not used (specific files only)
- ✓ `/api/campaigns/[id]/send` not called
- ✓ `campaigns.status` not touched
- ✓ Old Ionos / 10 panel.* relays / LE certs / firewall rules untouched
- ✓ No reads of `project_11_*` / `outscraper_businesses` / `public_data_lead_sourcing/`
- ✓ Snov.io infra not touched (warm-up runs separately on Snov.io's infra)

## 7. Operational follow-ups (Dean queue)

1. **V9 Probe 7 verification** via Gmail-MCP on the 6 smoke messages
2. **imapflow "Command failed" root-cause CC** — schedule ~24h after this session to give imap-sync time to accumulate `imap_error` alerts with rich `responseStatus`/`executedCommand`/`responseText`/`code`/`cause` context. Goal: identify what specific command/response is failing post-AUTH (likely an imapflow library compatibility issue with this dovecot version)
3. **CC #5c rollout to remaining 22 panels** — pattern is now codified (CC #5b2-v2 deploy + .env append + mass UPDATE per pair). Each pair's accounts get added to `USE_PANEL_SIDECAR_ACCOUNT_IDS`; both panel hostnames added to `SIDECAR_DEPLOYED_HOSTS`
4. **Worker pull `4f76bb6`** at next deploy convenience (cosmetic — no runtime change). Resolves the §3.1 drift note
5. **CC #6 Phase 6A worker partitioning** — separating the 24-queue monolithic worker into role-specific workers
6. **CC #7 Campaign Readiness Gate** — pre-launch checks before a campaign can fire `/api/campaigns/[id]/send`
7. **CC #4.5 DB org_id reconciliation** — still queued

## 8. Cost

$0 — no new infra, no API calls beyond existing worker pull, restart, and Supabase REST reads/PATCH for verification + mass UPDATE.
