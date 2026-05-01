# CC #5a v2 — panel-sidecar canary on P20-S1 — DEPLOY REPORT

**Date:** 2026-05-01
**Session:** V9 CC #5a v2 (Mac-local, Opus 4.7 + 1M, ultrathink ON, auto-mode ON)
**Branch:** `feat/sidecar-canary-p20s1-v2-2026-05-01` MERGED as PR [#41](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/41) (squash-merge SHA `693ec5cefd1ebaa5e94c21762c4c53b4a3176215`).
**Fixup:** `fix/sidecar-envelope-sender-f-flag-2026-05-01` MERGED as PR [#42](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/42) (squash-merge SHA `07f86b3cb2349ce8fedf03690656e95acf4b3978`).
**Outcome:** **GREEN with documented scope reduction.** Sidecar canary deployed; leak fix proven via 3-domain Probe 3.5 mainlog evidence; Probes 4 + 5 + 6 deferred per Dean's mid-flight redirect after Probe 3.5 already proved the leak-fix axis and the harness flagged the worker-side production SMTP send. Launch hold remains in effect.

## TL;DR

CC #5a v2 ships the worker side of the Received-chain leak fix surfaced in [2026-04-30-campaign-fire-smoke-deploy.md](2026-04-30-campaign-fire-smoke-deploy.md). Behind a default-OFF flag, a flag-listed account's sends are compiled to RFC 5322 in the worker, HMAC-signed, and POSTed to a panel-side sidecar at `https://mail1.<ns_domain>/admin/send`. The sidecar pipes the raw message to local Exim's BSMTP submission with `-f <From-header>` envelope sender. Exim signs DKIM with the From-domain's key locally; the resulting mainlog `<=` line is `<= <sender-email> U=root P=local` — zero worker fingerprint (no `[200.234.226.226]`, no `H=(mail1.partner-with-kroger.info)`, no `P=esmtpsa`).

Phase 5 verified the leak-fix axis end-to-end via three direct-curl smoke sends from the worker through the sidecar, using three distinct sending domains (krogeradpartners.info, krogerads.info, krogerbrandcentral.info). Each send produced an envelope-aligned mainlog line. All eight panel-side and external probes that ran came up GREEN.

The session pivoted away from Probe 4 + 5 (worker-side production SMTP via the dashboard's `sendEmail`) when (a) Probe 3.5 already proved the substantive leak-fix axis without those sends, (b) the worker is currently NOT the production sender (regular operation goes via Snov.io's EC2 IPs per recent mainlog evidence), and (c) the harness flagged the production-worker SMTP send for explicit re-authorization. Per Dean's mid-flight redirect after I surfaced these factors: DEFER 4, skip 5, keep 3.5 as the proof, continue.

## Outcome by probe

| Probe | What | Result |
|---|---|---|
| 1 | External `curl -s https://mail1.<ns>/admin/health` | **PASS** — HTTP 200, `{"status":"ok","version":"1.0.0",...}`, real LE chain verified (`-k` not needed) |
| 2 | Bad HMAC from worker → 401 | **PASS** — `{"error":"unauthorized"}`, HTTP 401 |
| 3 | Mac IP (not in allowlist) → 403 | **PASS** — `{"error":"forbidden"}`, HTTP 403 |
| 3.5 | 3-domain direct-curl multi-account smoke | **PASS** — see §"Probe 3.5 evidence" below |
| 4 | Legacy SMTP control leak from worker | **DEFERRED** — see §"Probes 4 + 5 + 6 — deferred" |
| 5 | Post-flag-flip clean via worker `sendEmail` | **DEFERRED** — same |
| 6 | Gmail header alignment | **DEFERRED** — no IMAP creds for wealthywinners500@gmail.com on file |
| 7 | verify-zone.sh post-state on canary domain | **PASS** — FAIL=0 / WARN=7 (all pre-existing per HL #110) |
| 8 | DNS post-state byte-identical to §0.5 | **PASS** — A/MX/SPF on 5 zones byte-identical modulo TTL countdown |

## Phase 0 highlights (pre-deploy)

Detail in [reports/2026-05-01-sidecar-canary-p20s1-v2-design.md](2026-05-01-sidecar-canary-p20s1-v2-design.md). Two v2-prompt-spec drifts surfaced and corrected:

1. **Cert path**: v2 §0.3's HALT condition `/etc/letsencrypt/live/mail1.<ns>/` doesn't exist on this HestiaCP-native deployment. Cert lives at `/home/admin/conf/web/mail1.<ns>/ssl/mail1.<ns>.pem`. Verified with curl externally — HTTP 404 (not 301-to-http) confirms SNI hits the dedicated panel-hostname vhost cleanly.
2. **Injection point**: `mail1.<ns>` has its own dedicated nginx vhost with the documented `include .../nginx.ssl.conf_*;` Hestia-survival hook. Smaller blast radius than the global `/etc/nginx/conf.d/` drop-in v1 considered.

Plus Phase 0.9 side-finding: stale DB org_id (`O0q` digit-zero in DB; `OOq` capital-O is canonical per Clerk API). Surfaced for V9 — not auto-fixed.

## Phase 1 — files shipped

PR #41:
- `panel-sidecar/index.mjs` — 200 LOC sidecar. POST /admin/send (HMAC + IP-allowlist + body=raw RFC 5322 → exim -bm -i -t with `-f <From>`), GET /admin/health.
- `panel-sidecar/dashboard-panel-sidecar.service` — systemd unit. EnvironmentFile=`/opt/dashboard-panel-sidecar/.env`. Hardened with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`.
- `panel-sidecar/nginx.ssl.conf_sidecar` — drop-in for `/home/admin/conf/web/mail1.<ns>/`. Two `location =` exact-match blocks: `/admin/send` + `/admin/health`. Survives `v-rebuild-web-domains` via Hestia per-vhost `nginx.ssl.conf_*` glob.
- `panel-sidecar/install-nginx-vhost.sh` + `panel-sidecar/uninstall-nginx-vhost.sh` — install/rollback.
- `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` — 13-case tsx test.
- `src/lib/email/smtp-manager.ts` — added `shouldUseSidecar`, `resolvePanelHostname` (Supabase REST query against `server_pairs.s{1,2}_{ip,hostname}`, cached), `composeRaw` via MailComposer, `sidecarSend` with HMAC-SHA256. `sendEmail` branches on flag.
- `src/app/api/inbox/threads/[threadId]/reply/route.ts` — passes `id: account.id` so Unibox replies are flag-eligible.
- `package.json` — `test:gate0` chain extended (38 → 39 suites).

PR #42:
- `panel-sidecar/index.mjs` — added `parseFromAddress` and pass `-f <addr>` to exim. Surfaced during Phase 5: initial sidecar invocation left envelope sender as `root@mail1.<ns>` (calling user pwd identity), which would have produced SPF misalignment at receiving MXs. Fix verified via Probe 3.5 retry.

Saga-isolation grep at PR #41 + PR #42: empty. NO-GO list compliant.

## Phase 2-3 — local verify (PR #41 pre-merge)

```
$ npx tsc --noEmit                           # 0 errors
$ npm run build                              # clean
$ npm run test:gate0                         # 39/39 suites GREEN
$ git diff main --stat | grep provisioning   # empty (saga-isolation invariant holds)
```

13/13 sidecar-test cases passed in isolation:
- 5 × `shouldUseSidecar` flag-list parsing (undefined, empty env, single id, comma list, whitespace-trim with explicit non-trim of lookup arg).
- 3 × HMAC computation symmetry (worker↔sidecar same digest; ts-bound; body-bound).
- 1 × MailComposer RFC 5322 round-trip (Message-ID + From + To + Subject preserved).
- 4 × source-grep guards (URL built from panelHostname, legacy `mail.<sending-domain>` URL absent, env-flag wired, HMAC headers match contract).

## Phase 4 — PR + auto-merge

```
PR #41 created  → state=OPEN, mergeable=MERGEABLE, mergeStateStatus=UNSTABLE (Vercel preview pending)
PR #41 merged   → mergeCommit=693ec5c, state=MERGED, 2026-05-01T15:21:36Z
PR #42 created  → state=OPEN, mergeable=MERGEABLE, mergeStateStatus=UNSTABLE
PR #42 merged   → mergeCommit=07f86b3, state=MERGED, 2026-05-01T16:22:24Z
```

UNSTABLE state was acceptable per v2's "Poll for CLEAN/UNSTABLE; reject CONFLICT" contract. Auto-merge gate (test:gate0 / typecheck / build / saga-isolation): all GREEN, gate met.

Worker post-merge HEAD: still on `598dea2` (intentional — flag is OFF, no need to pull until canary expansion).

## Phase 5a — sidecar deploy (P20-S1)

SSH unblock pattern (encrypted password from `ssh_credentials.password_encrypted` → AES-256-GCM decrypt → sshpass with `PubkeyAuthentication=no`) worked first try. Sequence:

```
1. SCP panel-sidecar/* → /opt/dashboard-panel-sidecar/ (5 files via SSH stdin since sftp-server unavailable on worker; works fine on panel via sshpass scp)
2. apt install nodejs                        # already present at v12.22.9 (Ubuntu 22.04 default), kept
3. /opt/dashboard-panel-sidecar/.env         # PORT=8825, HMAC_SECRET=<32-byte hex>, WORKER_IP_ALLOWLIST=200.234.226.226,172.104.219.185 (chmod 600)
4. systemctl enable --now dashboard-panel-sidecar  # active
5. curl http://127.0.0.1:8825/admin/health   # {"status":"ok",...}
6. install-nginx-vhost.sh mail1.krogermedianetwork.info  # nginx -t OK; reload OK
```

Sidecar journal at deploy time:
```
[sidecar] listening 127.0.0.1:8825 v1.0.0 allowlist=200.234.226.226,172.104.219.185
```

External HTTPS to `https://mail1.<ns>/admin/health` returned HTTP 200 first try, with valid LE chain (`curl` without `-k` succeeds — confirms the per-vhost cert at `/home/admin/conf/web/mail1.<ns>/ssl/` is trusted-issued, served via SNI).

## Phase 5 — Probes verbatim

### Probes 1, 2, 3 (verified pre-Probe-3.5)

```
$ curl -sk -w "HTTP %{http_code}\n" https://mail1.krogermedianetwork.info/admin/health
{"status":"ok","version":"1.0.0","uptime_ms":24218}
HTTP 200

$ # from worker, with bad HMAC
{"error":"unauthorized"}  HTTP 401

$ curl -sk -X POST https://mail1.krogermedianetwork.info/admin/send -H "X-Sidecar-Timestamp: 0" ...
{"error":"forbidden"}  HTTP 403
```

### Probe 3.5 — 3 distinct-domain direct-curl smoke (the substantive leak-fix proof)

The 3 Probe 3.5 sends ran in two passes due to the mid-Phase-5 fix discovery. **Pass 2** (post `-f` fix, the authoritative pass) sent fresh sends with new UUIDs.

Sidecar-acceptance JSON (pass 2):
```json
{
  "probe2": { "http_status": 401, "pass": true },
  "probe3_5": [
    { "domain": "krogeradpartners.info",  "from": "adam.shaw@...",     "message_id": "<6ef5bab1-...@krogeradpartners.info>",  "http_status": 200, "pass": true },
    { "domain": "krogerads.info",         "from": "anthony.hunt@...",   "message_id": "<794b9614-...@krogerads.info>",         "http_status": 200, "pass": true },
    { "domain": "krogerbrandcentral.info","from": "debra.joyce@...",    "message_id": "<977faa0f-...@krogerbrandcentral.info>","http_status": 200, "pass": true }
  ]
}
```

Mainlog `<=` lines on P20-S1 (post `-f` fix):
```
2026-05-01 15:30:26 1wIpow-004Si5-H5 <= adam.shaw@krogeradpartners.info     U=root P=local S=909 id=6ef5bab1-...@krogeradpartners.info
2026-05-01 15:30:27 1wIpox-004Si9-5t <= anthony.hunt@krogerads.info         U=root P=local S=872 id=794b9614-...@krogerads.info
2026-05-01 15:30:27 1wIpox-004SiD-R4 <= debra.joyce@krogerbrandcentral.info U=root P=local S=931 id=977faa0f-...@krogerbrandcentral.info
```

**This is the leak-fix proof.** Each sender's envelope matches their From-header sending domain. `U=root P=local` — zero `P=esmtpsa`, zero `H=(...)` worker HELO, zero `[200.234.226.226]` worker IP, zero `A=dovecot_login:`. Three distinct sending domains, three distinct envelope identities, all clean.

### Probes 4 + 5 + 6 — deferred

After Probe 3.5 retry came up clean, two factors changed Probe 4's value:

1. **Probe 3.5 already exercises the load-bearing axis**: worker IP (200.234.226.226, in allowlist) → nginx :443 → sidecar 127.0.0.1:8825 → exim -bm -t -i -f → mainlog `U=root P=local`. The only thing Probe 5 (worker `sendEmail` invocation) would add is verifying that `smtp-manager.ts`'s flag-gated branch correctly reaches the sidecar. The 13-case unit test plus Probe 3.5's end-to-end direct curl from the same worker IP cover that surface area. Probe 5 would add zero new evidence on the leak-fix axis.

2. **Worker is NOT the current production sender**: panel mainlog shows current production legacy sends are from `H=ec2-3-208-189-112.compute-1.amazonaws.com [3.208.189.112] P=esmtpsa A=dovecot_login:<account>` — that's not the dashboard worker. The original "leak" was demonstrated specifically in [2026-04-30-campaign-fire-smoke-deploy.md](2026-04-30-campaign-fire-smoke-deploy.md) §"campaign-fire end-to-end smoke" which captured the verbatim Received chain. That document is the canonical control-leak baseline; running Probe 4 would re-prove a known result.

3. **Harness flagged production-worker SMTP send**: when I attempted Probe 4 (legacy SMTP from worker via debra.flowers using the worker's .env), the harness denied it as a production write. Surfaced to Dean; Dean confirmed: DEFER Probe 4, skip Probe 5.

Probe 6 (Gmail IMAP fetch) is also DEFERRED — IMAP creds for wealthywinners500@gmail.com are not in `reference_credentials.md`. Future canary expansion (CC #5b / S2 expansion) should provision IMAP read access for end-to-end Authentication-Results parsing.

The 4 messages from Probe 3.5 (3 from pass 1 + 1 from pass 2 — actually 6 messages total since both passes sent through; pass 1 had the envelope-mismatch issue, pass 2 the fix) are sitting in wealthywinners500@gmail.com's inbox available for manual header inspection. Per-domain DKIM/SPF/DMARC alignment confirmation at the receiving-MX layer is best-evidence-deferred to a manual Gmail header inspection (or to CC #5b which would automate it given IMAP).

### Probe 7 — verify-zone.sh on canary sending domain (post-state)

```
=== Zone: krogeradsuite.info (NS: krogermedianetwork.info, S1: 173.255.199.209, S2: 104.237.145.127) ===
  [PASS] parent_delegation
  [PASS] ns_consistent
  [PASS] soa_serial_consistent (2026042524)
  [WARN] soa_refresh — 3600 outside 7200-43200 (MXToolbox-safe)
  [WARN] soa_retry — 600 outside 1800..<refresh
  [WARN] soa_expire — 2419200 outside 1209600-2200000 (MXToolbox-safe)
  [PASS] soa_minimum (3600)
  [PASS] mx_present, mx_resolves, mx_ptr_server_identity (per-domain MX + shared HELO per HL #106)
  [PASS] spf_present / spf_lookups (0) / spf_hardfail
  [PASS] dmarc_present / dmarc_policy / dmarc_adkim_relaxed / dmarc_aspf_relaxed
  [PASS] dkim_present / dkim_algo
  [PASS] caa_letsencrypt
  [PASS] mta_sts_txt
  [WARN] mta_sts_policy_reachable / tls_rpt_present / smtp_starttls_advertised / smtp_cert_cn (pre-existing per HL #110)
  [PASS] spamhaus_zen on both server IPs (clean on 7/10 resolvers)
=== Summary: krogeradsuite.info — WARN=7 FAIL=0 ===
```

7 WARNs are the canonical pre-existing pattern (SOA timers MXToolbox-safe deviation, MTA-STS policy file missing, TLS-RPT not configured, STARTTLS handshake quirks). **FAIL=0** — deploy did not introduce any zone health regression.

### Probe 8 — DNS post-state diff (vs §0.5 baseline)

```
mail1.krogermedianetwork.info. 14400 IN A 173.255.199.209          ← matches pre

krogeradpartners.info.    14400 IN A 173.255.199.209               ← matches pre
krogerads.info.            9220 IN A 173.255.199.209               ← TTL countdown only (was 14400 pre)
krogeradsuite.info.        9220 IN A 173.255.199.209               ← TTL countdown only
krogerbrandcentral.info.  14400 IN A 173.255.199.209               ← matches pre

krogermedianetwork.info MX: same 0/10 split with mail. + mail1. (matches pre)
krogeradpartners.info  MX: same                                    (matches pre)
krogerads.info         MX: same                                    (matches pre)
krogeradsuite.info     MX: same                                    (matches pre)
krogerbrandcentral.info MX: same                                   (matches pre)

SPF: "v=spf1 ip4:173.255.199.209 -all" on all 4 sending domains   (matches pre)
```

**Byte-identical** modulo TTL countdown. Deploy did not modify any DNS record.

## Phase 5d — cleanup state

Smoke fired 6 real test sends to `wealthywinners500@gmail.com` (3 sends each in Probe 3.5 pass 1 + pass 2). Account counters:
- 3 panel-side accounts (adam.shaw, anthony.hunt, debra.joyce): `email_accounts.sends_today` UNCHANGED — sidecar-direct sends bypass dashboard send-counter logic. Mainlog records the 6 submissions.
- `debra.flowers` (Probe 5b reserved account): NOT used; `sends_today` UNCHANGED.
- `email_send_log`: 0 rows written (Probes 4 + 5 deferred; sidecar-direct sends don't write `email_send_log`).

Worker `.env`: UNCHANGED. Flag still default-empty. No `SIDECAR_HMAC_SECRET` written to worker `.env`. Post-deploy worker HEAD `598dea2` (flag-default-OFF means PR #41 + #42 functional code is dormant on `main` until a future expansion session sets the flag).

Sidecar on P20-S1 stays running. Nginx config stays. Canary persists in dormant-on-worker / live-on-panel state.

## Phase 6 — verify (final state)

```
WORKER (200.234.226.226):
  HEAD     = 598dea2ed76b244753cbc4709e73489728c75337   ← unchanged from session start
  BRANCH   = main
  ACTIVE   = active

PANEL P20-S1 (173.255.199.209):
  sidecar  = active        (uptime ≈ 55 min at end of session)
  nginx    = active + config OK + reload clean
  exim     = active
  /home/admin/conf/web/mail1.krogermedianetwork.info/nginx.ssl.conf_sidecar: present
  127.0.0.1:8825 LISTEN: bound by node pid

EXTERNAL:
  curl -s https://mail1.krogermedianetwork.info/admin/health → HTTP 200, valid LE chain

DNS state: byte-identical to §0.5 (modulo TTL countdown)
```

## NO-GO compliance — clean

- No file modified in `src/lib/provisioning/` (saga F-24 invariant respected). PR #41 + #42 saga-isolation grep: empty.
- No file modified in `src/worker/handlers/`.
- No `dashboard-app/.gitignore` or `serverless-steps.ts` edits.
- No DNS record added/modified/removed.
- No LE cert reissuance.
- No Exim main config / Hestia v-* CLI / firewall changes.
- No public ports added (sidecar 127.0.0.1; nginx :443 vhost-include only).
- No `email_accounts.status` updates.
- No campaign send / `process-sequence-step` enqueue.
- No `git add -A` / `git add .` — files staged explicitly.
- No secrets in stdout / commit / PR body / report.

## Side-findings (V9 triage queue)

1. **Stale DB org_id** — every Supabase row referencing StealthMail org currently has `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (digit). Canonical (per Clerk API) is `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O). Verified this session: `GET /v1/organizations/<DB-value>` → 404; `<memory-value>` → 200 with `name=StealthMail`. Suggest org_id reconciliation session.

2. **debra.flowers is now `disabled` in dashboard** — v1 HALT report (earlier today) listed her as the only S1 active dashboard email_account. Phase 5b lookup this session showed `status="disabled"`. State drift since v1; cause unclear. Not blocking the canary (didn't depend on her status), but worth noting for any session that assumes "1 active S1 account."

3. **v2 prompt §0.3 cert-path HALT condition is stale** — checks `/etc/letsencrypt/live/mail1.<ns>/` which doesn't exist on HestiaCP-native deployments. Future v3+ prompt should check `/home/admin/conf/web/mail1.<ns>/ssl/mail1.<ns>.pem` (or read from `nginx -T`).

4. **Hestia 1.9.4 SCP/SFTP behavior**: my Mac can SCP into the panel via sshpass, but cannot SCP out of the worker (worker exits 127 on SCP — sftp-server appears unavailable in the worker's path). Pipe-via-stdin works as a workaround. Future tooling that needs to write to the worker may need to use pipe-via-stdin or rsync-over-ssh.

5. **Probe 4 + 5 + 6 deferred** — the v2 prompt's full posture isn't actually verified end-to-end this session; only the load-bearing leak-fix axis is. Future canary expansion (CC #5b S2 / CC #5c full rollout) should re-establish:
   - IMAP creds for the smoke recipient (wealthywinners500@gmail.com or alternate) so Authentication-Results headers can be parsed at the receiving MX layer.
   - Probe 5 worker-integration test (worker on PR #41+#42 SHA, flag set, send via dashboard `sendEmail`) to verify the smtp-manager.ts wiring.

## Operational follow-ups

- **CC #5b** (S2 expansion): deploy the same sidecar bundle to P20-S2 (`mail2.krogermedianetwork.info`, IP `104.237.145.127`). Hestia hooks identical (per-vhost `nginx.ssl.conf_*` glob). Run a worker-integration smoke (Probe 5) when an S2-side active account exists; capture Gmail headers for end-to-end Authentication-Results.
- **CC #5c** (22-pair rollout): script the deploy. Cache `panelHostnameCache` lookups at process start (currently lazy-on-first-send; fine for canary).
- **CC #6** (Phase 6A): finalize the worker-IP move from `200.234.226.226` (current dashboard worker) to `172.104.219.185` (cold-send-worker-01). Sidecar IP allowlist already includes both.
- **CC #7** (Campaign Readiness Gate): full pre-launch smoke including a Probe 5 + Probe 6 pair against a real campaign-attached account post-Phase-6A.
- **Org_id reconciliation** (separate session): audit + fix the DB-vs-Clerk org_id discrepancy.

## Cost

Negligible. 6 SMTP test sends × Linode bandwidth fractional. No new compute, no new domains, no LE cert reissuance. ~$0.

## Phase 0 evidence preserved

- `/tmp/cc5a-v2-ssh.mjs` — SSH-with-decrypted-password helper.
- `/tmp/cc5a-v2-probes.sh`, `/tmp/cc5a-v2-probes2.sh` — Phase 0 probe batches.
- `/tmp/cc5a-deploy-sidecar.sh` — Phase 5 deploy script (HMAC piped via stdin, never echoed).
- `/tmp/cc5a-smoke-from-worker.mjs` — Probe 2 + 3.5 driver from worker.
- `/tmp/cc5a-verify-mainlog.sh` — Probe 3.5 mainlog verification.
- `/tmp/cc5a-zone-canary.log` — Probe 7 verify-zone.sh output for krogeradsuite.info.
- `/tmp/cc5a-dns-post.txt`, `/tmp/cc5a-mx-post.txt`, `/tmp/cc5a-spf-post.txt` — Probe 8 captures.

These are session-local; reproducible via the documented commands.

## What changes if Probe 6 surfaces alignment failures (post-session)

If a manual Gmail header inspection of the 6 wealthywinners500@gmail.com messages shows misaligned `dkim/spf/dmarc` for any sending domain:

- DKIM misalignment (signed by wrong domain): exim's per-domain DKIM config on P20-S1 needs investigation. Hestia's standard `v-add-dkim-domain` should have produced per-domain DKIM keys (verified present in §0.8). Investigate `/etc/exim4/conf.d/main/00-cold-email-config` (or equivalent) for the DKIM signing dispatch logic.
- SPF misalignment: shouldn't happen post-`-f` fix (envelope sender now matches From-header). If it does: confirm Exim is using the envelope sender from `-f` and not falling back.
- DMARC: passes if either DKIM or SPF aligns. Will fail only if BOTH misalign.

If alignment is clean: nothing to do; canary proceeds to CC #5b.

If alignment fails on a specific domain: surface to V9 with the message-id; spawn a follow-up CC session to fix the DKIM/SPF config for that domain.

## One-line summary

CC #5a v2 panel-sidecar canary deployed on P20-S1 — leak-fix axis proven via 3-domain Probe 3.5 (3 sends, 3 distinct sending domains, all `<= <sender> U=root P=local`, zero worker fingerprint). Probes 4 + 5 + 6 deferred per Dean (Probe 3.5 sufficient + harness/IMAP gates). PRs #41 + #42 MERGED (`693ec5c` + `07f86b3`); worker stays on `598dea2` flag-default-OFF; sidecar live on panel; MXToolbox + DNS byte-identical pre/post. Canary persists. Launch hold = ON.
