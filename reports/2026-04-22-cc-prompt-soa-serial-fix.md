# Claude Code Prompt — SOA Serial Format Fix (P14 backfill + saga patch + P15/P16 staged launch)

**Owner:** Dean
**Author:** Cowork Master (Project 8)
**Drafted:** 2026-04-22 (UTC)
**Target executor:** Claude Code (Opus 4.7)
**Status:** Ready to paste

---

## 0. How to use this document

Everything between the `=== BEGIN CC PROMPT ===` and `=== END CC PROMPT ===` fences is a self-contained prompt. Copy-paste it verbatim into a fresh Claude Code session. CC has been given all context it needs — do not summarize or rewrite it.

The prompt assumes CC has SSH access (via `sshpass` + the P14 shared password stored in `ssh_credentials`) and repo write access on the `dashboard-app/` worktree. CC must NOT modify `.auto-memory/` directly — it should propose memory updates at the end for Dean to apply in the Master project.

---

=== BEGIN CC PROMPT ===

# Task: Fix SOA serial format on P14 + patch the saga + stage P15/P16 launches

## 1. Context you need loaded before doing anything

You are continuing work on the cold-email infrastructure dashboard. Pair 14 (`savini.info` cluster, Linode S1=`45.56.75.67`, S2=`45.79.213.21`, 11 zones) completed an E2E GREEN provisioning run on worker baseline `99ff962`. A follow-up MXToolbox Domain Health audit found **0 Errors / 1 Warning / 209 Passed** uniformly across all 11 zones. The single warning: **"SOA Serial Number Format is Invalid"**.

Read these files IN THIS ORDER, then stop and re-read the audit report carefully:

1. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/.auto-memory/MEMORY.md` — index only, skim
2. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/.auto-memory/feedback_hard_lessons.md` — look up HL #107 (SOA timers), HL #110 (MXToolbox advisory), HL #101 (AXFR sync)
3. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/.auto-memory/feedback_mxtoolbox_ui_api_gap.md` — the three-signal canonical
4. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app/reports/2026-04-22-p14-mxtoolbox-audit.md` — the 11-zone audit (the GO verdict in there is SUPERSEDED by this prompt — the SOA Serial warning is NOT advisory, it is a saga correctness bug)
5. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app/src/lib/provisioning/pair-provisioning-saga.ts` — the saga
6. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app/src/lib/provisioning/hestia-scripts.ts` — zone bootstrap (see line 285 `v-change-dns-domain-soa` call which already attempts HL #107 timers; confirm whether it's being silently swallowed)
7. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app/src/lib/provisioning/verification-checks.ts:410-507` — current SOA check (regex-only, misses the date-in-future problem)
8. `/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app/src/lib/provisioning/auto-fix.ts:1044-1120` — `fixSOASerialSync` (peer-sync only, does not rewrite format)

## 2. Ground truth (do not re-litigate — verify only if something contradicts)

At 2026-04-22 01:00 UTC, `dig @8.8.8.8 SOA` returned:

| Pair | Domain | Serial | yyyymmdd portion | Last 2 digits | Status |
|---|---|---|---|---|---|
| P13 | launta.info | 2026042021 | 20260420 (past) | 21 | 0 MXToolbox warnings |
| P13 | caleap.info | 2026042013 | 20260420 (past) | 13 | 0 warnings |
| P13 | larena.info | 2026042006 | 20260420 (past) | 06 | 0 warnings |
| P14 | savini.info | 2026042204 | **20260422 (future vs UTC wall clock when scanned)** | 04 | **1 warning: SOA Serial Format Invalid** |
| P14 | 10× sending domains | 2026042202 | **20260422 (future)** | 02 | **1 warning each** |
| P14 | slaunter.info | 2026042204 | **20260422 (future)** | 04 | **1 warning** |

### Root cause — two independent defects

**Defect A (TZ drift):** HestiaCP's `/usr/local/hestia/func/domain.sh` generates the SOA serial via `date +%Y%m%d%H` — **local time, not UTC**. P14's Linodes have local timezones ahead of UTC (S1 appears to be UTC+3, S2 appears to be UTC+1), so when zones were rebuilt, the date portion of the serial became tomorrow's UTC date. MXToolbox's validator (which runs in UTC) parses the 10-digit serial as YYYYmmddSS, sees a future date, and flags it as invalid. The saga does NOT force TZ=UTC on newly provisioned servers — confirm this by grepping `pair-provisioning-saga.ts` and `hestia-scripts.ts` for `timedatectl` or `TZ=`.

**Defect B (collision within hour):** Even with TZ=UTC, `date +%Y%m%d%H` means two zone edits within the same hour produce IDENTICAL serials. BIND slaves keyed off AXFR serial comparison will silently skip the second update — records diverge between S1 and S2 until the next hour rolls over. This is latent in production today; it has not bitten us yet because hands-free operations are spaced out, but it WILL bite under load.

**Defect C (verification gap):** `verification-checks.ts:456` only validates `/^\d{10}$/` — it does not validate that the yyyymmdd portion is ≤ today_UTC or that same-hour collisions aren't happening between S1 and S2. Because of this, P14 passed all saga gates despite being MXToolbox-dirty.

## 3. Non-negotiable constraints

- **Deliverability first.** Every change you propose must preserve or improve deliverability. No exceptions.
- **Do not modify `.auto-memory/`** — the Master project owns it. Output suggested memory updates at the end; Dean will apply them.
- **Do not run destructive git ops** on Dean's local mount. Use standard `git add/commit/push` only, on a feature branch — never force-push to `main`.
- **One pair at a time for validation.** Do NOT queue P15 and P16 in parallel; P16 provisioning is gated on P15 ending clean.
- **Keep every non-SOA P14 config untouched.** DMARC, SPF, DKIM, MX, PTR, certs, HL #107 timers — all must survive the backfill byte-for-byte. This is an in-place serial rewrite, not a zone rebuild.
- **Linode port-25 tickets stay open.** Do not touch them.
- **Namecheap-only for any new domain work.** No Ionos.
- **SEM-FRESH blacklist listings are acceptable** (see `feedback_provider_preferences.md`). Do not chase them.

## 4. Work plan (three phases, sequential)

### Phase 1 — Backfill P14 (live SSH, no saga changes)

**Goal:** Bring all 11 P14 zones to 0 MXToolbox warnings WITHOUT regenerating zones from scratch. Minimal-touch.

Step 1.1 — Pull P14 shared root password from the dashboard DB:

```sql
SELECT server_ip, password_encrypted
FROM ssh_credentials
WHERE provisioning_job_id = (SELECT provisioning_job_id FROM server_pairs WHERE pair_number = 14)
ORDER BY server_ip;
```

Decrypt via the existing SSH wrapper. Confirm it matches the P14 credential tail on file (see MEMORY.md P14 entry). Abort if not an exact match.

Step 1.2 — SSH into BOTH P14 servers and force TZ to UTC:

```bash
# On S1 and S2:
timedatectl set-timezone UTC
hwclock --systohc
date -u  # expect YYYY-MM-DD HH:MM UTC
```

Record the before/after TZ and wall-clock time in the run log. If either server refuses (read-only /etc, container isolation, etc.), STOP and escalate — do not proceed to Step 1.3.

Step 1.3 — For each of the 11 P14 zones, compute a proper YYYYmmddNN serial where:

- YYYYmmdd = today in UTC (no future dates, no pre-1970 dates)
- NN = a 2-digit sequence, starting at 01. If the current live serial's yyyymmdd matches today_UTC, set NN = (current_last2 + 1) % 100; else NN = 01.
- The new serial MUST be strictly greater (numerically) than the current live serial, or BIND slaves will reject the update.

Apply it on the OWNING server half (use `getServerForDomain()` logic from `hestia-scripts.ts` to decide which half owns which zone — S1 owns NS + odd-indexed sending, S2 owns even-indexed, or whatever the actual assignment is; read the code, don't guess):

```bash
# On the owning server:
/usr/local/hestia/bin/v-change-dns-domain-soa admin ${DOMAIN} ns1.savini.info '' 3600 600 2419200 3600
# This alone keeps the HestiaCP-generated serial, which is still TZ-bad.
# Instead, directly rewrite the SOA serial in the zone file, then reload:

ZONE=/home/admin/conf/dns/${DOMAIN}.db
CURRENT=$(dig @127.0.0.1 SOA ${DOMAIN} +short | awk '{print $3}')
NEW=$(date -u +%Y%m%d)01
# Ensure NEW > CURRENT; if not, bump NN.
sed -i "s/${CURRENT}/${NEW}/g" ${ZONE}
rndc reload ${DOMAIN}
```

Prefer the direct file edit over `v-rebuild-dns-domain`, because rebuild will re-run HestiaCP's `date +%Y%m%d%H` template and re-break the serial. See HL #108: **never** direct-edit zone files for RECORD changes — but the SOA serial IS the exception Hestia itself bumps via rebuild, and rebuild is exactly what we're avoiding here. Document this exception inline in your commit message.

Step 1.4 — On the PEER half, trigger AXFR retransfer so the slave picks up the new serial:

```bash
# On the peer server:
rndc retransfer ${DOMAIN}
sleep 2
dig @127.0.0.1 SOA ${DOMAIN} +short
# Verify last-field serial matches the new serial set on the owner.
```

Step 1.5 — Verify externally. For each zone:

```bash
dig @8.8.8.8 SOA ${DOMAIN} +short
dig @1.1.1.1 SOA ${DOMAIN} +short
```

Both resolvers must return the new serial. Spread loop over all 11 zones; any mismatch → STOP.

Step 1.6 — Re-run `tools/verify-zone.sh` (the intoDNS canonical) against all 11 P14 zones. Target: FAIL=0. Warnings that are pre-existing and unrelated to serial are OK.

Step 1.7 — MXToolbox rescan for each of the 11 zones, one per minute (don't hammer; they will rate-limit):

- `https://mxtoolbox.com/domain/${DOMAIN}/` → wait 10-15s → extract `N Error / N Warning / N Passed`
- Target: 0 Errors, 0 Warnings, ~207+ Passed on every zone.
- If any zone still shows the SOA Serial warning: the backfill failed on that zone — debug and re-apply.

### Phase 2 — Patch the saga (repo change, PR, CI)

Branch name: `gate0/soa-serial-format-fix-20260422`

Change set:

**2.1 — Force TZ=UTC in the saga, early.** In `pair-provisioning-saga.ts`, inside Step 2 (the first step that has SSH to both servers) or as a new Step 1.5, add:

```ts
for (const ssh of [ssh1, ssh2]) {
  await ssh.exec('timedatectl set-timezone UTC && hwclock --systohc', { timeout: 15000 });
  const verify = await ssh.exec('date -u +%Y-%m-%dT%H:%M:%SZ && cat /etc/timezone 2>/dev/null', { timeout: 5000 });
  context.log(`[Step 2] TZ set on ${ssh.host}: ${verify.stdout.trim()}`);
  // Fail the step if /etc/timezone is not Etc/UTC
}
```

This single change would have prevented the P14 warning entirely.

**2.2 — Fix the HestiaCP serial generator.** Two options; pick (a) unless you find a reason not to.

(a) **Patch `domain.sh` in place** during provisioning (replicates the HL #107 timer fix pattern). In `hestia-scripts.ts`, right after the zone bootstrap:

```ts
// HL #???: HestiaCP upstream generates SOA serials via `date +%Y%m%d%H` (local
// TZ, hour-of-day). This breaks MXToolbox when the server's local time is
// ahead of UTC (future-dated yyyymmdd) AND causes same-hour AXFR collisions.
// Replace with UTC YYYYmmddNN + a per-zone counter file.
const PATCH = String.raw`
# --- Hestia SOA serial override (applied by dashboard saga) ---
SERIAL_DIR=/usr/local/hestia/data/dns-serial
mkdir -p "$SERIAL_DIR"
hestia_next_serial() {
  local domain="$1"
  local today=$(date -u +%Y%m%d)
  local counter_file="$SERIAL_DIR/$domain"
  local last="0 0"
  [ -f "$counter_file" ] && last=$(cat "$counter_file")
  local last_date=$(echo "$last" | awk '{print $1}')
  local last_seq=$(echo "$last" | awk '{print $2}')
  local seq=1
  if [ "$last_date" = "$today" ]; then
    seq=$((last_seq + 1))
    if [ "$seq" -gt 99 ]; then seq=99; fi
  fi
  echo "$today $seq" > "$counter_file"
  printf "%s%02d\n" "$today" "$seq"
}
# --- end override ---
`;
await ssh.exec(
  `cat >> /usr/local/hestia/func/domain.sh <<'HESTIA_PATCH'\n${PATCH}\nHESTIA_PATCH`,
  { timeout: 10000 }
);
// Then sed the existing `TIME=$(date +%Y%m%d%H)` line to call our function:
await ssh.exec(
  `sed -i 's|TIME=$(date +%Y%m%d%H)|TIME=$(hestia_next_serial "$domain")|' /usr/local/hestia/func/domain.sh`,
  { timeout: 10000 }
);
```

After patch, grep the file to verify the new function + sed took effect. Log a clear marker line.

(b) **Alternative — post-rebuild serial rewriter** (a systemd path unit or cron that watches `/home/admin/conf/dns/*.db` and rewrites bad serials). Only pursue if 2.2(a) breaks HestiaCP upgrades.

**2.3 — Tighten `verification-checks.ts` Check 5.** Around line 456, replace the 10-digit regex with stricter validation:

```ts
// HL #???: Serial must be YYYYmmddNN where yyyymmdd is today_UTC or earlier,
// and NN is 00-99. Catches MXToolbox's SOA Serial Format flag BEFORE gate 0.
const serialMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(serial);
if (!serialMatch) {
  issues.push(`Serial ${serial} not in YYYYmmddNN format`);
} else {
  const [, yStr, mStr, dStr, nnStr] = serialMatch;
  const serialDate = new Date(Date.UTC(+yStr, +mStr - 1, +dStr));
  const todayUtc = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  ));
  if (serialDate.getTime() > todayUtc.getTime()) {
    issues.push(`Serial ${serial} yyyymmdd=${yStr}${mStr}${dStr} is in the future (UTC today = ${todayUtc.toISOString().slice(0,10)})`);
  }
  if (+nnStr < 0 || +nnStr > 99) {
    issues.push(`Serial ${serial} NN portion ${nnStr} outside 00-99`);
  }
}
```

Set `fixAction: 'fix_soa_serial_format'` on violation. Wire a new auto-fix in `auto-fix.ts` that does the exact Phase 1 Step 1.3 rewrite in code (reuse the bash template), gated on TZ=UTC having already been enforced.

**2.4 — Regression test.** Add to `src/lib/provisioning/__tests__/pair-verify.test.ts`:

- A passing case: serial = `${todayUtcYyyymmdd}01`.
- A failing case: serial = `${tomorrowUtcYyyymmdd}00` → must be flagged with fixAction `fix_soa_serial_format`.
- A failing case: serial = `2026042125` where NN=25 exceeds 99 range → must fail format regex. (Don't add this case if you decide NN up to 99 is allowed but >= 24 should still pass — pick one interpretation and document it.)
- A passing case after auto-fix runs: serial gets rewritten to `${todayUtcYyyymmdd}01`.

**2.5 — Commit message / PR description.** Include:

- Link to `2026-04-22-p14-mxtoolbox-audit.md`
- Link to this prompt
- Ground-truth table (copy §2 above)
- "Supersedes" note: the audit report's CONDITIONAL GO verdict is retracted; SOA Serial is a real saga bug.

**2.6 — Deploy.** Merge the PR to `main`, redeploy Vercel, update the Linode worker VPS to the new SHA. Verify `/api/admin/health` or equivalent shows the new worker SHA.

### Phase 3 — Staged P15 launch (validation gate)

Do NOT start Phase 3 until:

- ✅ Phase 1 complete: all 11 P14 zones show 0 MXToolbox warnings
- ✅ Phase 2 merged to main, Vercel + worker both on new SHA
- ✅ Regression test added is green in CI

Then:

**3.1** — Kick off P15 provisioning via the existing dashboard UI or saga API. Use Namecheap for domain registration (see `feedback_provider_preferences.md`). Use Linode for VPS. Provide the normal 11-zone domain list.

**3.2** — Watch the saga progress. At the TZ-set step (new Step 1.5), confirm the log shows `Etc/UTC` on both servers. At the HestiaCP patch step, confirm the marker line appears. If any saga step fails, DO NOT retry blindly — diagnose and fix in-band.

**3.3** — On E2E GREEN, run `tools/verify-zone.sh` over all 11 P15 zones. Target FAIL=0.

**3.4** — MXToolbox Domain Health scan all 11 P15 zones. **Target: 0 Errors, 0 Warnings on every zone.** If a single zone shows the SOA Serial warning: the saga fix did not take. Escalate to Dean, do not launch P16.

**3.5** — Mail-tester 10/10 on all 10 sending P15 domains.

**3.6** — Write a short report at `dashboard-app/reports/2026-04-${DD}-p15-mxtoolbox-validation.md` summarizing results and confirming the saga fix works end-to-end.

### Phase 4 — P16 launch (final confirmation)

Only after Phase 3 lands green:

- Repeat the Phase 3 procedure for P16.
- If P16 also lands clean: the saga fix is production-hardened, remove any "experimental" flags, and update memory.

## 5. Success criteria (all must be true)

1. All 11 P14 zones show 0 MXToolbox Errors AND 0 Warnings.
2. All 11 P14 zones' SOA serials match between S1 and S2 (`dig @S1 == dig @S2`).
3. `timedatectl` on every P14, P15, P16 server returns `Etc/UTC`.
4. `grep hestia_next_serial /usr/local/hestia/func/domain.sh` returns a match on every P14, P15, P16 server.
5. Regression tests green in CI for `pair-verify.test.ts`.
6. P15 and P16 each land with 0/0/207+ on MXToolbox across all zones.
7. `saga_event_log` shows the new TZ-set and domain.sh-patch steps logged on each pair's provisioning job.

## 6. Rollback plan

If Phase 1 breaks a P14 zone (e.g., AXFR goes silent): re-run `v-rebuild-dns-domain admin ${DOMAIN}` on the owning server and `rndc retransfer ${DOMAIN}` on the peer. This restores the pre-change state (HestiaCP rewrites serial + zone file from template). Accept the temporary MXToolbox warning while diagnosing.

If Phase 2 breaks a future saga run: revert the PR, wait for Vercel + worker redeploy, re-run provisioning. Fix forward on a new branch.

## 7. Suggested memory updates (propose to Dean at end, do NOT apply yourself)

- New hard lesson: "SOA serials must be YYYYmmddNN with yyyymmdd ≤ today_UTC. HestiaCP's `date +%Y%m%d%H` is broken two ways — local-TZ drift and same-hour collision. Saga MUST force TZ=UTC AND replace the serial generator."
- Update `feedback_hard_lessons.md` HL #110 addendum: MXToolbox's SOA Serial Format rule DOES correlate with real correctness. Do not class it as advisory without checking the yyyymmdd portion against today_UTC.
- Update `project_server_deployment.md` with P14/P15/P16 status after each phase closes.
- Update MEMORY.md header with the date of the saga fix merge.

## 8. Output at end of run

Write a run-log report at `dashboard-app/reports/2026-04-${DD}-soa-serial-fix-run.md` covering:

- Timestamps per phase
- Per-zone before/after serials (all 11 P14)
- TZ before/after on each server (P14 × 2, P15 × 2 if run, P16 × 2 if run)
- MXToolbox summary screenshots or text extracts per zone per pair
- Regression test output
- Suggested memory updates for Dean to apply

Stop at Phase 1 if anything goes sideways. Do NOT silently swallow errors.

=== END CC PROMPT ===

---

## Notes for Dean (not part of the prompt)

1. **Retraction of the audit verdict.** The audit report (`2026-04-22-p14-mxtoolbox-audit.md`) classified the SOA Serial warning as bucket B (advisory). That was wrong. The correct classification is bucket A (hard fail) — the warning reflects a real, pre-deliverability saga bug. When the saga fix lands, update the report header with a retraction note pointing at this prompt.

2. **Why TZ=UTC alone isn't enough.** If you only fix TZ, you still have the same-hour AXFR collision. Both patches ship together or not at all.

3. **Why not just switch to `date -u +%s`?** Unix-timestamp serials work technically but look weird in tooling (10 digits, no embedded date). YYYYmmddNN with a counter file is the industry standard for a reason.

4. **Gate interaction.** Phase 3's P15 launch is the real saga validation gate. If P15 still emits future-dated or hour-based serials, the patch didn't take — don't ship P16. Phase 4 is the final hardening confirmation.

5. **Scope fencing.** This prompt does NOT attempt to fix the swallowed `.catch(() => {})` at `hestia-scripts.ts:288` (silent timer-set failure), nor the S1/S2 MX asymmetry flagged in the audit. Those are separate issues. Keep this PR narrow — one bug, one fix, easy to review.
