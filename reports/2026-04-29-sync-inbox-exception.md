# Sync-inbox exception — verbatim journalctl evidence

**Captured:** 2026-04-29 ~21:50 UTC, via `ssh root@200.234.226.226 'journalctl -u dashboard-worker'`.
**Worker state:** SHA `00b3260de60e3df27e8140e424b7664f4700a5d0` on branch `main`, systemd unit `dashboard-worker.service` `active (running) since Mon 2026-04-27 20:33:06 CEST`. Working tree had ~70 untracked `_pb*.mjs` / `check_*.mjs` / `_st*.mjs` exploration scripts but no modifications to tracked files (`git status --porcelain` shows zero `M` lines, only `??`).

---

## 1. Exception (verbatim, single line — ImapFlow does not emit a stack)

```
[IMAP] Error syncing deborah.patel@cereno.info: Hostname/IP does not match certificate's altnames: IP: 69.164.213.37 is not in the cert's list:
```

The trailing `is not in the cert's list:` ends with an empty list — the cert has zero `IP:` SAN entries. This is the standard Node.js `tls.checkServerIdentity` error string when SNI is empty (or matches the host literal) AND the connection target is an IPv4 address.

## 2. Affected scope — every active account

Single sample of the journal at the most recent `*/5` cron tick (`00:00:11Z` "[Worker] Syncing all email accounts...") shows the same error against **every** account in sequence — different sending domains, different IPs, identical error template. Spot-checks of the IPs that appeared:

```
69.164.213.37  → mail1.launta.info / mail1.caleap.info / mail1.cereno.info  (P13 S1)
198.58.104.12  → mail2.caleong.info  (P11 S2)
97.107.140.162 → mail2.launter.info  (P12 S2)
198.74.52.220  → mail1.launter.info  (P12 S1)
69.164.205.213 → mail1.lavine.info   (P15 S1)
45.79.111.103  → mail2.lavine.info   (P15 S2)
173.255.194.229→ mail1.camire.info   (P14 S1)
74.207.253.34  → mail2.camire.info   (P14 S2)
45.33.27.57    → mail1.mareno.info   (P16 S1)
173.255.246.73 → mail2.mareno.info   (P16 S2)
72.14.178.34   → mail1.cemavo.info   (P17 S1)
45.33.55.13    → mail2.cemavo.info   (P17 S2)
50.116.14.26   → mail2.launta.info   (P13 S2)
```

The `[Worker] Syncing all email accounts...` line at `00:00:11Z` is followed by ~2 errors per second for ~2 minutes, then silence until the next `*/5` tick. Counting unique account-emails in the window confirms it: every active account fails before `imap-sync.ts:247` `sync_state` persist runs.

## 3. First-occurrence timestamp

The systemd unit was last started `Mon 2026-04-27 20:33:06 CEST`, so the journal only retains errors back to that point. The error has been continuous on every `*/5 * * * *` tick since then — every cron firing produces ~258 `Hostname/IP does not match certificate's altnames` lines.

The diagnostic earlier today (`reports/2026-04-29-worker-state-diagnostic.md` §4.1) confirmed `inbox_threads.created_at` last entry is `2026-04-09T04:00:45Z` and `email_accounts.sync_state={}` for **all** 258 active rows — so the silent-failure window started **on or before 2026-04-09** and the regression has been running for ~20 days. The journal cannot prove the exact 04-09 transition because retention is shorter than that; the data side is the durable evidence.

## 4. Cert evidence (verifies hypothesis from probe on the worker box)

```
$ ssh root@200.234.226.226 'echo | openssl s_client -connect 45.79.111.103:993 -servername mail2.lavine.info 2>/dev/null | openssl x509 -noout -text 2>&1 | grep -A 3 -E "Subject:|DNS:|IP Address" | head -30'
        Subject: CN = mail2.lavine.info
                DNS:mail2.lavine.info
```

Subject CN = `mail2.lavine.info`. SAN list = a single `DNS:mail2.lavine.info` entry. **Zero `IP Address:` SAN entries**, which is why `Hostname/IP does not match certificate's altnames: IP: 45.79.111.103 is not in the cert's list:` ends with an empty list.

The cert is valid for the hostname; the mismatch is purely because ImapFlow is connecting to the IP literal and Node's `tls.checkServerIdentity` is comparing the IP against a hostname-only SAN list (and an IP comparison that finds no `IP:` entries at all).

## 5. Root cause

[`src/lib/email/imap-sync.ts:60-69`](../src/lib/email/imap-sync.ts#L60-L69) builds `new ImapFlow({ host: acc.imap_host, port, secure, auth, logger: false })` with **no `tls.servername`** option. Per Node TLS, when `host` is an IP address and no `servername` is set, the SNI extension is omitted, the server returns the default cert anyway, and `checkServerIdentity` validates the IP against the cert's SAN list. Since the cert has only `DNS:` SANs (no `IP:`), validation fails. **The connection error is thrown out of `client.connect()` at line 71**, before `getMailboxLock`, before the fetch loop, and before the `sync_state` persist at line 247 — exactly matching the data-side observation.

`email_accounts.imap_host` for the live data set is **the IPv4 address of the mail server**, not the hostname. The diagnostic noted this: P2 has hostname-form `smtp_host` (the legacy Clouding-era convention), but every other pair's rows are IP-form (the Linode-era convention used by the saga's `worker-callback/route.ts` insert path). All 258 active accounts inherit the IP-form storage and so all 258 hit the same TLS error.

## 6. Why it surfaced on or around 2026-04-09

`inbox_threads` rows from 2026-04-08/09 prove sync DID run successfully then. Hypothesis: the working-tree TLS-validation behavior changed — either an `imapflow` minor-version bump, a Node 18→20 / 20→22 upgrade tightening hostname-vs-IP validation, or a code change that switched `imap_host` from hostname-form to IP-form during the 04-08 → 04-20 PR cluster (PR #10 oracle swap merged 04-20). Verifying the precise trigger is **not required** for the fix — the cert/SAN mismatch is reproducible against the current architecture (per-domain LE certs with `mail{1|2}.<ns_domain>` HELO hostname per HL #102/#104) and the fix is to pass an explicit `tls.servername` derived from `server_pairs.s{1,2}_hostname`.

## 7. Why nothing surfaces in `system_alerts`

`syncAllAccounts` ([`imap-sync.ts:289-294`](../src/lib/email/imap-sync.ts#L289-L294)) catches per-account errors with `console.error(msg); errors.push(msg);` and continues. **It never calls `handleImapError`** — even though the helper exists at [`src/lib/email/error-handler.ts:136-206`](../src/lib/email/error-handler.ts#L136-L206) and would have written:

- `email_accounts.last_error` + `last_error_at` (so the dashboard could surface the failure per-account)
- `system_alerts` row with `alert_type='imap_error'` (so a 30-day grep on `system_alerts` would have shown 258 alerts/cron-tick instead of zero)
- `consecutive_failures` increment + auto-disable at threshold (so accounts would have been visibly disabled rather than silently broken)

This is the HL #155-candidate "stale heartbeat looks like a worker death" pattern in a different shape: **invisible per-account TLS failure looks like sync-not-running**. Both signals point to "ops worker dead" when the actual story is "ops worker alive but every IMAP call fails before persist".

## 8. Fix scope

- **Primary** ([`src/lib/email/imap-sync.ts`](../src/lib/email/imap-sync.ts)): join `server_pairs(s1_ip, s1_hostname, s2_ip, s2_hostname)` in the `syncAccount` fetch, derive the cert-matching hostname from the pair (or accept the existing hostname when `imap_host` is already a hostname), pass it as `tls.servername` to `ImapFlow`.
- **Surfacing** ([`src/lib/email/imap-sync.ts`](../src/lib/email/imap-sync.ts)): wire `handleImapError` into the catch in `syncAllAccounts`, so per-account failures land in `system_alerts` + `email_accounts.last_error_at` instead of `console.error` only.

Both changes are in a single file (one helper plus two short edits). No saga code is touched. No new pg-boss queue or cron is introduced.
