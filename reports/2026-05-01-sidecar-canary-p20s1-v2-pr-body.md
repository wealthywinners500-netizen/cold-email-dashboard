# feat(sidecar): canary panel-sidecar on P20-S1 v2 — Option A URL pivot, nginx, panel hostname cert

**CC #5a v2 (V9, 2026-05-01).** Flag-default-OFF; merge ships dormant code. Canary deployed via Phase 5 SSH after merge.

## Why

V9 CC #3 surfaced a Received-chain leak at `[2026-04-30-campaign-fire-smoke-deploy.md](reports/2026-04-30-campaign-fire-smoke-deploy.md)`:

```
Received: from mail1.partner-with-kroger.info ([200.234.226.226])
        by mx.google.com ...
```

Worker IP + worker HELO is visible to receiving MXs. This couples the worker's identity to every outbound message regardless of which sending domain the From: header carries — defeats per-domain reputation isolation. Dean's directive (locked decision #1): *"IT MUST LOOK LIKE ITS COMING FROM THE EXACT LOCAL SEND OF THE EMAIL ITS COMING FROM. NOTHING SHORT OF THAT."*

This PR ships the worker side of the fix: when a flag-listed account's send is initiated, instead of opening an SMTP+AUTH connection from the worker, the worker compiles the message to RFC 5322, HMAC-signs the body, and POSTs to a panel-side sidecar at `https://mail1.<ns_domain>/admin/send`. The sidecar pipes the raw message to the panel's local Exim via BSMTP submission. Exim signs DKIM with the From-domain's key, generates the queue ID locally, and produces a single Received hop whose mail-server identity is the panel's own hostname. No worker IP / HELO / esmtpsa in the headers.

## v1 → v2 architecture pivot

CC #5a v1 attempted `https://mail.<sending-domain>/admin/send` as the URL pattern and HALTed in Phase 0 against four design mismatches with the live P20 deployment ([v1 HALT report](unruffled-herschel-a1e28b/reports/2026-05-01-sidecar-canary-p20s1-HALT.md)):

1. nginx (not Apache) terminates :443.
2. Per-sending-domain LE certs cover the apex only — no `mail.<sending-domain>` SAN.
3. `mail.<sending-domain>` falls through to nginx's default `_` vhost which 301-redirects POST → http.
4. ≥2 active accounts per domain not satisfiable (max 1 active per domain on P20).

v2 pivots to **Option A**: URL = `https://mail1.<ns_domain>/admin/send`. Smaller blast radius (single panel-hostname vhost, not per-sending-domain), reuses the panel's pre-existing LE cert. Per-domain reputation isolation is preserved at the SMTP/IMAP layer (DKIM/SPF/DMARC config, per-domain MX, per-domain LE cert) — the HTTP control-plane URL is orthogonal to deliverability.

v2 Phase 0 also surfaced two prompt-spec drifts (corrected in [design doc](reports/2026-05-01-sidecar-canary-p20s1-v2-design.md) §"v2 prompt drift"):

- v2 §0.3's HALT path `/etc/letsencrypt/live/mail1.<ns>/` doesn't exist on this Hestia deployment; cert lives at `/home/admin/conf/web/mail1.<ns>/ssl/`. Verified externally: `curl -sk https://mail1.<ns>/admin/health` returns HTTP 404 (not 301-to-http) → SNI hits the dedicated vhost cleanly.
- Injection point is `mail1.<ns>`'s per-vhost `nginx.ssl.conf_*` Hestia-survival hook, not the default `_` vhost or a global `/etc/nginx/conf.d/` drop-in.

## Files

### New (5)
- `panel-sidecar/index.mjs` (180 LOC) — Node `http` + `crypto`, no deps. POST /admin/send (HMAC-verified, IP-allowlisted, body=raw RFC 5322, pipes to `/usr/sbin/exim -bm -i -t`), GET /admin/health.
- `panel-sidecar/dashboard-panel-sidecar.service` — systemd unit. EnvironmentFile=`/opt/dashboard-panel-sidecar/.env`. Hardened (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`).
- `panel-sidecar/nginx.ssl.conf_sidecar` — drop-in for `/home/admin/conf/web/mail1.<ns>/`. Two `location =` exact-match blocks: `/admin/send` + `/admin/health`. Survives `v-rebuild-web-domains` because Hestia's per-vhost template includes `nginx.ssl.conf_*` (verified line 56 of `/usr/local/hestia/data/templates/web/nginx/default.tpl`).
- `panel-sidecar/install-nginx-vhost.sh` — copies the conf, runs `nginx -t`, reloads. Idempotent.
- `panel-sidecar/uninstall-nginx-vhost.sh` — reverse. Used by Phase 5c auto-rollback.
- `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` (160 LOC, 13 cases) — shouldUseSidecar flag-list parsing, HMAC computation symmetry, MailComposer RFC 5322 round-trip, source-grep guards (URL built from panelHostname, legacy `mail.<sending-domain>` pattern absent).

### Modified (3)
- `src/lib/email/smtp-manager.ts` (128 → 226 LOC) — adds `shouldUseSidecar`, `resolvePanelHostname` (Supabase REST query against `server_pairs.s{1,2}_{ip,hostname}`, cached per process), `composeRaw`, `sidecarSend`. `sendEmail` branches on flag; legacy nodemailer path untouched. Adds optional `id?: string` field to `SmtpAccount`.
- `src/app/api/inbox/threads/[threadId]/reply/route.ts` — passes `id: account.id` so Unibox replies are flag-eligible (currently won't trigger because `USE_PANEL_SIDECAR_ACCOUNT_IDS` empty default).
- `package.json` — appends `tsx src/lib/email/__tests__/smtp-manager-sidecar.test.ts` to `test:gate0` chain (38 → 39 suites).

## Flag-default-OFF guarantee

`shouldUseSidecar(account.id)` returns `false` when `USE_PANEL_SIDECAR_ACCOUNT_IDS` is empty. `process-sequence-step.ts`, `send-email.ts`, and the inbox reply route all funnel through `sendEmail`, which preserves the existing nodemailer code path bit-for-bit when the flag is OFF. Merging this PR ships zero behavior change on `main` until Phase 5 sets the env var on the worker.

## Auto-rollback plan

Phase 5c (executed if any of probes 1, 2, 3, 3.5, 4, 5, 7, 8 fails):

```bash
# Worker side: env-file restore + restart (1 SSH)
ssh root@200.234.226.226 'cd /opt/dashboard-worker && \
  mv .env.bak.cc5a .env && systemctl restart dashboard-worker'

# Panel side: stop sidecar + remove nginx config (1 SSH via decrypted-password unblock)
systemctl stop dashboard-panel-sidecar
systemctl disable dashboard-panel-sidecar
bash /opt/dashboard-panel-sidecar/uninstall-nginx-vhost.sh mail1.krogermedianetwork.info
```

Merged code stays on main (dormant). No revert PR needed for canary failure — the flag-default-OFF gate is the rollback mechanism.

## NO-GO compliance

- Saga-isolation grep (`git diff main --stat | grep provisioning`): EMPTY.
- `dashboard-app/.gitignore` + `serverless-steps.ts`: untouched.
- No DNS modifications; no LE cert reissuance; no Exim main-config or Hestia v-* CLI changes.
- No public ports added.
- No `email_accounts.status` updates.
- No campaign send / `process-sequence-step` enqueue.
- No `git add -A` / `git add .` — files staged explicitly.

## Local verify (pre-PR)

- `npx tsc --noEmit`: 0 errors.
- `npm run build`: clean.
- `npm run test:gate0`: 39/39 suites GREEN (the 13-case sidecar suite + the existing 38).
- saga-isolation grep: empty.

## Phase 5 deploy plan (post-merge)

Per [design doc](reports/2026-05-01-sidecar-canary-p20s1-v2-design.md) §"Phase 5 smoke probe plan". 8 probes; 3 panel-side direct-curl sends from 3 distinct sending domains (krogeradpartners.info / krogerads.info / krogerbrandcentral.info) + 1 control-leak send via legacy SMTP path + 1 worker-integration send via debra.flowers@krogeradsuite.info post-flag-flip. Smoke target: wealthywinners500@gmail.com (Dean's gmail). MXToolbox + DNS pre/post diff invariant.

## Test plan
- [ ] Phase 5a: sidecar deployed on P20-S1, `systemctl is-active dashboard-panel-sidecar` = active, nginx -t clean.
- [ ] Probe 1: `curl https://mail1.<ns>/admin/health` → HTTP 200.
- [ ] Probes 2 + 3: bad HMAC → 401, off-allowlist IP → 403.
- [ ] Probe 3.5: 3 direct-curl multi-account sends; mainlog `<=` shows `P=local-bsmtp`, no worker IP; `=>` shows DKIM=correct-per-domain (3 different signing domains).
- [ ] Probe 4: pre-flip control send via legacy SMTP confirms mainlog leaks worker IP/HELO/esmtpsa.
- [ ] Probe 5: post-flag-flip worker send via debra.flowers shows clean mainlog `<=` + DKIM=krogeradsuite.info.
- [ ] Probe 6 (deferrable): Gmail headers show 0 `200.234.226.226` Received lines + per-domain dkim/spf/dmarc=pass alignment across 4 messages.
- [ ] Probes 7 + 8: MXToolbox + DNS pre/post byte-identical.
- [ ] Phase 5c auto-rollback wired and verified-callable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
