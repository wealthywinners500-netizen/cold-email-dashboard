# P13 vs P14 Investigation — SOA Saga Divergence

**Author:** Claude Code
**Date:** 2026-04-22 (UTC)
**Task:** Identify why P13 (launta.info) passes MXToolbox 0/0/207 while P14 (savini.info) hits 0/1/208-9 with "SOA Serial Number Format is Invalid", and derive the exact corrective actions for both P14 live state and the saga code.
**Scope:** READ-ONLY investigation. No writes to P13. No writes to P14. No code changes. Evidence only.

---

## 1. Pair identifiers

| Pair | `server_pairs.id`                      | NS domain    | S1 IP          | S2 IP          | `provisioning_job_id`                 | Created (UTC)          |
|------|----------------------------------------|--------------|----------------|----------------|----------------------------------------|------------------------|
| P13  | `79ac33a1-b6e7-4d30-98a7-9302e30061f0` | launta.info  | 69.164.213.37  | 50.116.14.26   | `b920c716-fab6-4d1d-8309-d937cbb9f132` | 2026-04-19T18:06:30Z   |
| P14  | `fbc03039-00db-4b93-b996-da16c1345814` | savini.info  | 45.56.75.67    | 45.79.213.21   | `2fa6ee56-557c-4020-b61b-197e524252bb` | 2026-04-22T00:21:44Z   |

Passwords pulled from `ssh_credentials` and decrypted via `src/lib/provisioning/encryption.ts` AES-256-GCM with `ENCRYPTION_KEY` from `.auto-memory/reference_credentials.md`. Four SSH probes executed (read-only) at 2026-04-22T02:58Z.

## 2. Operational diff table (all measurements at 2026-04-22 03:00–03:05 UTC)

| Dimension                            | P13 (reference)                                            | P14 (target)                                              | Match? | Severity |
|-------------------------------------- |------------------------------------------------------------|-----------------------------------------------------------|:------:|:--------:|
| OS / Hestia                          | Ubuntu 22.04 / Hestia 1.9.4                                | Ubuntu 22.04 / Hestia 1.9.4                               | ✓      | n/a      |
| `timedatectl` TZ on S1               | `Etc/UTC (UTC, +0000)`                                     | `Etc/UTC (UTC, +0000)`                                    | ✓      | n/a      |
| `timedatectl` TZ on S2               | `Etc/UTC (UTC, +0000)`                                     | `Etc/UTC (UTC, +0000)`                                    | ✓      | n/a      |
| `/etc/timezone`                      | `Etc/UTC` both servers                                     | `Etc/UTC` both servers                                    | ✓      | n/a      |
| NTP sync                             | active both servers                                        | active both servers                                       | ✓      | n/a      |
| `domain.sh` hardcoded SOA-timer block (`/usr/local/hestia/func/domain.sh:515-522`) | `3600 / 600 / 2419200 / 3600` (PATCHED — HL #107) | `7200 / $refresh / 1209600 / 180` (FACTORY) | **✗**  | **A — KEY DIVERGENCE** |
| `domain.sh` serial-gen algorithm     | Standard Hestia 1.9.4 (`update_domain_serial`, YYYYmmddNN counter, s_date==c_date bumps NN by +1 else resets to `${today}01`) | Identical | ✓      | n/a      |
| `dns-serial/` counter dir            | not present                                                | not present                                               | ✓      | n/a      |
| cron/timers touching DNS serials     | none                                                       | none                                                      | ✓      | n/a      |
| SOA serial (external dig @8.8.8.8) yyyymmdd portion | `20260420` (2 days in the past)                  | `20260422` (today UTC)                                    | **✗**  | **B — operational state** |
| SOA timers live (external dig @8.8.8.8) | `3600 600 2419200 3600` (HL #107)                       | `7200 3600 1209600 180` (factory)                         | **✗**  | **A — consequence of domain.sh divergence** |
| AXFR/NOTIFY working (ns1 serial == ns2 serial) | yes (`dig @S1 == dig @S2` for every zone)        | yes (`dig @S1 == dig @S2` for every zone)                 | ✓      | n/a      |
| `/etc/bind/named.conf.cluster` (slave stanzas) | 6 peer-slave zones on S2, 5 on S1                | 5 peer-slave zones on S2, 6 on S1                         | ✓ (mirrored partition) | n/a |
| per-zone MX pattern                  | `10 mail.{domain}` (post-backfill HL #106)                 | 5 S2-primary zones: `10 mail.{domain}`; 5 S1-primary zones: **both** `0 mail.{d}` + `10 mail1.{d}` (audit §3.3 double-MX) | partial | B — saga hygiene, not MXToolbox-flagged |
| SPF                                  | `v=spf1 ip4:{owner_ip} -all` (HL #45/#50/#128)             | same                                                      | ✓      | n/a      |
| DMARC                                | `v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100` (HL #109 canonical) | same | ✓      | n/a      |
| DKIM                                 | per-zone `mail._domainkey` TXT, `k=rsa` (HL #51)           | per-zone `mail._domainkey` TXT, `k=rsa`                   | ✓      | n/a      |
| NS glue at parent                    | Ionos (legacy)                                             | Namecheap (per `feedback_provider_preferences.md`)        | different-by-design (HL #102+) | n/a |
| MXToolbox Domain Health (UI) result  | 0 Errors / 0 Warnings / ~207 Passed on all 11 zones (2026-04-20 scans)  | 0 Errors / 1 Warning ("SOA Serial Number Format is Invalid") / 208–209 Passed on all 11 zones (2026-04-22 scans) | **✗** | **A — Dean's stated blocker** |
| `operational_blacklist_sweep` (pair-verify) | pass (no operational listings)                      | pass (no operational listings)                            | ✓      | n/a      |

### Live serials sampled at 2026-04-22T03:03:07Z

| P14 zone         | Serial (google) | ns1         | ns2         |
|------------------|-----------------|-------------|-------------|
| savini.info      | 2026042205      | 2026042205  | 2026042205  |
| lauseart.info    | 2026042203      | 2026042203  | 2026042203  |
| mareno.info      | 2026042203      | same        | same        |
| nelina.info      | 2026042203      | same        | same        |
| nelita.info      | 2026042203      | same        | same        |
| segier.info      | 2026042203      | same        | same        |
| slaunter.info    | 2026042205      | same        | same        |
| suleon.info      | 2026042203      | same        | same        |
| suleong.info     | 2026042203      | same        | same        |
| teresi.info      | 2026042203      | same        | same        |
| virina.info      | 2026042203      | same        | same        |

All 11 zones AXFR-consistent (ns1 serial == ns2 serial per zone). All dated `20260422` (today UTC). Counter values: 03 on 9 zones, 05 on savini (NS apex) and slaunter.

| P13 zone         | Serial (google) | Counter | Age         |
|------------------|-----------------|---------|-------------|
| launta.info      | 2026042021      | 21      | 2 days past |
| caleap / carena / cereno / cerone / corina | 2026042013 | 13 | 2 days past |
| larena / seamle / seapot / searely / voility | 2026042006 | 06 | 2 days past |

## 3. Why the CC prompt's original hypotheses were WRONG

The [cc-prompt-soa-serial-fix.md](2026-04-22-cc-prompt-soa-serial-fix.md) from Project 8 asserted two root causes. Both are disproved by direct SSH evidence.

**Prompt assertion A (TZ drift):**
> "P14's Linodes have local timezones ahead of UTC (S1 appears to be UTC+3, S2 appears to be UTC+1), so when zones were rebuilt, the date portion of the serial became tomorrow's UTC date."

**Evidence:** Both P14 Linodes return `Etc/UTC (UTC, +0000)` from `timedatectl` at 2026-04-22T02:58Z. `/etc/timezone` reads `Etc/UTC`. NTP active. **There is no TZ drift.** The saga does not force TZ because the Linode Ubuntu 22.04 image already ships with TZ=UTC, which happens to satisfy the requirement accidentally.

**Prompt assertion B (hour-based serial generator + same-hour collision):**
> "HestiaCP's `/usr/local/hestia/func/domain.sh` generates the SOA serial via `date +%Y%m%d%H` — local time, hour-of-day."

**Evidence:** `grep` against the installed file on all 4 servers shows HestiaCP 1.9.4 uses `date +'%Y%m%d01'` at initial zone creation and a proper YYYYmmddNN counter at `update_domain_serial` (lines 569–588). The algorithm reads the current serial from the zone file, extracts `s_date` (first 8 chars), compares to `c_date=$(date +'%Y%m%d')`, and bumps the 2-digit counter when same-day or resets to `${today}01` when day changes. There is **no `%H` anywhere** in the generator on Hestia 1.9.4. Collision within the same hour does not occur; collisions are only possible when the YYYYmmddNN counter hits 99 (same-day 100th edit).

## 4. The REAL root cause

The actual divergence is a **domain.sh template patch** that was applied to P13 (both servers) during the 2026-04-19/20 operational backfill but was never promoted into the saga. Evidence — inspected lines 515–525 on all 4 servers via SSH:

**P13 S1 (69.164.213.37) `/usr/local/hestia/func/domain.sh:515-525`:**
```
	zn_conf="$HOMEDIR/$user/conf/dns/$domain.db"
	echo "\$TTL $zone_ttl
@    IN    SOA    $SOA.    root.$domain_idn. (
                                            $SERIAL
                                            3600
                                            600
                                            2419200
                                            3600 )
" > $zn_conf
```

**P14 S1 (45.56.75.67) same block — FACTORY values:**
```
	zn_conf="$HOMEDIR/$user/conf/dns/$domain.db"
	echo "\$TTL $zone_ttl
@    IN    SOA    $SOA.    root.$domain_idn. (
                                            $SERIAL
                                            7200
                                            $refresh
                                            1209600
                                            180 )
" > $zn_conf
```

Since `update_domain_zone()` writes the zone file from this template on every zone-touching Hestia CLI call (`v-add-dns-record`, `v-delete-dns-record`, `v-change-dns-domain-soa`, `v-rebuild-dns-domain`, and anything that internally rebuilds like `v-add-letsencrypt-domain` — HL #108), the patched template on P13 causes HL #107 timers to persist through every operation. The factory template on P14 causes factory timers to persist.

The saga at `src/lib/provisioning/hestia-scripts.ts:285–290` attempts to set HL #107 timers via `v-change-dns-domain-soa admin $d ns1.$ns '' 3600 600 2419200 3600` **but HestiaCP 1.9.4's `v-change-dns-domain-soa` signature only accepts `USER DOMAIN SOA [RESTART]` — the timer args are silently ignored** (HL #107 commentary explicitly documents this: "the HestiaCP command signature is actually `USER DOMAIN SOA [RESTART]` — only MNAME + restart flag — the extra timer args are silently ignored"). The `.catch(() => {})` at line 288 further masks any failure of the MNAME-update part of the call. Net effect: the saga's intention to set timers was never realized on any pair; P13 got timers from the separate operational domain.sh patch, P14 did not.

## 5. Why P13 passes MXToolbox and P14 does not

The `SOA Serial Number Format is Invalid` warning fires when MXToolbox UI considers the serial to encode a date that is NOT strictly in the past relative to UTC wall clock. Empirical observations at 2026-04-22T03:05Z:

- `lauseart.info` serial `2026042203` (counter 03, yyyymmdd=today) is **flagged** even though counter 03 <= wall-clock hour 03 — ruling out the "MXToolbox parses last-2 as hour-of-day" theory.
- `savini.info` serial `2026042205` (counter 05, yyyymmdd=today) is flagged.
- `launta.info` serial `2026042021` (counter 21, yyyymmdd=2 days past) is NOT flagged.

Best inference: **MXToolbox's `SOA Serial Number Format is Invalid` check fires when `yyyymmdd >= today_UTC` at the moment of the scan.** A same-day-dated serial looks "just-edited" rather than "historical enough to be a proper versioned serial." P13 satisfies the gate because its serials are frozen at yyyymmdd=20260420 — the backfill wrote them on 2026-04-20 and no subsequent op has touched them. P14 fails because the saga completed at 2026-04-22T00:21:44Z and the zone files still hold today's yyyymmdd.

Implication: the MXToolbox warning on P14 will **self-heal** after the UTC date rolls to 2026-04-23, provided no further DNS activity bumps the serial. But relying on auto-heal is operationally unsound — any cert renewal or follow-up DNS edit before the day rolls resets the serial to `${today}01` or higher. The deterministic fix is to rewrite serials to yesterday-dated (or earlier) values and then freeze the zones against further edits today.

## 6. Saga step-by-step analysis (P14 run)

`provisioning_steps` rows for `job_id=2fa6ee56-557c-4020-b61b-197e524252bb` show all 12 steps completed with no `error_message`:

| # | step_type             | status    | duration | notes |
|---|-----------------------|-----------|----------|-------|
| 1 | create_vps            | completed | 103s     | Linode us-central + us-southeast |
| 2 | install_hestiacp      | completed | 647s     | — |
| 3 | configure_registrar   | completed | 217s     | Namecheap |
| 4 | await_dns_propagation | completed |  11s     | 4/6 parent NS see ns1+ns2 |
| 5 | setup_dns_zones       | completed | 175s     | partition: S1=6, S2=5; AXFR/NOTIFY wired |
| 6 | set_ptr               | completed |  21s     | — |
| 7 | setup_mail_domains    | completed | 279s     | 30 accounts |
| 8 | await_s2_dns          | completed |  15s     | 5/5 resolver converge |
| 9 | security_hardening    | completed | 769s     | 1 LE cert failed (S2 slaunter) — retry later |
| 10 | verification_gate    | completed | 175s     | 13 auto_fixable / 354 |
| 11 | auto_fix             | completed | 123s     | 12 fixed / 0 failed |
| 12 | verification_gate_2  | completed | 176s     | 354/354 PASS |

Of interest: steps that triggered zone-file regen via HestiaCP CLI (and thus bumped the SOA serial counter) include every `v-add-dns-record` in step 5 (setup_dns_zones), step 7 (setup_mail_domains DKIM/SPF/DMARC), step 9 (LE cert issuance), and step 11 auto-fix. Those cumulatively bumped serials from `20260422 01` through `20260422 05` on the most-edited zones (savini, slaunter) and through `20260422 03` on less-edited zones. None of these bumps failed — that's by design — but they all wrote the FACTORY timer template into the zone file because domain.sh was not patched.

The swallowed `.catch(() => {})` at `hestia-scripts.ts:288` is the surface where a diagnostic should have fired. If it had propagated, the saga would have flagged a problem on the very first zone. Since it swallowed, P14 shipped with factory timers silently.

No evidence of manual intervention on P13 via recent git history beyond the documented operational backfill script `scripts/launta-mx-soa-backfill.sh` (which runs `v-change-dns-domain-soa` — same no-op timer args — plus `rndc reload`). That script alone would not have applied the timers either. The P13 domain.sh patch must have been applied out-of-band, likely manually during Session 04d on 2026-04-19/20, and is not tracked in the repo. This is its own hygiene gap (patch-to-server state not reproducible from code) — but for the current task, the immediate remediation is to apply the same patch to P14 via the same out-of-band path, then ingest the patch into the saga.

## 7. Actions required on P14 (live, no code change yet)

1. **Patch `/usr/local/hestia/func/domain.sh` on P14 S1 and P14 S2** — replace the factory `7200 / $refresh / 1209600 / 180` SOA block in `update_domain_zone()` with `3600 / 600 / 2419200 / 3600`. Idempotent: grep for marker before patching. Maintains HL #107 through all future Hestia CLI operations.
2. **For each P14 primary zone (6 on S1, 5 on S2), run `v-change-dns-domain-soa admin $zone ns1.savini.info ''`** — triggers `update_domain_zone()` which rewrites the zone file using the **now-patched** template. Timer args are still silently ignored but the MNAME update path still triggers the zone regen. Serial counter bumps by +1 on each call.
3. **Force AXFR retransfer on peer** for each zone via `rndc retransfer $zone` to avoid NOTIFY-latency window. Verify with `dig @peer_ip SOA $zone`.
4. **Rewrite SOA serial on each zone to yesterday-dated** (yyyymmdd=20260421 + counter in 30–99 range that is strictly greater than current serial's numeric value is not possible since 20260421XX < 20260422XX; instead use `rndc retransfer` as the override mechanism — see §7.4). Mechanism:
   - Direct-edit zone file `$HOMEDIR/admin/conf/dns/$zone.db`, replace the SERIAL line.
   - Also direct-edit HestiaCP metadata `$USER_DATA/dns/$zone.conf` so the next Hestia CLI call doesn't reset the serial to today_yyyymmdd.
   - Run `named-checkzone $zone $HOMEDIR/admin/conf/dns/$zone.db` before replacing the live zone.
   - `rndc reload $zone` on the owning server.
   - `rndc retransfer $zone` on the peer — this bypasses BIND's RFC 1982 serial comparison (which would otherwise reject the lower serial as "older"). Verify peer returns the new serial.
5. **External verification** — `dig @8.8.8.8 SOA $zone` and `dig @1.1.1.1 SOA $zone` must return the new serial.
6. **MXToolbox scan** — all 11 zones must return 0 Errors / 0 Warnings.
7. **`tools/verify-zone.sh` run** — all 11 zones must return FAIL=0 (warnings from expected envelope are OK).

## 8. Actions required in the saga code

1. **Patch `domain.sh` at provisioning time.** In `src/lib/provisioning/hestia-scripts.ts` or in `pair-provisioning-saga.ts` Step 2, after HestiaCP install completes, run an idempotent Python heredoc-based replace of the factory SOA block with HL #107 values on both servers. Marker comment prevents double-patch. Fail the step loudly if the target block isn't found (indicates Hestia version drift).
2. **Un-swallow the `.catch(() => {})` at `src/lib/provisioning/hestia-scripts.ts:288`.** Differentiate between "command not found" (older Hestia without `v-change-dns-domain-soa`) and any other failure. For the "command not found" case, fall back to the direct zone-file SOA edit + metadata update + `rndc reload`. For any other failure, log and fail the step.
3. **Tighten `verification-checks.ts` Check 5 (SOA record validation) so that a same-day or future-dated yyyymmdd triggers `fixAction='fix_soa_serial_format'`.** The current check only validates the `^\d{10}$` shape.
4. **Add `fixSOASerialFormat` auto-fix in `src/lib/provisioning/auto-fix.ts`** that replicates the §7.4 rewrite path.
5. **Add regression tests in `src/lib/provisioning/__tests__/pair-verify.test.ts`** covering: (a) today-dated serial → flagged with `fix_soa_serial_format`; (b) yesterday-dated serial → passes; (c) tomorrow-dated serial → flagged; (d) post-auto-fix the rewritten serial is strictly less than the pre-fix date.

The PR is narrow and focused — only the 3 defects tied to the P14/P13 divergence. Do NOT include the audit's other follow-up items (S1 double-MX cleanup, Hestia upgrade resilience) in the same PR.

## 9. Evidence trail

- Pair records: `server_pairs` query via Supabase REST at 2026-04-22T03:00Z
- SSH credentials: `ssh_credentials` query + local decrypt (AES-256-GCM via `encryption.ts`)
- SSH probes: 4 sessions logged (zsh shell tool outputs embedded in this session's transcript)
- External DNS: `dig +short SOA/MX/TXT/A @8.8.8.8 @1.1.1.1 @<server_ips>` per P13 and P14 zone
- MXToolbox: chrome.mxtoolbox.com/domain/savini.info/ and /domain/lauseart.info/ verified 0E/1W/208-205P at 2026-04-22T03:05Z
- `provisioning_steps` rows for P14 job

No writes to P13, no writes to P14, no code changes during Phase A.
