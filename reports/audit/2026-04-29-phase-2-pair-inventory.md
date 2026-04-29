# Phase 2 — Active pair inventory + cross-reference + CSV scope

**Generated:** 2026-04-29 (CC audit, branch `claude/vibrant-golick-ce8da1`)
**Method:** Live Supabase queries (read-only) + cross-reference vs Phase 1 timeline + dig DNS spot-checks.

## 2.1 — Live inventory (14 pairs, zero overnight drift)

| P# | ns_domain | status | total_accounts | actual active | actual disabled | sending_domains | provisioning_job_id |
|---|---|---|---:|---:|---:|---:|---|
| 1 | grocerysynergy.info | active | 0 | 0 | 0 | 0 | none (Clouding-era) |
| 2 | krogernetworks.info | active | 30 | 30 | 0 | **11** (10 + apex) | none (Clouding-era) |
| 3 | krogertogether.info | active | 0 | 0 | 0 | 0 | none (Clouding-era) |
| 11 | caleong.info | active | 30 | 30 | 0 | 10 | none |
| 12 | launter.info | active | 30 | 30 | 0 | 10 | none |
| 13 | launta.info | active | 30 | 30 | 0 | 10 | b920c716 |
| 14 | camire.info | active | 30 | 30 | 0 | 10 | 16fd7763 |
| 15 | lavine.info | active | 30 | 30 | 0 | 10 | cc7934c8 |
| 16 | mareno.info | active | 24 | 24 | 0 | 8 (post-fix) | 1a62c710 |
| 17 | cemavo.info | active | 30 | 30 | 0 | 10 | 4ecb6816 |
| 18 | partnerwithkroger.store | active | 30 | 0 | **30** (TLS) | 10 (2 clean + 8 burnt) | 1f8e4ba8 |
| 19 | marketpartners.info | active | 0 | 0 | 0 | **12** (preserve-wave) | none |
| 20 | krogermedianetwork.info | active | 27 | 27 | 0 | **9** | 4fa35fd0 |
| 21 | krogermarketinggroup.info | active | 27 | 27 | 0 | **9** | 31e205a6 |

Totals: **318 email_accounts** (288 active + 30 disabled), **119 sending_domains** (111 clean + 8 burnt). Matches Phase 0.4 + HANDOFF exactly.

`server_pairs.total_accounts` matches actual `email_accounts` count for all pairs (zero drift on this metric).

## 2.2 — Cross-reference vs Phase 1 timeline

Each pair's saga or import event traced to a session in the Phase 1 master timeline:

| P# | Provisioning event | Session evidence (from Phase 1) |
|---|---|---|
| 1, 3 | Clouding-era empty rows; no saga | Pre-window |
| 2 | Clouding-era; 30 accounts, 11 sending_domains | Pre-window (predates 2026-04-16) |
| 11, 12 | Clouding-era → Linode imported (provisioning_job_id null) | Pre-window |
| 13 | Saga 2026-04-19 18:06 | Batch A: `b41398e8` (saga 2026-04-19, ~30 accts) |
| 14 | Saga 2026-04-22 22:36 | Batch A: P14 first E2E GREEN (savini.info → camire.info) |
| 15 | Saga 2026-04-22 16:13 (Attempt 3) | Batch A: `0d9e164d` (P15-v2 Attempt 3 SALVAGED-GREEN) |
| 16 | Saga 2026-04-23 01:25 | Batch A: `42cfcce5` (P16 saga 12/12 GREEN, dead accounts → HL #138 salvage required) |
| 17 | Saga 2026-04-23 13:24 | Batch B: `5c4171b2/9f1b722a/f191dc06` (P17 cemavo finalization) |
| 18 | Saga 2026-04-24 19:17 (`1f8e4ba8` rolled_back), then a successor that completed | Batch B: `f0374f69` 2026-04-24 saga + `e38716c8` 2026-04-24 21:26 incident peak + `68b428b9` 2026-04-25 11:25 TLS remediation |
| 19 | Preserve-wave INSERT, no saga path | Batch B: `fd86b0be` 2026-04-25 13:35 (12 sending_domains explicitly inserted) |
| 20 | Saga 2026-04-25 22:02 | Batch B: `56e996b8` 2026-04-26 18:25 (Wave 2) + `11e8da24` 2026-04-26 20:03 |
| 21 | Saga 2026-04-26 22:29 | Batch B: `11e8da24` (Wave 4) — DATABASE_URL gap identified-then-deferred 20:34Z |

**Three failed `provisioning_jobs` rows since 2026-04-25** (all `server_pair_id=null`):
- `58f99fb4` 2026-04-25 22:03 — failed (right after P20 saga at 22:02 — likely a P20 retry attempt that immediately re-fired)
- `4fe9574e` 2026-04-26 17:12 — failed
- `6565a01b` 2026-04-26 18:47 — failed (right before P21 saga which started 22:29)

These don't have session_ids in the Phase 1 timeline (worker-side saga halts that didn't surface as CC sessions). Phase 4.1.b worker journal probe will dig for the failure reason.

## 2.3 — Anomalies (drift surfacing)

### Anomaly A — **P0 cross-pair sending_domain collisions (P2 ⨉ P20/P21)**

This is a new finding surfaced this phase. It is the most operationally significant drift item across the audit.

**Live DNS authority (dig +short @8.8.8.8):**

| domain | A record | NS records | claimed by |
|---|---|---|---|
| krogermedianetwork.info | 173.255.199.209 (P20 s1) | ns1/ns2.krogermedianetwork.info | **P20** |
| krogermediapartners.info | 104.237.145.127 (P20 s2) | ns2.krogermedianetwork.info / ns1.krogermedianetwork.info | **delegated to P20** |
| krogeradvertise.info | 97.107.135.107 (P21 s1) | ns1/ns2.krogermarketinggroup.info | **P21** |
| krogerbrandconnect.info | 97.107.135.107 (P21 s1) | ns2.krogermarketinggroup.info / ns1.krogermarketinggroup.info | **P21** |

**But the dashboard's `email_accounts` table claims P2 owns them:**

P2 has 30 active accounts at 10 distinct email domains, 3 accounts per domain. The breakdown:

| P2 email-domain | accounts | also a sending_domain row in | also NS_DOMAIN of |
|---|---:|---|---|
| krogeradsimpact.info | 3 | exclusive ✓ | — |
| krogeradvertise.info | 3 | **P21** | — |
| krogerbrandconnect.info | 3 | **P21** | — |
| krogerbrandengage.info | 3 | exclusive ✓ | — |
| krogerlocalmedia.info | 3 | exclusive ✓ | — |
| krogermedianetwork.info | 3 | exclusive (only P2) | **P20 (apex)** |
| krogermediapartners.info | 3 | **P20** | — |
| krogerpartnerconnect.info | 3 | exclusive ✓ | — |
| krogerretailads.info | 3 | exclusive ✓ | — |
| krogerstoreads.info | 3 | exclusive ✓ | — |

**12 of 30 P2 accounts (40%) are at email-domains whose authoritative DNS now lives on P20 or P21 servers.** P2's `email_accounts.smtp_host` is `mail{1,2}.krogernetworks.info` (P2's own hostname), but the SPF/DKIM/DMARC records for those 12 domains are now controlled by P20/P21:

- **SPF** for those domains will hardfail any send from P2's IP (P21/P20 SPF says `-all` for non-{P21,P20} IPs).
- **DKIM** signing would use P2's keys; verification would FAIL because the domain's DKIM record now points at P21/P20 keys.
- **DMARC** will catch the misalignment and apply quarantine/reject.

**Net: those 12 P2 accounts are operationally dead.** They appear `status='active'` in the DB but cannot send mail successfully.

### Anomaly B — P20 + P21 have 9 sending_domains, not 10

Both Pair A and Pair B are short one sending_domain compared to the typical Linode-era saga output (10 sending). Possible causes:
- Saga halted between domain 9 and 10 (would surface in Phase 4.1.b worker journal for the 2026-04-25 22:02 / 2026-04-26 22:29 saga jobs)
- A domain was DBL-burned at provisioning time and dropped (would show in `dbl_check_history`)
- The saga template was changed to 9 (would show in src/ diff vs golden)

Phase 4 / Phase 5 should determine root cause.

### Anomaly C — P19 12 sending_domains (preserve-wave artifact, already known)

Phase 1 evidence (verbatim from session `fd86b0be`): _"inserted 12 sending_domains rows … DBL listed (5): marketpartners.info, krogerinstoremedia.info, krogerretailimpact.info, krogerentrancemedia.com, …"_. The 12 are kroger-themed and do NOT include the apex `marketpartners.info` itself (apex is the NS_DOMAIN, separately recorded in `server_pairs.ns_domain`). 12 vs typical 10 = +2 explicitly inserted by the preserve-wave script.

**Drift between session-time (5 listed, 8 clean) and now (all 12 clean):** Phase 5a needs to re-DQS each of the 12 to determine current real DBL state.

### Anomaly D — P18 all-30-disabled (already covered Phase 1)

30 disabled with `disable_reason='smtp_connection_failures'`. TLS plumbing fixed in session 68b428b9 but accounts never re-enabled. Phase 5b verdict candidate.

## 2.4 — Drift findings (memory ahead of reality / vice versa)

| Drift | Severity | Detail |
|---|---|---|
| **DRIFT-7 (NEW)** | **P0** | Cross-pair domain collisions: 12 P2 accounts at domains owned by P20/P21. P2 is "active 30/30" in DB but ~40% are operationally dead. |
| **DRIFT-8 (NEW)** | P1 | P20 + P21 have 9 sending_domains each, not the typical 10. Possibly an aborted saga, possibly a template change. |
| DRIFT-9 (schema, NEW) | P3 | `email_accounts` uses `server_pair_id` FK; `sending_domains` + `pair_verifications` use `pair_id`. Three related tables, two FK column names. Phase 4.2.a will check whether the inconsistency causes any code-side bugs. |
| (already known) | — | DRIFT-1: DATABASE_URL on Vercel; DRIFT-2: P18 accounts never re-enabled; DRIFT-3: "P19 on warm-up" claim has no session origin; DRIFT-4: P19 sending_domain DBL state; DRIFT-5: P14 orphan rows; DRIFT-6: PV scoring code bug. |

## 2.5 — CSV-scope set (HALT-decision below)

Per Dean's directive: active pairs except P18+P19, with P1+P3 empty so excluded.

### Strict candidate set (status quo)

| Pair | ns_domain | active accounts | sending_domains | Phase 3.1 preflight risk |
|---|---|---:|---:|---|
| P2 | krogernetworks.info | 30 | 11 | **HIGH — 12 of 30 will fail SPF/DKIM** |
| P11 | caleong.info | 30 | 10 | low |
| P12 | launter.info | 30 | 10 | low |
| P13 | launta.info | 30 | 10 | low |
| P14 | camire.info | 30 | 10 | low |
| P15 | lavine.info | 30 | 10 | low |
| P16 | mareno.info | 24 | 8 | low |
| P17 | cemavo.info | 30 | 10 | low |
| P20 | krogermedianetwork.info | 27 | 9 | low |
| P21 | krogermarketinggroup.info | 27 | 9 | low |
| **TOTAL** | | **288** | **108** | |

### Three ways to handle P2's 12 collision accounts

| Option | P2 in CSV | CSV count | Risk |
|---|---|---:|---|
| A. **Include all 30 P2 accounts**; let Phase 3.1 catch the 12 broken ones | yes | 288 | 12 known-bad accounts get loaded into Snov.io if the preflight is permissive; Snov warm-up tries to send → bounces → reputation hit |
| B. **Filter P2 to 18 healthy accounts** (exclude the 12 collision-domain accounts) | partial (18) | 276 | recommended — surgical exclusion; clean P2 capacity preserved; collision accounts deferred to a P0 cleanup workstream |
| C. **Exclude P2 entirely** | no | 258 | safe but loses 18 healthy accounts |

**Recommended: Option B.** Filter P2's CSV to the 18 healthy accounts (those at `krogeradsimpact / krogerbrandengage / krogerlocalmedia / krogerpartnerconnect / krogerretailads / krogerstoreads .info` — 6 exclusively-P2 domains × 3 accounts = 18). The 12 collision-domain accounts go onto the Phase 7 backlog as a P0 cleanup item: either (a) reassign them to a fresh P2 sending domain, (b) delete them from email_accounts as orphan rows, or (c) move them to P20/P21 if those are the rightful owners (probably not — accounts are smtp_pass-encoded for P2's mail server).

## 2.6 — CSV scope confirmation request to Dean

**Recommended CSV-scope set: 9 pairs, 276 accounts.**

| Pair | ns_domain | Phase 3 CSV row count | per-pair preflight target |
|---|---|---:|---|
| P2 | krogernetworks.info | **18** (filtered, healthy only) | mail.{6 exclusive sending domains} |
| P11 | caleong.info | 30 | mail.{10 sending domains} |
| P12 | launter.info | 30 | mail.{10 sending domains} |
| P13 | launta.info | 30 | mail.{10 sending domains} |
| P14 | camire.info | 30 | mail.{10 sending domains} |
| P15 | lavine.info | 30 | mail.{10 sending domains} |
| P16 | mareno.info | 24 | mail.{8 sending domains} |
| P17 | cemavo.info | 30 | mail.{10 sending domains} |
| P20 | krogermedianetwork.info | 27 | mail.{9 sending domains} |
| P21 | krogermarketinggroup.info | 27 | mail.{9 sending domains} |

That's 10 pairs (the count from HANDOFF — was 9-10 estimate), 276 healthy accounts.

**HALT-decision items for Phase 3:**
1. Confirm Option B for P2 (18 healthy / drop 12 collision accounts)? Or Option A (include all 30, let preflight fail)? Or Option C (exclude P2)?
2. Approve the 10-pair scope above for Phase 3 CSV generation?
3. P2 collision-account cleanup: queue as P0 backlog item for Phase 8 (in this audit), or defer to a separate post-audit session?
4. P20 + P21 9-vs-10 sending_domains anomaly — accept as-is (CSVs will reflect the real 9-domain capacity) or investigate root cause first?
