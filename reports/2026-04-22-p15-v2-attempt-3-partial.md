# P15-v2 Attempt 3 — PARTIAL GREEN (VG2 false-positive, pair salvaged)

## VERDICT: PARTIAL GREEN

The saga reached Step 12 and exercised the full PR #18 chain for the first time. All infrastructure came up correctly — patched SOA template applied on both hosts, 11 zones created with correct MNAME/timers/format, SSL issued, DMARC/SPF/DKIM populated, PTR set. Verification Gate 1 (Step 10) misfired on 11/11 zones because the rule shipped in PR #18 (`serialDate >= todayUTC`) was stricter than MXToolbox's actual behavior. Auto-fix (Step 11) attempted to rewrite the serials but had its own shell-escaping bug (`bash -c ${JSON.stringify(...)}`) and crashed on every zone. VG2 (Step 12) re-tested, saw 11 "unresolved", and marked the job `failed` — while MXToolbox externally reported PERFECT on all zones.

**Outcome:** saga infrastructure is correct. Pair salvaged by:
- Code fixes: commits [`8c033b5`](https://github.com) (drop the overstrict VG rule) + [`a82387c`](https://github.com) (remove the broken `fix_soa_serial_format` auto-fix + dispatcher entry).
- DB write: additive insert of `server_pairs`/`sending_domains` + `provisioning_jobs` status flip to `completed`.

**P16 safety:** the VG→auto-fix→VG2 loop that blocked this run is removed. Future saga runs will pass VG1 on today-UTC serials directly. `fix_soa` (timer fixer) is unchanged and still handles timer-only issues.

---

## Identifiers

| Key | Value |
|---|---|
| `P15V2_A3_JOB_ID` | `cc7934c8-7187-4341-86e4-0a9fc87dc75a` |
| `P15V2_A3_PAIR_ID` | `4aff878f-2c5f-407c-a57f-14a9e0121ed9` (created via salvage at 2026-04-22T19:44:31Z) |
| `pair_number` | 15 |
| `NS domain` | `lavine.info` |
| `S1 IP / hostname` | `69.164.205.213` / `mail1.lavine.info` |
| `S2 IP / hostname` | `45.79.111.103` / `mail2.lavine.info` |
| `Regions` (from `provisioning_jobs.config`) | `us-central` (S1) + `us-west` (S2) |
| `Provider` | Linode (provider IDs `96470837` + `96470839`) |
| `Admin email` | `admin@lavine.info` |
| `mail_accounts_per_domain` | 3 (→ `total_accounts = 30`) |
| Job created | `2026-04-22T16:13:11Z` |
| Step 1 started | `2026-04-22T16:13:14Z` |
| Step 12 terminal | `2026-04-22T17:08:42Z` (saga `failed`) |
| Pair salvaged | `2026-04-22T19:44:31Z` (PostgREST additive writes) |
| Job PATCH → `completed` | `2026-04-22T19:45:10Z` |
| Total saga wall-clock | 55m 28s |
| Repo HEAD at saga run | `b6629ca` |
| Repo HEAD at report write | `a82387c` (post-Commit 2) |
| Fix commits | `8c033b5` (drop VG date rule), `a82387c` (remove broken auto-fix) |

---

## Saga Step Timing

| # | Step | Start (UTC) | End (UTC) | Duration | Status |
|---|---|---|---|---|---|
| 1  | `create_vps`            | 16:13:14 | 16:18:08 | 4m 47s  | completed |
| 2  | `install_hestiacp`      | 16:18:11 | 16:24:23 | 6m 3s   | completed |
| 3  | `configure_registrar`   | 16:24:26 | 16:28:12 | 3m 38s  | completed |
| 4  | `await_dns_propagation` | 16:28:16 | 16:38:08 | 9m 34s  | completed |
| 5  | `setup_dns_zones`       | 16:38:11 | 16:41:32 | 3m 12s  | completed |
| 6  | `set_ptr`               | 16:41:36 | 16:41:54 | 1.4s    | completed |
| 7  | `setup_mail_domains`    | 16:41:56 | 16:47:00 | 4m 57s  | completed |
| 8  | `await_s2_dns`          | 16:47:02 | 16:47:27 | 16.0s   | completed |
| 9  | `security_hardening`    | 16:47:29 | 17:00:43 | 13m 4s  | completed |
| 10 | `verification_gate`     | 17:00:47 | 17:04:04 | 3m 0s   | completed (22 auto_fixable: 11 SOA + 11 MTA-STS) |
| 11 | `auto_fix`              | 17:04:04 | 17:05:32 | 1m 17s  | completed (11 MTA-STS fixed; 11 SOA all failed exit 2 — Bug B) |
| 12 | `verification_gate_2`   | 17:05:34 | 17:08:42 | 3m 0s   | **failed** (11 unresolved soa_record — VG rule false-positive, Bug A) |

Wall-clock from job creation to terminal: 55m 32s. All eleven infrastructure steps (1-9) completed cleanly.

---

## Gates A–E Results

| Gate | Requirement | Result |
|---|---|---|
| A  | `timedatectl` = `Etc/UTC` on S1 + S2 before Step 2 | **GREEN** — `Etc/UTC (UTC, +0000)` on both hosts at 16:27:40Z (3 min after Step 2 completed). |
| B  | `HL-107-patched` marker in `/usr/local/hestia/func/domain.sh` directly above `update_domain_zone()` on S1 + S2 | **GREEN** — marker at line 488 on both hosts; `update_domain_zone()` at line 490. First end-to-end validation of `patchDomainSHSOATemplate` since PR #18 merged. |
| C  | `v-change-dns-domain-soa` error-surfacing is un-swallowed (hestia-scripts.ts:297-320) | **GREEN** — Step 5 completed without error, `dig` on all 11 zones shows patched timers `3600 600 2419200 3600` (factory would be `7200 $refresh 1209600 180`). The un-swallowed path didn't throw because the underlying command returned 0; absence of swallowing is indirectly validated. |
| D  | Check 5 `validateSOASerialFormat` runs against every zone and emits auto-fixable | **GREEN by removal** — Check 5 DID fire on all 11 zones with today-UTC serials (`2026042224` … `2026042233`), correctly routing to `fix_soa_serial_format`. **But the rule that flagged them (`serialDate >= todayUTC`) is wrong relative to MXToolbox reality (see Bug A below).** Rule dropped in commit `8c033b5`; future runs return `ok: true` on today-UTC serials. Verified: post-patch, the 11 live serials pass the helper (`tools/verify-vg-soa-rule.ts` → 11/11). |
| E  | `fix_soa_serial_format` auto-fix fires for flagged zones and rewrites to yesterday-UTC | **REMOVED post-patch** — attempted on all 11 zones during the run. **All 11 failed exit 2** due to the `bash -c ${JSON.stringify(remoteScript)}` collapse bug (see Bug B below). Auto-fix function + dispatcher case removed in commit `a82387c`; future runs no longer need this path because Gate D no longer flags today-UTC serials. |

**The PR #18 patch chain is partially validated:** `patchDomainSHSOATemplate` (Gates A/B/C) works end-to-end. `validateSOASerialFormat` + `fix_soa_serial_format` (Gates D/E) shipped with paired design and runtime bugs; both have been removed from the codebase rather than re-fixed.

---

## Bug A — VG rule `serialDate >= todayUTC` over-strict

**File:line (pre-patch):** [`src/lib/provisioning/verification-checks.ts:68`](src/lib/provisioning/verification-checks.ts)

**Pre-patch rule:**
```ts
if (serialDate >= todayUTC) {
  return { ok: false, issue: `... today-UTC or future (today_UTC=${todayStr}) — MXToolbox flags this as "SOA Serial Number Format is Invalid" until the date rolls over` };
}
```

**Empirical basis the rule was derived from:** [`reports/2026-04-22-p13-vs-p14-investigation.md:118`](reports/2026-04-22-p13-vs-p14-investigation.md)
> "The `SOA Serial Number Format is Invalid` warning fires when MXToolbox UI considers the serial to encode a date that is NOT strictly in the past relative to UTC wall clock."

That conclusion was drawn from **one zone** (`savini.info`, the P14 orphan, which had orthogonal issues including possibly-unsynced state from the 2026-04-20 manual-backfill path). One observation, not a rule.

**Counter-evidence from this run (11 observations):** all 11 `lavine.info` pair zones were scanned on MXToolbox Domain Health with today-UTC serials `2026042224` … `2026042233` and returned PERFECT. MXToolbox does not actually reject today-UTC serials. The P14 warning must have been triggered by something else on that orphan (possibly `Etc/UTC` TZ not yet applied, or the manual SOA values from backfill not fully propagated — diagnostic too far gone to rerun).

**External confirmation (dig @8.8.8.8 from outside the pair, 2026-04-22T17:14Z):**
```
lavine.info.  2026042230 3600 600 2419200 3600
carosi.info.  2026042224 3600 600 2419200 3600
…
verina.info.  2026042233 3600 600 2419200 3600
```
Serials valid YYYYMMDDNN format, timers match the HL-107 patched values.

**Patch (commit `8c033b5`):** drop the date comparison from `validateSOASerialFormat`. Keep format-only validation: 10-digit YYYYMMDDNN + month 01-12 + day 01-31. Drop the `now` parameter (no longer referenced). In Check 5, route malformed-format results to `manual_required` (Hestia's `update_domain_serial` always emits valid format, so this branch is defensive) and timer-only issues continue to route to `fix_soa` (unchanged, safe).

**Test coverage (post-patch):** `src/lib/provisioning/__tests__/soa-serial-format.test.ts` rewritten with 15 assertions including today-UTC passes, future passes, month 00/13 rejects, day 00/32 rejects, non-10-digit rejects. `tools/verify-vg-soa-rule.ts` verification against live zones: 11/11 pass.

---

## Bug B — `fix_soa_serial_format` runtime collapse

**File:line (pre-patch):** [`src/lib/provisioning/auto-fix.ts:1186`](src/lib/provisioning/auto-fix.ts)

**Pre-patch invocation:**
```ts
const result = await owningSSH.exec(
  `DB=/home/admin/conf/dns/${domain}.db ... bash -c ${JSON.stringify(remoteScript)}`,
  { timeout: 20000 }
);
```

**Collapse mechanism:**
1. `remoteScript` built with `.join('\n')` — real newlines.
2. `JSON.stringify` escapes each newline to the 2-char sequence `\n` (backslash+n) and surrounds in double quotes.
3. Outer template-literal embeds this in the SSH command string with literal `\n` inside bash double quotes.
4. Remote shell parses the double-quoted bash-c argument: inside bash double quotes, `\n` is NOT a special escape — it stays as 2 literal chars (`\` + `n`).
5. Bash invoked via `bash -c "<script>"`. Bash parses the script; outside of any quoting, `\n` → `n` (generic backslash-escape of next char).
6. The entire multi-line script collapses into a single line joined on literal `n` characters.
7. First token after `set` becomes `-e\nDOMAIN='lavine.info'\nNEW_SERIAL=...\nDB=...`, which after backslash-escape becomes `-enDOMAIN='lavine.info'nNEW_SERIAL=...nDB=...`.
8. Bash's `set` processes the leading `-enDOMAIN...` as flag chars: `-e` (errexit) ✓, `-n` (noexec) ✓, `-D` (invalid).

**Reproduced in-session (S1 = 69.164.205.213):**
```
bash: line 1: set: -D: invalid option
set: usage: set [-abefhkmnptuvxBCHP] [-o option-name] [--] [arg ...]
```
`-D` is the `D` from `DOMAIN='lavine.info'` — confirming the full collapse trace above.

**Why the error message misled (saw "zone file not found"):** the worker's error wrapper dumps the entire command string back into `provisioning_steps.error_message`, including the embedded `echo "ERROR: zone file not found: $DB" >&2` line that is part of the source template. That echo was NEVER executed — the shell died at `set` several lines earlier. Anyone reading the log field sees "zone file not found" and reasonably debugs a filesystem path.

**Why MTA-STS succeeded while SOA failed** (same auto-fix step, same SSH session):
- MTA-STS fix ([auto-fix.ts:895-951](src/lib/provisioning/auto-fix.ts)) uses per-step single `ssh.exec(cmd)` calls plus one `cat > … << 'EOF'` heredoc inside a JS template literal (real newlines, no `JSON.stringify`). Safe. 11/11 succeeded.
- `fix_soa_serial_format` was the **only** function in auto-fix.ts using the `bash -c ${JSON.stringify(multiLineScript)}` pattern.

**Contrast with the remaining `fix_soa` function** ([auto-fix.ts:295](src/lib/provisioning/auto-fix.ts), kept):
```ts
const cmd = `${HESTIA_PATH_PREFIX}v-change-dns-domain-soa admin ${domain} '' '' 3600 600 2419200 3600`;
const result = await ssh.exec(cmd, { timeout: 10000 });
```
Single-command, no `bash -c`, no `JSON.stringify`, no multi-line script. Bug B cannot affect it. `fix_soa` remains the sole SOA auto-fix route — it handles timer-only issues, which is all Hestia can realistically produce after the HL-107 template patch is in place.

**Patch (commit `a82387c`):** delete the `fixSOASerialFormat` function body + its docstring (176 lines) and remove the `case 'fix_soa_serial_format':` dispatcher entry (4 lines). No downstream callers affected; `mx-spec-alignment.test.ts` still passes (it asserts on `fixSOA` specifically). The orphaned docstring for `fixSOASerialSync` that previously sat above `fixSOASerialFormat` now correctly sits above `fixSOASerialSync`.

**Removal-vs-rewrite rationale:** with Bug A fixed (today-UTC serials are valid), there's no legitimate work for `fix_soa_serial_format` to do. SOA correctness is already enforced at creation time by Step 2's `patchDomainSHSOATemplate` + Steps 5/7's `setDomainSOA` + Hestia's own `update_domain_serial` (from the patched `domain.sh`). Removing the function takes Bug B off the map without needing to fix the shell-escaping pattern and prevents a future contributor from reactivating broken code.

---

## Per-Zone Table (post-saga, pre-salvage DNS state)

All zones confirmed externally via `dig @8.8.8.8` at 2026-04-22T17:14Z. MXToolbox verdict per Dean's live Domain Health check.

| Domain | Primary | SOA Serial | MNAME | Timers (Ref Ret Exp Min) | MTA-STS | MXToolbox |
|---|---|---|---|---|---|---|
| lavine.info   | S1 (NS apex) | `2026042230` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| carosi.info   | S1 | `2026042224` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| cirone.info   | S1 | `2026042224` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| lodema.info   | S1 | `2026042224` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| luvena.info   | S1 | `2026042224` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| marife.info   | S1 | `2026042224` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| morice.info   | S2 | `2026042233` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| norita.info   | S2 | `2026042233` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| renita.info   | S2 | `2026042233` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| valone.info   | S2 | `2026042233` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |
| verina.info   | S2 | `2026042233` | `ns1.lavine.info.` | 3600 600 2419200 3600 | added by auto-fix | PERFECT |

Partition (Hestia-master): S1 hosts lavine (NS apex) + carosi/cirone/lodema/luvena/marife (alphabetical first-half of sendings). S2 hosts morice/norita/renita/valone/verina (second-half). Matches `computeZonePartition` convention and was confirmed live via `v-list-dns-domains admin` on each host during the run.

---

## Auto-fix Firings (Step 11)

**Completed successfully (11/11 MTA-STS):** one `add_mta_sts` per zone. Each added a DNS TXT record `_mta-sts.<zone>` with policy id `<timestamp>` and wrote `/home/admin/web/<zone>/public_html/.well-known/mta-sts.txt` with `version: STSv1\nmode: enforce\nmx: mail.<zone>\nmax_age: 604800`. Summed wall-clock for 11 MTA-STS fixes: well under a minute (fixes run in parallel where independent).

**Failed (11/11 SOA — Bug B):** one `fix_soa_serial_format` per zone. All 11 failed with exit code 2 from the `bash -c ${JSON.stringify(...)}` collapse. Failure surface preserved verbatim in `provisioning_steps.output` for Step 11 (fetched and parsed in the run; reproduced in-session on S1 to confirm root cause).

---

## Salvage — SQL block executed (PostgREST, three sequential writes)

Option B from the pre-execution approval (atomic psql not available — service_role JWT + PostgREST only). Each write was internally atomic; cross-call rollback path was prepared but not needed (all three succeeded). Pre-flight safety checks confirmed 0 rows for `pair_number=15` and for `provisioning_job_id=cc7934c8…` before any write.

**Approved SQL (spec form):**
```sql
-- 1. Create the pair, capture id
INSERT INTO server_pairs (
  org_id, pair_number, ns_domain,
  s1_ip, s1_hostname, s2_ip, s2_hostname,
  status, mxtoolbox_errors, warmup_day, total_accounts,
  provisioning_job_id
) VALUES (
  'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q',
  15, 'lavine.info',
  '69.164.205.213', 'mail1.lavine.info',
  '45.79.111.103',  'mail2.lavine.info',
  'active', 0, 0, 30,
  'cc7934c8-7187-4341-86e4-0a9fc87dc75a'
) RETURNING id \gset

-- 2. 10 sending_domains
INSERT INTO sending_domains (
  pair_id, domain, primary_server_id,
  spf_status, dkim_status, dmarc_status, blacklist_status
) VALUES
  (:'id', 'carosi.info', 's1', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'cirone.info', 's1', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'lodema.info', 's1', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'luvena.info', 's1', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'marife.info', 's1', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'morice.info', 's2', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'norita.info', 's2', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'renita.info', 's2', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'valone.info', 's2', 'unchecked', 'unchecked', 'unchecked', 'clean'),
  (:'id', 'verina.info', 's2', 'unchecked', 'unchecked', 'unchecked', 'clean');

-- 3. Flip the job status + close the bidirectional link
UPDATE provisioning_jobs
SET status='completed', error_message=NULL,
    completed_at=NOW(), updated_at=NOW(),
    server_pair_id=:'id', progress_pct=100
WHERE id='cc7934c8-7187-4341-86e4-0a9fc87dc75a';
```

**Actual execution (PostgREST):**
- `POST /rest/v1/server_pairs` → HTTP 201 at 2026-04-22T19:44:31Z. Returned id = `4aff878f-2c5f-407c-a57f-14a9e0121ed9`.
- `POST /rest/v1/sending_domains` (batch of 10) → HTTP 201. All 10 rows returned with correct partition (5×s1 + 5×s2).
- `PATCH /rest/v1/provisioning_jobs?id=eq.cc7934c8…` → HTTP 200 at 2026-04-22T19:45:10Z. Status flipped to `completed`, `server_pair_id` set, `error_message` cleared, `progress_pct=100`.

**Post-write verification reads (all four passed):**

1. New pair row — 1 row, `pair_number=15`, `ns_domain=lavine.info`, `s1_ip=69.164.205.213`, `s2_ip=45.79.111.103`, `status=active`, `provisioning_job_id=cc7934c8-7187-4341-86e4-0a9fc87dc75a`. ✅
2. 10 sending_domains — 10 rows: carosi/cirone/lodema/luvena/marife with `primary_server_id='s1'`, morice/norita/renita/valone/verina with `'s2'`, all `blacklist_status='clean'`. ✅
3. Job state — `status=completed`, `server_pair_id=4aff878f-2c5f-407c-a57f-14a9e0121ed9`, `completed_at=2026-04-22T19:45:10Z`, `error_message=NULL`, `progress_pct=100`. ✅
4. Bidirectional integrity — `server_pairs.id == provisioning_jobs.server_pair_id` AND `server_pairs.provisioning_job_id == provisioning_jobs.id`. 1 row (the P15 pair). ✅

---

## P14 Orphan Posture (untouched per prompt)

- `server_pairs.id = fbc03039-00db-4b93-b996-da16c1345814` (savini.info): present, status `active`, unchanged.
- `ssh_credentials` rows for `173.230.132.245` + `45.33.63.216`: still orphaned (Linodes deleted 2026-04-22T~15:46Z by Dean manually). Zero reads/writes against these rows this session.

---

## Residual Risks / Diagnostic Gaps

1. **Bug A's original derivation is still unexplained.** The 2026-04-22 P13-vs-P14 investigation saw `savini.info` with serial `2026042205` flagged on MXToolbox while `launta.info` with `2026042021` (2 days past) passed. Whatever caused that flag is not the yyyymmdd date (confirmed by this run's counter-evidence). Possible confounders on the P14 orphan: un-synced TZ at time of scan, glue records not fully propagated, a stale DMARC/SPF/DKIM combination the scanner scored differently. The investigation was a single-observation hypothesis; it should not have been promoted to a hard rule without a second observation + live counterexample. **Lesson → HL #137 candidate below.**

2. **Auto-fix error-message wrapping hides root cause.** When `ssh.exec()` fails, the wrapper includes the full command text (including unquoted script content) in `provisioning_steps.error_message`. If that script contains `echo "ERROR: ..."` strings as *source template*, those strings appear in the error output even when they never ran, misleading the reader. Future auto-fix functions should either (a) not include human-friendly echo strings in their remoteScript source, or (b) the error-wrap should capture stderr/stdout separately from the command text. Not fixed in this session; ancillary improvement.

3. **Only `fix_soa_serial_format` has been removed.** Other auto-fix functions using multi-line remote scripts (if any exist) would exhibit the same collapse. Grep confirms it was the only user of `bash -c ${JSON.stringify(...)}` as of `a82387c`. Add a lint / test assertion to block the pattern from recurring: not done this session; tracked separately.

4. **The `config.secondaryRegion = 'us-west'` was correctly honored** even though the original P14 reference pair used `us-sea`. `us-west` + `us-central` combination passed IP pre-check on the first attempt of `create_vps` (no rerolls observed in step metadata). No HL needed — one data point.

---

## HL #137 CANDIDATE (not authored here — Master Command Center scope)

**Proposed statement:**
> VG's SOA serial `>= todayUTC` freshness rule was derived from a single flawed observation on P14/savini.info (which had orthogonal issues including a manual-backfill provenance). MXToolbox empirically tolerates today-UTC YYYYMMDDNN serials — P15-v2 Attempt 3 (2026-04-22) confirmed PERFECT across 11 live zones with today-UTC serials `2026042224`…`2026042233`. The rule was removed (commits `8c033b5` + `a82387c`); VG5 now validates format only (10-digit YYYYMMDDNN, month 01-12, day 01-31). Step 2's HL-107 `patchDomainSHSOATemplate` is the actual SOA correctness gate.
>
> **How to apply:** Any future rule tightening MUST be backed by (a) more than one observation and (b) a live counterexample reproduction — otherwise it's an anecdote, not a rule. Specifically: never promote a single-host empirical pattern from an orphan/backfilled/otherwise-atypical pair into a hard-fail VG gate without at least one fresh-saga GREEN counter-observation.

Master to author into `.auto-memory/feedback_hard_lessons.md` with whatever numbering is current there. Do not duplicate HL #136 (orphan-Linode-on-reroll-exhaustion) — that's a different bug, already documented.

---

## Memory Updates (Phase 5) — to be done after this commit lands

**Owned by Project 1 + Project 9 (I'll update these with diff-preview first):**
- `.auto-memory/project_server_deployment.md` — append P15 row with salvage note, cite commit SHAs `8c033b5` + `a82387c` + (Commit 3 SHA, TBD) and this report path.
- `.auto-memory/project_saas_dashboard.md` — transition Gate 0 from BLOCKED → PASSED; state the specific final-blocker (the SOA over-strict rule) was removed.

**Flagged for Master Command Center routing (I will NOT edit these):**
- `.auto-memory/MEMORY.md` — header audit line for 2026-04-22 updating Gate 0 status + citing this report.
- `.auto-memory/feedback_rebuild_assessment.md` — Gate 0 section moves from "canary DNSBL fix broke provisioning" / "P15 repeatedly BLOCKED" into "SAGA VALIDATED 2026-04-22" with job_id + pair_id + commit citations.
- `.auto-memory/feedback_hard_lessons.md` — author HL #137 per the candidate above.

---

## Final Status

- **Verdict:** PARTIAL GREEN
- **Saga infrastructure:** proven correct end-to-end (Steps 1-9 clean, PR #18 template patch validated via Gates A/B/C).
- **VG1/VG2 misfire:** diagnosed, patched, removed.
- **Pair:** salvaged. `server_pairs.id = 4aff878f-2c5f-407c-a57f-14a9e0121ed9`, 10 sending_domains linked, job row `completed` with bidirectional link closed.
- **P16:** unblocked from the saga-code side. The VG→auto-fix loop that killed Attempt 3 is gone. Real saga runs going forward should pass VG1 on today-UTC serials and not route through `fix_soa_serial_format`. Dean decides P16 launch timing separately (this session is salvage-only).
- **P15-v3 / P16 / P14-retry:** out of scope for this session.
