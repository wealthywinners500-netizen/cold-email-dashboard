# Sync-inbox fix — summary

**Branch:** `fix/sync-inbox-silent-fail-2026-04-29`
**PR:** [https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/23](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/23)
**Commits:** `3ca5dd9` fix → `d4ad69c` test → `ae54462` exception report
**Status:** open, unmerged, awaiting Dean review.

## 1. Root cause

`syncAccount` in [`src/lib/email/imap-sync.ts`](../src/lib/email/imap-sync.ts) constructed `new ImapFlow({ host, port, secure, auth })` with no `tls.servername` option. `email_accounts.imap_host` for every Linode-saga pair is the IPv4 address (only legacy P2 Clouding rows are hostname-form). The Let's Encrypt cert at port 993 has only `DNS:` SANs (CN=`mail{1|2}.<ns_domain>`, no `IP:` SAN). Without an explicit SNI servername, Node's `tls.checkServerIdentity` validates the IP literal against the SAN list and rejects every connection with the verbatim error captured from `journalctl -u dashboard-worker` on 200.234.226.226:

```
[IMAP] Error syncing deborah.patel@cereno.info: Hostname/IP does not match certificate's altnames: IP: 69.164.213.37 is not in the cert's list:
```

The error is thrown out of `client.connect()` on line 109 (post-fix; line 71 pre-fix), before `getMailboxLock`, before any fetch loop, and **before** the `sync_state` persist on imap-sync.ts:284 — which exactly matches the data-side observation in [`reports/2026-04-29-worker-state-diagnostic.md`](2026-04-29-worker-state-diagnostic.md) §4.1: `email_accounts.sync_state={}` for **all** 258 active rows. Every `*/5` cron firing produced ~258 of these throws. None landed in `system_alerts` because the catch in `syncAllAccounts` only called `console.error`; the existing `handleImapError` helper at [`src/lib/email/error-handler.ts:136`](../src/lib/email/error-handler.ts#L136) was never invoked.

## 2. Fix description

| File | Change | Δ | Commit |
|---|---|---|---|
| [`src/lib/email/imap-sync.ts`](../src/lib/email/imap-sync.ts) | Added `resolveImapServername(imapHost, pair)` helper. Switched `syncAccount`'s SELECT to join `server_pairs(s1_ip, s1_hostname, s2_ip, s2_hostname)` and pass `tls: servername ? { servername } : undefined` to ImapFlow. Wired `handleImapError(err, accountId, orgId)` into `syncAllAccounts`'s catch so per-account failures surface to `system_alerts` + `email_accounts.last_error_at`. | +52 / −4 | `3ca5dd9` |
| [`src/lib/email/__tests__/imap-sync-servername.test.ts`](../src/lib/email/__tests__/imap-sync-servername.test.ts) | New regression test (8 assertions, no Supabase / network / imapflow). | +137 / 0 | `d4ad69c` |
| [`package.json`](../package.json) | Added the new test to `test:gate0` (24 → 25 suites). | +1 / −1 | `d4ad69c` |
| [`reports/2026-04-29-sync-inbox-exception.md`](2026-04-29-sync-inbox-exception.md) | Verbatim journalctl evidence, cert SAN probe, IP→hostname inventory, surfacing analysis. | +81 / 0 | `ae54462` |

Total: 4 files, +271 / −5. Zero saga-territory edits (verified post-commit by `dbl-resweep-saga-isolation.test.ts`).

## 3. Tests added

[`src/lib/email/__tests__/imap-sync-servername.test.ts`](../src/lib/email/__tests__/imap-sync-servername.test.ts) — 8 assertions:

1. **S1 IP → s1_hostname** — the fix path for half the live failures.
2. **S2 IP → s2_hostname** — the live-failure case from the journal (e.g. `45.79.111.103` → `mail2.lavine.info`).
3. **Hostname-form `imap_host` passes through** — covers the legacy P2 Clouding rows.
4. **Null `imap_host` → undefined** — caller's existing skip path stays intact.
5. **IP not matching either pair side → undefined** — defensive: no false hostname is invented.
6. **Pair = null/undefined → undefined** — orphaned `email_accounts` row (server_pair_id NULL) does not crash.
7. **Partially-populated pair (`s1_hostname` NULL on the matching side) → undefined** — defensive against partial saga writes.
8. **Hostname containing digits not regex-misclassified as IPv4** — pins the IPv4 regex boundary.

Pre-fix the export does not exist; the test fails with a module-load error (acceptable evidence given the harness blocked `git stash` for non-destructive pre-fix verification).

## 4. Pre-deploy verification

Run inside the worktree, post-commit:

| Gate | Command | Result |
|---|---|---|
| Unit tests | `npm run test:gate0` | **25/25 PASS** (24 prior + 1 new) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| Production build | `npm run build` | **all routes built**, only the benign "Next.js inferred your workspace root" warning |
| Saga-isolation invariant | `tsx src/__tests__/dbl-resweep-saga-isolation.test.ts` | PASS — base=origin/main, files-changed=4, zero forbidden |

Live state on the worker (read-only, pre-deploy):

| Probe | Result |
|---|---|
| `git rev-parse HEAD` on 200.234.226.226 | `00b3260de60e3df27e8140e424b7664f4700a5d0` |
| `git branch --show-current` | `main` |
| `systemctl status dashboard-worker` | `active (running) since Mon 2026-04-27 20:33:06 CEST` |
| `journalctl ... grep "Hostname/IP"` | every cron tick produces ~258 of these; first occurrence is the start of the systemd unit (limited retention prevents seeing back to 04-09, but `inbox_threads.created_at` proves sync stopped on 04-09) |
| `openssl s_client -connect 45.79.111.103:993` | `Subject: CN=mail2.lavine.info`; SAN list is one `DNS:mail2.lavine.info` entry; **zero `IP:` SAN entries** |
| `inbox_messages` count | 0 (per diagnostic §4.1) |
| `email_accounts.sync_state={}` count | 258 / 258 active (per diagnostic §4.1) |

## 5. Post-deploy verification plan (Dean checks after merge + worker restart)

After Dean merges PR #23 and restarts the worker:

```bash
ssh root@200.234.226.226
cd /opt/dashboard-worker
git fetch && git pull          # pulls the merge commit onto main
systemctl restart dashboard-worker
journalctl -u dashboard-worker -f       # watch for the next */5 cron tick
```

Expected timeline (zero-config, just observe):

| Window | Probe | Expected outcome |
|---|---|---|
| Within 5 min of restart | `inbox_messages` count via Supabase REST `GET /rest/v1/inbox_messages?select=count` | **`> 0`** (currently `0`). 258 accounts × even one new message each on the first sync would dwarf the threshold; in practice many accounts have warm-up / auto-reply traffic since 2026-04-09 sitting unsynced. |
| Within 15 min | `email_accounts.sync_state` populated | **`> 200 / 258`** rows have `sync_state.uidvalidity != null` (the persist at imap-sync.ts:284). The remaining < 58 are accounts with legitimately broken IMAP — those should now show `last_error` / `last_error_at` and `system_alerts.alert_type='imap_error'` rows for them. |
| Within 30 min | `inbox_threads` with `created_at >= 2026-04-29` | **`>= 1`** new thread row, OR `inbox_threads.updated_at >= 2026-04-29` for a row that received a follow-up. |
| Continuous | `journalctl -u dashboard-worker | grep "Hostname/IP does not match"` | **zero new lines** post-restart on accounts whose `server_pair_id` is populated. Any orphan rows (no `server_pair_id`) will still throw, and now correctly flow into `system_alerts`. |

Rollback (only if any of the above fail catastrophically — e.g. the new query shape causes a different exception path):

```bash
git revert <merge-commit-sha>      # on main
git push
ssh root@200.234.226.226 'cd /opt/dashboard-worker && git fetch && git reset --hard origin/main && systemctl restart dashboard-worker'
```

The fix is single-file in the runtime code path. The new `system_alerts` rows that may have been written are append-only — no cleanup required on rollback.

## 6. Bonus finding — separate audit decision

`inbox_threads=157` pre-existing rows from 2026-04-08/09 with `inbox_messages=0` (the threads-without-messages mismatch flagged in the diagnostic §4.4) is **out of scope** for this session. Not deleted, not investigated further. Candidate explanations: a manual `DELETE FROM inbox_messages` that spared `inbox_threads`, an FK CASCADE going one direction only, or a migration that truncated messages. Worth a brief follow-up Cowork session — it explains some "Unibox once worked" lore — but is independent of this fix.

Also noted but **deferred** to separate sessions per the briefing's NO-GO list:

- Linode `96191557` / `cold-send-worker-01` / `172.104.219.185` is still on `phase-6a-worker-split` and still pinging `worker_heartbeats`. Decision (D3 from `feedback_app_actual_state_2026_04_29.md`) needed: fast-forward to `main`, or shut down pending the dedicated send-worker plan.
- Worker box on 200.234.226.226 has ~70 untracked exploration `.mjs` / `.js` files in `/opt/dashboard-worker/`. None modify tracked files. Cleanup is housekeeping, not part of this fix.

## 7. MEMORY.md proposed append (≤ 8 lines, dated)

```
*2026-04-29 — **Sync-inbox silent-failure fix shipped (PR #23 OPEN, UNMERGED).** Root cause: `email_accounts.imap_host` is IP-form for every Linode-saga pair; LE cert at :993 has only DNS: SANs (CN=`mail{1|2}.<ns_domain>`); without `tls.servername` Node rejects with `Hostname/IP does not match certificate's altnames: IP: <ip> is not in the cert's list:` — silent for ~20 days because `syncAllAccounts` catch only called `console.error`, never `handleImapError`. Fix in `src/lib/email/imap-sync.ts`: new `resolveImapServername()` helper joins `server_pairs.s{1,2}_hostname` and passes it as TLS SNI; hostname-form `imap_host` (legacy P2) passes through. Wired `handleImapError` into the catch so per-account failures now write `system_alerts.alert_type=imap_error` + `email_accounts.last_error_at`. Test `src/lib/email/__tests__/imap-sync-servername.test.ts` pins 8 cases; `test:gate0` 24→25 suites. Branch `fix/sync-inbox-silent-fail-2026-04-29`; commits `3ca5dd9` fix / `d4ad69c` test / `ae54462` exception report. Local: 25/25 gate0 PASS, typecheck 0 errors, build clean. Worker on 200.234.226.226 still on `00b3260` pre-fix; Dean merges + `git pull` + `systemctl restart dashboard-worker` after review. Reports: `dashboard-app/reports/2026-04-29-sync-inbox-exception.md` + `dashboard-app/reports/2026-04-29-sync-inbox-fix-summary.md`. Deferred to separate sessions: Linode 96191557 still on `phase-6a-worker-split`, `inbox_threads=157`-without-`inbox_messages` mismatch from 04-08/09. Zero saga edits, zero auto-merge, zero worker restart. **HL #155 candidate confirmed by this incident** — silent failures inside catch blocks that write only to console look like worker-down from REST; always cross-check `system_alerts` + `last_error_at` + heartbeat together.*
```
