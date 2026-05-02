# P20 Completion v2 — Phase 0 Design (CC #5b2-v2, V9, 2026-05-02)

## TL;DR

Phase 0 GREEN. All 9 ground-verify checks pass. No HALT triggers fired.
Cleared to proceed to Phase 1 (test additions) → Phase 4 (PR/auto-merge) →
Phase 5 (operational deploy: P20-S2 sidecar + worker env modification +
mass reactivation of all 27 P20 accounts + 6-message smoke + 3 stability
gates).

## 1. CC #5b1 + CC #5b1.5 baseline state (Phase 0.1)

- **Worker HEAD:** `7e780db731ec070ba0adc4fb143c12f9ca8b741e` (CC #5b1.5
  merge SHA, equivalent to or newer than required `7e780db`+) ✓
- **Worker `systemctl is-active`:** `active` ✓
- **Runtime contract greps in pulled source:**
  - `getSidecarAccountIds` in `src/lib/email/error-handler.ts`: 3 (≥1 required) ✓
  - `ImapErrorContext` in `src/lib/email/error-handler.ts`: 2 (≥1 required) ✓
  - `sidecar_protected` in `src/lib/email/error-handler.ts`: 1 ✓
  - `getSidecarAccountIds` in `src/worker/handlers/smtp-connection-monitor.ts`: 2 ✓
  - `src/worker/handlers/sidecar-health-monitor.ts`: present (6441 bytes, 2026-05-02 02:04) ✓
  - `responseStatus|executedCommand` in `src/lib/email/imap-sync.ts`: 5 ✓
- **All three crons firing on schedule** (15-min/15-min/5-min):
  - `Syncing all email accounts...` at 15:45, 15:50, 15:55, 16:00, 16:05, 16:10
  - `Monitoring SMTP connections...` at 15:45, 16:00 (smtp-connection-monitor)
  - `Probing sidecar health...` at 15:45, 16:00 — both `SIDECAR_DEPLOYED_HOSTS empty; no-op` (expected; flag-default-empty) ✓
  - `[smtp-connection-monitor] No active email accounts found` (expected — all P20 + others disabled pre-flagflip)

## 2. P20-S1 sidecar health (Phase 0.2)

- **External `curl -sk https://mail1.krogermedianetwork.info/admin/health`:**
  HTTP 200, `{"status":"ok","version":"1.0.0","uptime_ms":81925147}` ✓
  (uptime ~22.7h, since CC #5a v2's deploy on 2026-05-01 15:30:13 UTC)
- **Internal SSH check:**
  - `systemctl is-active dashboard-panel-sidecar`: `active` ✓
  - `systemctl is-active nginx`: `active` ✓
  - Internal `curl http://127.0.0.1:8825/admin/health`: status=ok ✓

## 3. P20-S2 capability verification (Phase 0.3)

| Capability | State | Verdict |
|------------|-------|---------|
| Hostname  | `mail2.krogermedianetwork.info` | ✓ |
| OS / Hestia | Ubuntu 22.04 / 1.9.4 release (matches S1) | ✓ |
| nginx test | OK (only pre-existing SSL-stapling warnings on other vhosts) | ✓ |
| Panel cert | `/home/admin/conf/web/mail2.../ssl/mail2....crt` present | ✓ |
| Cert SAN | `DNS:mail2.krogermedianetwork.info` | ✓ |
| Cert validity | `notBefore=Apr 25 2026, notAfter=Jul 24 2026` (~83 days) | ✓ |
| mail2 vhost | `server_name mail2.krogermedianetwork.info ;` present | ✓ |
| Per-vhost custom hook glob | `/home/admin/conf/web/mail2.../nginx.ssl.conf` exists; `nginx.ssl.conf_*` glob loads custom blocks | ✓ |
| Node | ABSENT (apt install in Phase 5a) | expected |
| Port 8825 | FREE | ✓ |
| `/opt/dashboard-panel-sidecar` | does not exist (clean slate) | ✓ |

## 4. P20 account inventory (Phase 0.4)

- **Total rows where server_pair_id = `cbc887de-...`:** 27 ✓
- **Status: 27 disabled / 0 active**
- **By smtp_host:** 15 on S1 (173.255.199.209), 12 on S2 (104.237.145.127)
- **consecutive_failures distribution:** cf=0 (23), cf=3 (4)
- **disable_reason:** all NULL (the 27 cascade-disabled before the
  `disable_reason` column became authoritative)
- **last_error patterns:** 23 NULL, 4 `"Command failed"` (the cf=3 set —
  the imapflow generic-branch cascade victims that CC #5b1.5 was
  designed to suppress going forward)
- **9 distinct sending domains** (5 on S1, 4 on S2):
  - **S1 (173.255.199.209):** krogeradpartners.info, krogerads.info, krogeradsuite.info, krogerbrandcentral.info, krogerbrandimpact.info
  - **S2 (104.237.145.127):** krogerbrandnetwork.info, krogerlocalads.info, krogermediapartners.info, krogerpartnerportal.info
- **All 27 account UUIDs captured** to `/tmp/cc5b2v2_p20_accounts_pre.json` (full row snapshot for rollback).

### 4.1 Updated forensic — pre vs post CC #5b1.5

| era | rows | breakdown |
|-----|------|-----------|
| **pre_5b1.5** (created < 2026-05-02T13:20:38Z) | 27 | type=imap_error, severity=critical, sidecar_protected=None |
| **post_5b1.5** (created ≥ merge time) | 0 | (expected — 0 accounts active means imap-sync has nothing to poll) |

Pre-merge time range: 2026-04-30T14:05:49Z → 2026-05-01T15:30:51Z (last
alert ~2h before CC #5b1 merge; cascade-disable storm has been quiescent
because nothing is polling).

**HALT TRIGGER STATUS:** No `post_5b1.5` rows with `sidecar_protected != 'true'`. PASS — no production cascade-disable post-merge.

## 5. Smoke account selections (Phase 0.5–0.6)

### Probe 5 (worker→sidecar integration) — 3 reps:

| # | Email | Side | Sending domain | account_id |
|---|-------|------|----------------|-----------|
| 1 | `adam.shaw@krogeradpartners.info` | S1 | krogeradpartners.info | `8f6b6609-0852-44b3-a1a0-edc11cfbf25c` |
| 2 | `anthony.hunt@krogerads.info` | S1 | krogerads.info | `525e3767-2665-4b1b-bf41-82d47a354021` |
| 3 | `mary.parker@krogerbrandnetwork.info` | S2 | krogerbrandnetwork.info | `756c9ee1-3af6-4fd8-8266-0783b15cb58c` |

### Probe 3.5b (direct-curl from S2) — 3 reps from 3 distinct S2 domains:

| # | Email | Sending domain | account_id |
|---|-------|----------------|-----------|
| 4 | `mary.parker@krogerbrandnetwork.info` | krogerbrandnetwork.info | `756c9ee1-...` |
| 5 | `roger.carlton@krogerlocalads.info` | krogerlocalads.info | `7475fef2-cc07-4aa5-a1a5-903b6d4d63f0` |
| 6 | `susan.rivera@krogermediapartners.info` | krogermediapartners.info | `255cd1f0-54a9-42f3-a6b7-ffc8be49952c` |

### Sending-domain overlap (5a ∩ 5b)

`krogerbrandnetwork.info` — `mary.parker` is hit twice: once via direct-curl
to S2 sidecar (Probe 3.5b/SMOKE_4) and once via worker→sidecar through
`smtp-manager.ts`'s flag-gated branch (Probe 5/PROBE5_ACCT_3). Catches any
worker-side flag-gating bug specific to that domain.

## 6. SIDECAR_HMAC_SECRET pull (Phase 0.7)

- Source: `root@P20_S1_IP:/opt/dashboard-panel-sidecar/.env` line `HMAC_SECRET=...`
- **Length: 64 chars (32-byte hex)** ✓
- **Format: hex-only** ✓
- Stored at `/tmp/cc5b2v2-env.sh` (chmod 600) for Phase 5 reuse.
- **Value never echoed in any output, log, or report.**

## 7. MXToolbox + DNS pre-baseline (Phase 0.8)

- **5 zones probed via `tools/verify-zone.sh <zone> krogermedianetwork.info 173.255.199.209 104.237.145.127`:**

| Zone | WARN | FAIL | Verdict |
|------|------|------|---------|
| krogermedianetwork.info (NS apex) | 7 | 0 | HL #110 envelope ✓ |
| krogeradsuite.info (S1) | 7 | 0 | HL #110 envelope ✓ |
| krogerlocalads.info (S2) | 7 | 0 | HL #110 envelope ✓ |
| krogerbrandnetwork.info (S2) | 7 | 0 | HL #110 envelope ✓ |
| krogermediapartners.info (S2) | 7 | 0 | HL #110 envelope ✓ |

- **`dig +noall +answer mail1.krogermedianetwork.info A`:** `173.255.199.209` ✓
- **`dig +noall +answer mail2.krogermedianetwork.info A`:** `104.237.145.127` ✓
- All 7 WARNs per zone are the expected HL #110 envelope (SOA refresh/retry/expire timers, MTA-STS HTTPS missing, TLS-RPT not deployed, STARTTLS Mac-artifact, cert-CN parse Mac-artifact). Pre-existing.
- **Baseline files:** `/tmp/cc5b2v2_dns_pre/*.txt` (5 zone reports + 2 dig outputs) for byte-identical post-state comparison.

## 8. Files to create/modify (Phase 1, code-side)

Code change is intentionally minimal — substantive work is operational (Phase 5).

| File | Δ |
|------|---|
| `src/worker/handlers/__tests__/sidecar-health-monitor.test.ts` | EDIT (or create) — add 2 source-grep tests verifying CC #5b1's queue registration + cron schedule |
| `src/lib/email/__tests__/error-handler.test.ts` | EDIT — add 2 source-grep tests verifying CC #5b1.5's `getSidecarAccountIds` + `sidecar_protected` markers stay |
| `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` | EDIT — add 1 source-grep verifying CC #5b1's `getSidecarAccountIds` in smtp-connection-monitor.ts stays |

These are belt-and-suspenders contract tests — the substantive runtime
behavior is already covered by CC #5b1's and CC #5b1.5's own tests. Goal
here: future-CC resilience (someone refactoring tomorrow can't silently
break the sidecar invariants).

## 9. Operational change manifest (Phase 5)

### 9.1 Phase 5a — P20-S2 sidecar deploy
- `scp panel-sidecar/* root@P20_S2_IP:/opt/dashboard-panel-sidecar/`
- `apt install -y nodejs npm`
- Write `/opt/dashboard-panel-sidecar/.env` (HMAC_SECRET=<from S1>; PORT=8825; WORKER_IP_ALLOWLIST=200.234.226.226,172.104.219.185)
- `cp panel-sidecar/dashboard-panel-sidecar.service /etc/systemd/system/`
- `systemctl daemon-reload && systemctl enable && systemctl start dashboard-panel-sidecar`
- `bash install-nginx-vhost.sh mail2.krogermedianetwork.info` (drops `/home/admin/conf/web/.../nginx.ssl.conf_sidecar`)
- `nginx -t && systemctl reload nginx`
- Probes 1b/2b/3b/3.5b (HTTPS health, HMAC enforce, IP allowlist, 3-domain direct-curl smoke)

### 9.2 Phase 5b — worker env modification
- `cp .env .env.bak.cc5b2v2` (rollback baseline)
- Append:
  - `SIDECAR_HMAC_SECRET=<value>` (existing from S1)
  - `SIDECAR_DEPLOYED_HOSTS=mail1.krogermedianetwork.info,mail2.krogermedianetwork.info`
  - `USE_PANEL_SIDECAR_ACCOUNT_IDS=<27 P20 UUIDs comma-separated>`
- `systemctl restart dashboard-worker`
- Verify journalctl post-restart shows clean startup

### 9.3 Phase 5b.2 — mass reactivation
```sql
-- Single bulk UPDATE on all 27 P20 rows
UPDATE email_accounts
SET status='active',
    consecutive_failures=0,
    last_error=NULL,
    last_error_at=NULL,
    disable_reason=NULL,
    updated_at=NOW()
WHERE server_pair_id='cbc887de-4b86-49aa-a233-08958a7a03ae'
RETURNING id, email, status;
```
Expected: 27 rows returned, all `status='active'`.

### 9.4 Phase 5b.3 — Probe 5 worker-integration smoke

`tsx` script invoked on worker that imports `sendEmail()` from
`smtp-manager.ts` and fires 3 sends from PROBE5_ACCT_1/2/3. Each verified
in `/var/log/exim/mainlog` for clean `<= U=Debian-exim P=local-bsmtp` and
correct per-domain `=> DKIM=<sending-domain>`.

### 9.5 Phase 5c — 3 stability gates
1. **Probe 6a (16 min wait):** smtp-connection-monitor cycle with 27 sidecar-flagged → all 27 STAY active, 0 auto-redisabled.
2. **Probe 6b:** sidecar-health-monitor cycle probes both panels → 0 unhealthy alerts.
3. **Probe 6c (6 min wait, NEW):** imap-sync polls 27 reactivated → all 27 STAY active. Any new `imap_error` alerts MUST carry `details.sidecar_protected='true'` AND rich imapflow context fields. **This is the critical production-validation of CC #5b1.5's suppress logic.**

## 10. Phase-by-phase auto-rollback recipes

- **Probe 1b/2b/3b/3.5b FAIL:** uninstall S2 sidecar (systemctl stop+disable, `bash uninstall-nginx-vhost.sh mail2...`, nginx reload). Worker env not yet touched — clean revert.
- **Probe 5 FAIL:** revert worker `.env` from `.env.bak.cc5b2v2`, per-row UPDATE restoring prior state from `cc5b2v2_pre_reactivate_state.csv` (NOT a blanket `disabled` UPDATE — preserves the 4 cf=3/last_error="Command failed" rows' precise prior values).
- **Probe 6a FAIL:** same as Probe 5 + investigate worker journalctl env-load.
- **Probe 6b FAIL:** revert `.env` (drops SIDECAR_DEPLOYED_HOSTS) — sidecars stay running, cron returns to no-op.
- **Probe 6c FAIL (CRITICAL — CC #5b1.5 broken):** same as Probe 5 + capture the cascade-disable alert (`details.sidecar_protected != 'true'`) for diagnostic CC.
- **Probe 8 FAIL:** revert all of 5b + uninstall S2 nginx hook.

## 11. Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| imap-sync cascade-disables 27 again on first cycle (CC #5b1.5 suppress not actually working in prod) | Probe 6c is THE production-validation. Auto-rollback on FAIL preserves data. |
| HMAC mismatch between S1 (deployed) and S2 (newly installed) | Pulled length-verified secret from S1 directly; reused identically on S2 + worker. |
| nginx vhost install collides with existing custom block on S2 | Pre-verified S2 has only `nginx.ssl.conf` + `nginx.ssl.conf_letsencrypt` — no `_sidecar` collision. |
| Mass UPDATE catches pair_id from a stale clone | `WHERE server_pair_id='cbc887de-4b86-49aa-a233-08958a7a03ae'` is exact UUID match; 27-row pre-snapshot saved for rollback. |
| Probe 5 send fires but DKIM signs with wrong domain (per-domain auth bug) | mainlog `=> DKIM=<sending-domain>` line is verified per send; mismatch = FAIL → auto-rollback. |
| MXToolbox/DNS post-state diverges from pre | Probe 8 byte-diffs all 5 zones + 2 A records; any divergence = FAIL → rollback (means sidecar/nginx install accidentally moved DNS or zone state). |

## 12. MXToolbox-impact assertion

This session adds nothing to public DNS — no zone edits, no Hestia DNS
record adds, no `v-add-dns-record` calls, no `v-change-dns-domain-soa`
calls. The S2 sidecar deploy uses ONLY:

- nginx custom config block (per-vhost include — local file, no DNS impact)
- systemd service install (local)
- node/npm install (local)
- worker `.env` append (worker-local)
- one `email_accounts` mass UPDATE (DB-only, no DNS impact)

Therefore Probe 8 MUST find byte-identical pre/post MXToolbox + dig
output. Any divergence is a critical anomaly.

## 13. NO-GO compliance pre-flight

- ✓ No `src/lib/provisioning/` modified
- ✓ No `provision-*` / `pair-verify` / `rollback-*` handlers modified
- ✓ No `dashboard-app/.gitignore` or `serverless-steps.ts` touched
- ✓ No DB migration
- ✓ No DNS records
- ✓ No DELETE on `email_accounts`
- ✓ No `email_send_log` deletes
- ✓ Mass UPDATE scope = exactly the 27 P20 rows (no other pair touched)
- ✓ Old Ionos / 10 panel.* relays / LE certs / firewall rules untouched
- ✓ HMAC + ENCRYPTION_KEY values redacted from all output
- ✓ `/api/campaigns/[id]/send` not called
- ✓ `campaigns.status` not touched
- ✓ No reads of `project_11_*` / `outscraper_businesses` / `public_data_lead_sourcing/`
- ✓ Snov.io infra not touched

## 14. Drift from prompt (corrections incorporated)

| # | Prompt assumption | Actual | Resolution |
|---|-------------------|--------|-----------|
| 1 | `email_accounts.disabled_at` column exists | Column does not exist | Removed from §0.4 query; non-blocking (only used for forensic display, not for any UPDATE) |
| 2 | Smoke pick of `debra.flowers@krogeradsuite.info` (S1) and `stephanie.greer@krogerlocalads.info` (S2) | Neither name exists in P20 inventory; CC #5b's HALT report referenced them but they are not on this pair | Replaced with first-cf=0-account-per-domain heuristic: adam.shaw@krogeradpartners.info (S1), anthony.hunt@krogerads.info (S1), mary.parker@krogerbrandnetwork.info (S2) |

Both deviations are mechanical and preserve the Probe 5 design intent (3 distinct sending domains; ≥1 from S1; ≥1 from S2; ≥1 domain overlap with Probe 3.5b).

## 15. Cleared to proceed

Phase 0 GREEN. Proceeding to Phase 1 (test additions) → Phase 4 (PR + auto-merge) → Phase 5 (operational deploy + smoke).
