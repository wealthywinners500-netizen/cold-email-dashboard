# CC #5a v2 — Phase 0 design — panel-sidecar canary on P20-S1 (Option A)

**Date:** 2026-05-01
**Session:** V9 CC #5a v2 (Mac-local, Opus 4.7 + 1M, ultrathink ON, auto-mode ON)
**Branch:** `feat/sidecar-canary-p20s1-v2-2026-05-01` (created clean from `main` HEAD `daa9584`; zero commits at design-doc time)
**Worktree:** `dashboard-app/.claude/worktrees/sleepy-chaum-fae626`
**Phase 0 outcome:** **GREEN with two v2-prompt-spec corrections + one V9-side-finding to triage. No HALT.**

## TL;DR

Phase 0 read-only investigation completed via SSH-with-decrypted-password unblock pattern (v1's). Worker baseline matches v1 (HEAD `598dea2`, active). P20-S1 capabilities re-verified and extended:

- **Option A's panel-hostname cert exists and works**, but at a different path than v2's prompt assumed.
- **`mail1.<ns>` has its own dedicated nginx vhost with its own LE cert** (not the default `_` vhost, not `/etc/letsencrypt/`). External HTTPS to `https://mail1.<ns>/admin/health` returns HTTP 404 — TLS handshake clean, SNI matches the dedicated vhost (would be 301-to-http if it fell through to default `_`). This is the simplest-possible deployment surface.
- **The dedicated vhost has a Hestia-supported custom-include hook** (`include .../nginx.ssl.conf_*;`) — drop one file at `/home/admin/conf/web/mail1.<ns>/nginx.ssl.conf_sidecar` and `v-rebuild-web-domains` survives.
- **Three distinct sending domains with mailboxes + DKIM keys are available** for Phase 5a's multi-account smoke (need 3 per v2 §0.8; have 5).
- **Org_id discrepancy resolved**: Clerk confirms `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (memory's value, capital-O `OOq`) is canonical; DB's `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (digit `O0q`) returns `resource_not_found`. Stale-DB side-finding for V9.

## v2 prompt drift — corrections applied

### Drift #1 — Cert path

v2 §0.3 + HALT-condition: *"Panel hostname has NO LE cert at `/etc/letsencrypt/live/mail1.<ns_domain>/`. (Bigger architectural gap)"*. Reality on P20-S1 (verified by both v1 and v2-Phase-0):

- `/etc/letsencrypt/live/` does not exist (HestiaCP doesn't use the certbot directory layout).
- `/usr/local/hestia/ssl/certificate.crt` exists with CN=`mail1.krogermedianetwork.info`, single SAN, issuer=R13, notAfter=2026-07-24. This is the **Hestia panel cert** (used by the panel UI on :8083).
- `/home/admin/conf/web/mail1.krogermedianetwork.info/ssl/mail1.krogermedianetwork.info.pem` exists and is what nginx serves for SNI=`mail1.<ns>` on :443 (per `nginx -T` lines 1126-1131). This is the **per-vhost LE cert**.
- Both certs are valid LE-issued.

**Correction applied**: do NOT halt on the `/etc/letsencrypt/` check. Panel-hostname cert verification path is `/home/admin/conf/web/mail1.<ns>/ssl/mail1.<ns>.pem` (or read it from nginx's loaded config). The substantive question — does the panel hostname have a valid LE cert that nginx serves on :443? — is YES, and the dedicated vhost SNI works.

### Drift #2 — nginx default vhost vs. dedicated `mail1.<ns>` vhost

v1's HALT report recommended (line 200-202): *"Add `location /admin/send { proxy_pass http://127.0.0.1:8825; }` to the default nginx vhost (not per-domain), via Hestia's `default.stpl` custom override or a `/etc/nginx/conf.d/dashboard-sidecar.conf` drop-in."* — under the assumption that `mail1.<ns>` would fall through to default `_`.

v2-Phase-0 verified that's not the case: `mail1.<ns>` has a dedicated nginx vhost (`/home/admin/conf/web/mail1.<ns>/nginx.ssl.conf`) and a dedicated LE cert. The dedicated vhost ends with `include .../nginx.ssl.conf_*;` — Hestia's documented per-vhost extension point that survives `v-rebuild-web-domains`.

**Correction applied**: inject the location block via `/home/admin/conf/web/mail1.<ns>/nginx.ssl.conf_sidecar` (NOT the default vhost, NOT a global `/etc/nginx/conf.d/` drop-in). Smaller blast radius, Hestia-native, scoped to the panel hostname only.

## v1 baseline reused (not re-pulled in full this session)

v1's `/Users/deanhofer/.../unruffled-herschel-a1e28b/reports/2026-05-01-sidecar-canary-p20s1-HALT.md` records (verified, still current):

- P20: `pair_id=cbc887de-4b86-49aa-a233-08958a7a03ae`, `ns_domain=krogermedianetwork.info`, `s1_ip=173.255.199.209`, `s1_hostname=mail1.krogermedianetwork.info`.
- 9 sending domains: krogeradpartners.info, krogerads.info, krogeradsuite.info, krogerbrandcentral.info, krogerbrandimpact.info, krogerbrandnetwork.info, krogerlocalads.info, krogermediapartners.info, krogerpartnerportal.info.
- 27 `email_accounts` rows / 2 active (`debra.flowers@krogeradsuite.info` on S1, `stephanie.greer@krogerlocalads.info` on S2) / 25 disabled.
- DB-side `org_id` = `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (the wrong-by-3-chars value, see §0.9 below).
- P20-S1 OS Ubuntu 22.04.5; Apache 2.4.66 backend on 8080 only; nginx public on :80 + :443; Exim 4.95; Hestia 1.9.4; Node ABSENT (apt install needed); LE certs in HestiaCP path.

Worker (this session): HEAD `598dea2`, branch `main`, systemctl=active, last restart 2026-05-01 15:30 CEST. PR #40 (docs-only) on `main` post-`598dea2`; worker doesn't need a pull.

## P20-S1 capability — Phase 0.3 + 0.4 (NEW evidence)

### Cert layout (the real one)

```
/usr/local/hestia/ssl/certificate.crt:
  CN=mail1.krogermedianetwork.info, issuer=Let's Encrypt R13, valid 2026-04-25 → 2026-07-24
  Single SAN: DNS:mail1.krogermedianetwork.info
  Owner: Debian-exim:mail (used by Hestia panel on :8083, also referenced by exim for outbound TLS)

/home/admin/conf/web/mail1.krogermedianetwork.info/ssl/:
  mail1.krogermedianetwork.info.pem (cert)
  mail1.krogermedianetwork.info.key (key)
  Per-vhost cert, what nginx serves for SNI=mail1.<ns> on :443
```

### nginx :443 vhost layout (verified via `nginx -T`)

- 6 sending-domain web vhosts: krogeradpartners, krogerads, krogeradsuite, krogerbrandcentral, krogerbrandimpact, krogermedianetwork (all with per-domain certs, single-SAN apex per HL #104 on this deployment — no `mail.` SAN).
- 1 panel-hostname vhost: `mail1.krogermedianetwork.info` (own server_name, own cert, own config dir).
- 1 webmail vhost per sending domain (e.g. `webmail.krogeradpartners.info mail.krogeradpartners.info` — uses cert from `/home/admin/conf/mail/<dom>/ssl/`).
- 1 default vhost: `server_name _` on `173.255.199.209:443 default_server`, uses `/usr/local/hestia/ssl/certificate.crt`.

### Hestia-survival hook for the `mail1.<ns>` vhost

The vhost config ends with:
```
    include /home/admin/conf/web/mail1.krogermedianetwork.info/nginx.ssl.conf_*;
```

This `_*` glob is the Hestia-documented per-vhost extension. Files matching this pattern are included on every nginx reload. Hestia's `v-rebuild-web-domains` regenerates `nginx.ssl.conf` itself but does NOT touch `nginx.ssl.conf_<custom>` files. We will create exactly one file: **`/home/admin/conf/web/mail1.krogermedianetwork.info/nginx.ssl.conf_sidecar`**.

### Listening ports (`ss -tlnp`)

```
:22  sshd
:25  exim4
173.255.199.209:80   nginx
173.255.199.209:443  nginx
173.255.199.209:8080 apache2  (HestiaCP backend)
```

Sidecar will bind 127.0.0.1:8825 — port FREE.

## Phase 0.5 — DNS pre-baseline (for Probe 8 diff)

```
mail1.krogermedianetwork.info. 14400 IN A 173.255.199.209

krogeradpartners.info.    14400 IN A 173.255.199.209
krogerads.info.           14400 IN A 173.255.199.209
krogeradsuite.info.       14400 IN A 173.255.199.209
krogerbrandcentral.info.  14400 IN A 173.255.199.209

krogermedianetwork.info.  14400 IN MX  10 mail1.krogermedianetwork.info.
krogermedianetwork.info.  14400 IN MX   0 mail.krogermedianetwork.info.
krogeradpartners.info.    14400 IN MX   0 mail.krogeradpartners.info.
krogeradpartners.info.    14400 IN MX  10 mail1.krogeradpartners.info.
krogerads.info.           14400 IN MX   0 mail.krogerads.info.
krogerads.info.           14400 IN MX  10 mail1.krogerads.info.
krogeradsuite.info.       14400 IN MX   0 mail.krogeradsuite.info.
krogeradsuite.info.       14400 IN MX  10 mail1.krogeradsuite.info.
krogerbrandcentral.info.  14400 IN MX   0 mail.krogerbrandcentral.info.
krogerbrandcentral.info.  14400 IN MX  10 mail1.krogerbrandcentral.info.

SPF (4 sending domains): "v=spf1 ip4:173.255.199.209 -all"
```

Phase 6 / Probe 8 will re-run the same dig commands and assert byte-identical (modulo TTL countdown, which is acceptable per "byte-identical or only timestamp differences" rule).

MXToolbox check via `tools/verify-zone.sh` deferred to Phase 5a (executes at canary deploy time; the static DNS state above is the binary input MXToolbox queries, so its result is determined by these records — but a full `verify-zone.sh` run captures TLS/SOA/DKIM signals that DNS alone doesn't).

## Phase 0.8 — 3 distinct mailboxes from 3 sending domains on S1

Hestia mail-domain inventory on S1 (`v-list-mail-accounts admin <domain>`):

| Sending domain | Hestia mail-domain present | Mailboxes (3 each) | DKIM key (`/home/admin/conf/mail/<d>/dkim.pem`) |
|---|---|---|---|
| krogeradpartners.info | YES | adam.shaw, andrew.miller, angela.murphy | YES |
| krogerads.info | YES | anthony.hunt, arthur.powell, brian.matthews | YES |
| krogeradsuite.info | YES | brian.morgan, daniel.collins, **debra.flowers** (active) | YES |
| krogerbrandcentral.info | YES | debra.joyce, debra.price, douglas.ryan | YES |
| krogerbrandimpact.info | YES | gerald.murphy, jennifer.lee, jessica.robertson | YES |
| krogerbrandnetwork.info | NO ("doesn't exist") | — | — |
| krogerlocalads.info | NO | — | — |
| krogermediapartners.info | NO | — | — |
| krogerpartnerportal.info | NO | — | — |

So S1 actually owns 5 sending-domain mailboxes (15 total accounts), not 9 — the other 4 are mail-side on S2 only (matches v1's "4 of 9 sending domains have NO web vhost" finding).

**Picked 3 distinct sending domains for Phase 5a curl smoke**:

- `$SMOKE_DOMAIN_1 = krogeradpartners.info` ; `$SMOKE_ACCT_1_FROM = adam.shaw@krogeradpartners.info`
- `$SMOKE_DOMAIN_2 = krogerads.info` ; `$SMOKE_ACCT_2_FROM = anthony.hunt@krogerads.info`
- `$SMOKE_DOMAIN_3 = krogerbrandcentral.info` ; `$SMOKE_ACCT_3_FROM = debra.joyce@krogerbrandcentral.info`

**Reserved for Phase 5b worker-integration smoke**: `debra.flowers@krogeradsuite.info` (the only S1-active dashboard email_account; `account_id` to be looked up at Phase 1 time and set as `USE_PANEL_SIDECAR_ACCOUNT_IDS`). 4th distinct domain ⇒ Probe 6 sees 4 different `header.d=` / `header.from=` / `smtp.mailfrom=` values, satisfying Dean's per-domain isolation directive.

All 4 picked domains have DKIM keys present in Hestia config — Exim will sign each outbound message with the From-domain's own key.

## Phase 0.9 — Org_id discrepancy resolved

Tested via Clerk API:

```
GET /v1/organizations/org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q  (DB value, digit-zero "O0q")
  → HTTP 404, {"errors":[{"code":"resource_not_found"}]}

GET /v1/organizations/org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq  (memory value, capital-O "OOq")
  → HTTP 200, {"object":"organization","id":"org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq","name":"StealthMail",...}
```

**Conclusion**: memory (`reference_credentials.md:69` + `MEMORY.md` 2026-04-29 audit entry) is correct. The DB has stale `org_id` values. Same DB-side staleness is presumably present on every row that references the StealthMail org (`server_pairs.org_id`, `email_accounts.org_id`, `ssh_credentials.org_id`, etc.).

**Not auto-fixing** in this session (memory-ownership rule, plus blast radius — touching org_id on every row is its own mini-audit). Surface to V9 as a side-finding for an org_id-reconciliation session.

## Files to create / modify (Phase 1 plan)

### New files (5)

1. **`dashboard-app/panel-sidecar/index.mjs`** (~150-200 LOC) — Node `http` + `crypto`, no deps. Listens 127.0.0.1:8825. Endpoints: `POST /admin/send` (HMAC-verified, IP-allowlisted, body=raw RFC 5322; pipes to `exim -bm -i -t` then returns Exim queue ID + Message-ID parsed from output), `GET /admin/health` (returns `{status:"ok",version,uptime}`).
2. **`dashboard-app/panel-sidecar/dashboard-panel-sidecar.service`** — systemd unit, `User=root` (needs to invoke exim with arbitrary From — exim's local-bsmtp protocol requires trusted user), `Restart=on-failure`, EnvironmentFile=`/opt/dashboard-panel-sidecar/.env`.
3. **`dashboard-app/panel-sidecar/install-nginx-vhost.sh`** — drops `nginx.ssl.conf_sidecar` into `/home/admin/conf/web/$1/`, runs `nginx -t`, runs `systemctl reload nginx`. Idempotent (re-running overwrites the file, no-ops if already correct).
4. **`dashboard-app/panel-sidecar/uninstall-nginx-vhost.sh`** — removes `nginx.ssl.conf_sidecar`, `nginx -t`, `systemctl reload nginx`.
5. **`dashboard-app/src/lib/email/__tests__/smtp-manager-sidecar.test.ts`** — vitest, ~5 cases.

### Modified files (3)

1. **`dashboard-app/src/lib/email/smtp-manager.ts`** (+~60 LOC, 128→~190 LOC). Adds:
   - `interface SmtpAccount { ..., id?: string }` — extended (optional for backward compat).
   - `shouldUseSidecar(accountId: string | undefined): boolean` — checks `process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS` comma-separated list. Returns false if env empty or accountId not in list. Empty default = legacy path = canary OFF.
   - `resolvePanelHostname(account: SmtpAccount): Promise<string|null>` — single Supabase REST query: `server_pairs?or=(s1_ip.eq.<host>,s2_ip.eq.<host>)&select=s1_hostname,s2_hostname,s1_ip,s2_ip` and pick the matching side. Caches forever per process (panel hostnames don't change).
   - `sidecarSend(account, fromAddress, raw, envelope): Promise<SendResult>` — POSTs to `https://${panelHostname}/admin/send` with HMAC-SHA256 over `timestamp.body`, headers `X-Sidecar-Timestamp`, `X-Sidecar-Signature`, body=raw RFC 5322.
   - `sendEmail` rewritten to either: (a) build raw via `nodemailer.compose()` + `MailComposer.compile().build()` then `sidecarSend`, or (b) legacy `transporter.sendMail`. Branch on `shouldUseSidecar(account.id)`.
2. **`dashboard-app/src/worker/handlers/process-sequence-step.ts`** (~1 line) — pass `account.id` into `sendEmail` (extends the `SmtpAccount` arg with `id`). Same for **`send-email.ts`** and **`src/app/api/inbox/threads/[threadId]/reply/route.ts`** (3 callers).
3. **`dashboard-app/package.json`** (no changes — `nodemailer` already imported; `MailComposer` is from `nodemailer/lib/mail-composer` — built in).

### Tests

`smtp-manager-sidecar.test.ts` covers:
1. `shouldUseSidecar(undefined)` returns false.
2. `shouldUseSidecar("a")` with env empty returns false.
3. `shouldUseSidecar("a")` with env=`a,b,c` returns true.
4. `shouldUseSidecar("z")` with env=`a,b,c` returns false.
5. URL derivation: mock `resolvePanelHostname` returns `mail1.krogermedianetwork.info` → URL is `https://mail1.krogermedianetwork.info/admin/send`.
6. HMAC: timestamp + body → SHA256 hex, header parse symmetric.
7. Source-grep: `smtp-manager.ts` contains `mail1.${` pattern (panel hostname), does NOT contain `mail.${sendingDomain}` pattern (defense against the v1 design that's no longer in scope).

Wired into `test:gate0` via existing test glob.

### nginx.ssl.conf_sidecar (the file dropped on the panel)

```nginx
location = /admin/send {
    proxy_pass http://127.0.0.1:8825/admin/send;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 30s;
    client_max_body_size 10m;
}
location = /admin/health {
    proxy_pass http://127.0.0.1:8825/admin/health;
    proxy_read_timeout 5s;
}
```

The `=` modifier makes these exact-match locations, more specific than the existing `location /` regex — so they take precedence over the Apache-backend proxy.

## Phase 5 smoke probe plan (8 probes)

| # | Probe | What it verifies | Pass criteria |
|---|---|---|---|
| 1 | HTTPS reachable | `curl -sk https://mail1.<ns>/admin/health` from Mac | HTTP 200 + `{status:"ok"}` |
| 2 | HMAC enforced | Same curl with no/bad signature | HTTP 401 |
| 3 | IP allowlist | `curl` from Mac (not in allowlist) with valid HMAC | HTTP 403 |
| 3.5 | 3-account direct curl from worker | 3 sends from 3 panel-side accounts → wealthywinners500@gmail.com | All 3 mainlog `<=` lines clean (P=local-bsmtp, no worker IP); all 3 mainlog `=>` lines show DKIM=$correct_domain |
| 4 | Control leak (legacy SMTP path) | 1 send from `debra.flowers` via worker pre-flag-flip | mainlog `<=` line contains worker IP/HELO/esmtpsa (proves the leak we're fixing exists) |
| 5 | Post-flip clean | 1 send from `debra.flowers` via worker post-flag-flip | mainlog `<=` clean (P=local-bsmtp); `=>` shows DKIM=krogeradsuite.info |
| 6 | Gmail headers + per-domain alignment | IMAP-fetch the 4 received messages from wealthywinners500@gmail.com | Each msg: 0 Received lines containing 200.234.226.226; Authentication-Results aligned with sending domain (4 different domains, all dkim/spf/dmarc=pass) |
| 7 | MXToolbox post-state | Re-run `tools/verify-zone.sh` for nsDomain + 4 sending domains | Byte-identical to §0.5 baseline |
| 8 | DNS post-state | Re-run dig for nsDomain + sending domains | Byte-identical |

**Auto-rollback triggers**: FAIL on probes 1, 2, 3, 3.5, 4, 5, 7, or 8. Probe 6 DEFER allowed if IMAP creds for wealthywinners500@gmail.com aren't accessible (not auto-rollback).

## Auto-rollback runbook (Phase 5c)

```bash
# Worker side (revert flag): single env-file restore + service restart
ssh root@200.234.226.226 'cd /opt/dashboard-worker && \
  mv .env.bak.cc5a .env && \
  systemctl restart dashboard-worker && \
  sleep 5 && \
  systemctl is-active dashboard-worker'

# Panel side (stop sidecar + remove nginx config)
ENC_PASSWORD=... node /tmp/cc5a-v2-ssh.mjs 173.255.199.209 <<'EOF'
systemctl stop dashboard-panel-sidecar
systemctl disable dashboard-panel-sidecar
rm /home/admin/conf/web/mail1.krogermedianetwork.info/nginx.ssl.conf_sidecar
nginx -t && systemctl reload nginx
EOF
```

PR stays merged (dormant code; flag-default-OFF means no traffic to the sidecar). Auto-rollback restores worker to pre-flip state byte-identically (the .env.bak.cc5a → .env mv).

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Node `apt install nodejs` blocked or fails on panel | Low | Node-via-snap fallback documented in Phase 1; alternative is to ship sidecar as pre-built binary (deno/bun compile) — out of scope unless apt fails. |
| MailComposer raw bytes don't match nodemailer's wire-format on edge cases (multipart, attachments) | Low (smoke uses plain text/html) | Phase 5a + 5b smoke uses simple text+html; production rollout (CC #5c) tests broader corpus. |
| Sidecar `exim -bm -t -i` doesn't return queue ID on stdout (different exim invocation) | Low | Phase 1 verifies via SSH dry-run; falls back to `exim -bs` if needed; queue ID parsing has defensive logic. |
| Hestia rebuild silently overwrites our `_sidecar` file | Very low | Documented per-vhost `_*` glob is exactly the supported extension point; verified in Hestia 1.9.4 default.tpl line 56. |
| `mail1.<ns>` cert expires mid-canary (notAfter=2026-07-24) | Very low (3+ months) | Hestia auto-renewal handles this; same path as today, no sidecar change needed at renewal. |
| Worker IP `200.234.226.226` change without sidecar IP-allowlist update | Low | Allowlist already includes `172.104.219.185` (cold-send-worker-01, Phase 6A target); only one IP transition expected. |
| Probe 6 DEFER cascades — never get the per-domain alignment proof | Medium (if no IMAP creds) | Probe 5 + 5b3 mainlog `=>` lines are sufficient evidence at the Exim DKIM-signing layer; Probe 6 extends to receiving-MX layer but is not the gate. |

## NO-GO compliance plan

To be re-asserted in deploy report; this design respects:

- No `src/lib/provisioning/` modifications (saga F-24 invariant).
- No `src/worker/handlers/provision-*` / `pair-verify` / `rollback-*` modifications.
- No `dashboard-app/.gitignore` or `dashboard-app/src/lib/provisioning/serverless-steps.ts` modifications.
- No DNS modifications.
- No public ports added (sidecar 127.0.0.1; nginx :443 already public).
- No LE cert reissuance.
- No Exim main config / Hestia v-* CLI / firewall changes.
- No `email_accounts.status` updates.
- No migrations.
- No campaign send / `process-sequence-step` enqueue.

## Side-findings (V9 triage queue)

1. **Stale DB org_id** — every Supabase row referencing StealthMail org currently has `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q` (digit). Canonical (per Clerk API) is `org_3C2CaQuMSFDyZ9wTXmvFRGPoOOq` (capital-O). Likely impact: nothing functionally broken because dashboard uses the value found in DB, but Clerk membership lookups would 404 if any code path queries Clerk by DB-derived org_id. No autonomous fix here; queue for an org_id-reconciliation session.

2. **4 sending domains with no Hestia mail-domain on S1** — krogerbrandnetwork.info, krogerlocalads.info, krogermediapartners.info, krogerpartnerportal.info. Confirmed v1's "no web vhost" finding extends to mail-domain too. Pre-existing state from provisioning; not blocking canary. CC #5b expansion to S2 would surface whether they exist on S2 (v1 found at least krogerlocalads.info exists on S2 because stephanie.greer is active there).

3. **v2 prompt internal inconsistency** — v2 §0.3's HALT condition (`/etc/letsencrypt/live/`) didn't internalize v1's HL #104-clarification that this deployment uses HestiaCP-native cert paths. Suggested v3 prompt update: replace `/etc/letsencrypt/live/mail1.<ns>/` with `/home/admin/conf/web/mail1.<ns>/ssl/` (or read from nginx -T loaded config), and treat `/etc/letsencrypt/` absence as expected, not as HALT.

## What changes in Phase 1+ if Dean greenlights

1. Phase 1: write the 5 new files + edit 3 existing per §"Files to create/modify" above. Local typecheck + build + test:gate0 + saga-isolation grep.
2. Phase 2-3: as planned — tests + verify gates green.
3. Phase 4: PR + auto-merge (Dean's locked decision #10). Flag-default-OFF means merge ships dormant code.
4. Phase 5: SCP sidecar to panel; `apt install nodejs npm`; install systemd unit; drop `nginx.ssl.conf_sidecar`; reload nginx; run probes 1-3 (sidecar local), 3.5 (3 direct-curl multi-account), 4 (control leak via legacy), 5b (worker flag flip), 5b.3 (post-flip clean), 6 (Gmail headers IF IMAP available), 7-8 (MXToolbox + DNS pre/post diff). Auto-rollback on FAIL.
5. Phase 6-7: deploy report at `dashboard-app/reports/2026-05-01-sidecar-canary-p20s1-v2-deploy.md`; MEMORY.md ≤8-line dated append.

## Phase 0 evidence preserved

- `/tmp/cc5a-v2-ssh.mjs` — SSH-with-decrypted-password helper (uses ENCRYPTION_KEY + SUPABASE_KEY from env, no secrets to disk).
- `/tmp/cc5a-v2-probes.sh` — Phase 0.3+0.4+0.6+0.8 batch.
- `/tmp/cc5a-v2-probes2.sh` — nginx vhost + Hestia hook follow-up.
- `/tmp/clerk_dbval.json`, `/tmp/clerk_memval.json` — Clerk API responses for §0.9.
- This design doc.

These are session-local; reproducible by re-running the unblock pattern.

## One-line summary

Phase 0 GREEN with 2 v2-prompt-spec corrections (cert path + per-vhost vs default vhost) + 1 V9 side-finding (stale DB org_id) + 3 distinct mailboxes picked + DNS pre-baseline captured + Hestia-survival hook nailed down. Worker on `598dea2`, P20-S1 panel-hostname cert valid through 2026-07-24, mail1.<ns> dedicated nginx vhost confirmed. **Ready for Phase 1 implementation.**
