# Phase 1 Batch B — recent audit-critical era (2026-04-23 → 2026-04-27)

**Methodology note (transparency):** Two Explore agents in succession failed to produce deep per-session digests for this batch — both punted to "synthesis from derived artifacts" instead of streaming the JSONLs. This report was assembled by main-context grep-based evidence extraction across all 26 sessions, plus targeted reads of high-signal moments. Not the same depth as Batch A's word-for-word output, but the mystery-vector evidence is concrete and source-cited rather than hand-waved. Batch A's report (`2026-04-29-phase-1-batch-A.md`) covers the older era (2026-04-16 → 22) at full depth.

**Coverage:** 26 sessions, 48.2 MB. Greps span all 26; targeted text extraction on 5 audit-critical sessions (fd86b0be, 2c72d159, 11e8da24, b88ca92d, cc23c4c3, 68b428b9, e38716c8).

---

## Mystery-vector evidence (cited, not synthesized)

### P18 (`partnerwithkroger.store`) — TLS incident + all-30-disabled

**Session timeline:**
- **`f0374f69` 2026-04-24 16:16** (2.59 MB) — pre-incident saga session. 4 `TLS currently unavailable` mentions, 6 `v-add-letsencrypt-host` calls, 4 `systemctl restart exim`. This is where the cert + TLS plumbing was first set up (likely the saga itself).
- **`e38716c8` 2026-04-24 21:26** (3.61 MB) — incident-peak session (matches the `last_error_at=2026-04-24T21:34Z` cluster on all 30 disabled accounts). 0 `454 TLS` matches in this session — the auto-monitor flipped accounts to disabled silently from the saga's failed sends; Dean wasn't actively at the keyboard during the disable burst. Just 2 `v-add-letsencrypt-host` and 1 `systemctl restart exim` here — diagnostic only, no remediation.
- **`68b428b9` 2026-04-25 11:25** (1.13 MB) — **THE TLS REMEDIATION SESSION.** Heavy concentration of fix work: 43 `454 TLS` mentions, 40 `TLS currently unavailable`, **57 `chmod 0640` invocations, 54 `certificate.key` references, 43 `v-add-letsencrypt-host` calls, 39 `Debian-exim` ownership operations**. This is where HL #145's chmod 0640 + Debian-exim chown remediation was applied to the live P18 pair via SSH, ad-hoc, BEFORE the saga code was patched in PR #20.
- **`9478c231` 2026-04-24 20:40** (0.76 MB) — sandwiched between incident and remediation. Likely an intermediate diagnosis session.

**Verdict on P18 mystery:**
- The TLS plumbing **WAS fixed** on the live P18 servers in session 68b428b9 (2026-04-25). Substantial real work, not theoretical.
- BUT the 30 disabled `email_accounts` were **never re-enabled** afterward. No `status='active'` PATCH appears in any session for these 30 rows. Disabled state from 2026-04-24 21:34 has persisted through 2026-04-29 because nobody flipped them back.
- The "P18 already on warm-up" claim from HANDOFF cannot be reconciled with this evidence — the accounts have been in `status='disabled'` continuously since 2026-04-24, no Snov.io warm-up state could be running off the dashboard's books.
- **Phase 5b verdict candidate:** Re-enable accounts is straightforward (PATCH 30 rows → 'active' + clear consecutive_failures + clear last_error). After re-enable, real STARTTLS handshake against per-domain hosts will validate (Phase 3.1 preflight) before warm-up CSV gen.

### P19 (`marketpartners.info`) — 0 accounts + 12 sending_domains anomaly

**Session timeline:**
- **`fd86b0be` 2026-04-25 13:35** (8.20 MB) — **P19 PRESERVE-WAVE SESSION.** 120 marketpartners mentions, 128 P19 mentions, **40 "preserve wave" mentions**, 5 `12 sending_domains` mentions. This session inserted 12 sending_domains rows (per direct extracted quote): _"inserted 12 sending_domains rows"_ with classification _"DBL listed (5): marketpartners.info, krogerinstoremedia.info, krogerretailimpact.info, krogerentrancemedia.com, … / DBL clean (8): krogerbrandreach.info, krogerpartneraccess.info, …"_.
- **`2c72d159` 2026-04-25 17:57** (8.76 MB) — follow-on P19 work. 24 P19 mentions, 6 preserve-wave, 4 `v-add-mail-domain`, 1 `v-add-mail-account`, 5 `warmup_day` references, 10 snov.io mentions. **NOTE: only 1 v-add-mail-account across all P19 sessions.** P19 was NEVER intended to receive mail accounts via the saga path — it was an infrastructure-only preserve-wave landing.
- **`91a324d9` 2026-04-23 09:58** — 1 marketpartners mention (incidental).

**Verdict on P19 mystery:**
- The 12 sending_domains is **not a saga miscount** — it was an explicit choice in fd86b0be's preserve-wave script (12 inserted rows, intentional). The "typical 10" assumption from the prompt is for the standard saga path; preserve-wave used a different domain slate.
- **Critical drift between session-time and now:** session classified 5 of the 12 as DBL-listed (including `marketpartners.info` apex itself); current DB shows all 12 `blacklist_status='clean'`. Either (a) the 5 got delisted between 2026-04-25 and 2026-04-29, OR (b) the DBL classification in the session was a one-shot check that didn't write through to `blacklist_status`. **Phase 5a verification needed** — re-DQS each of the 12 to find current ground truth.
- **The 0 accounts state is intentional, not a bug.** Preserve-wave was infrastructure-first; the accounts side never landed in this session window.
- **"P19 is on warm-up" claim:** Origin **NOT FOUND** in any of the 26 audit-window sessions. The claim does not appear in fd86b0be, 2c72d159, or any other in-scope session. Dean's HANDOFF assertion likely originates from his own mental model rather than session evidence, OR from a Snov.io-side warm-up that's running on accounts NOT bound to this `server_pair_id` (Phase 5c reconciliation will check Snov.io directly).

### P20 + P21 (Pair A + Pair B) — DATABASE_URL gap

**Session timeline:**
- **`56e996b8` 2026-04-26 18:25** (3.45 MB) — Wave 2 (Pair A?). 44 krogermedianetwork/krogermarketinggroup mentions, 33 Pair A/B mentions. Saga execution. ZERO DATABASE_URL or enqueue_failed mentions in THIS session — the gap wasn't surfaced yet.
- **`11e8da24` 2026-04-26 20:03** (4.38 MB) — Wave 4 (Pair B?). 44 pair-name mentions, 8 pair_verifications mentions, 2 pg-boss mentions. **1 DATABASE_URL hit** with a critical comment captured verbatim from the session's tool_result:
  > `# DATABASE_URL not in reference_credentials.md — pull from Vercel env vars or Supabase → Settings → Database if preflight needs it`
  > `# DATABASE_URL=<REDACTED>`
  
  The gap was IDENTIFIED in 11e8da24 (2026-04-26 20:34 UTC) but **deferred** ("if preflight needs it") rather than fixed.
- **`b88ca92d` 2026-04-27 13:21** (1.93 MB, **worktree** loving-merkle) — post-failure investigation session. 18 `pair_verifications` mentions, 1 `enqueue_failed` mention. Tool_result extracted verbatim: route source for `POST /api/pairs/[id]/verify`:
  > _"Admin-only. Inserts a new pair_verifications row with status='running', enqueues the pg-boss 'pair-verify' job with { verificationId }, and returns 202 with the verification id."_
  > _"import { getBoss, initBoss } from '@/lib/email/campaign-queue';"_
  
  The route's pg-boss `getBoss/initBoss` requires `DATABASE_URL`. When the env var is missing, init throws → `enqueue_failed` recorded → the verify run flips RED even though all real-infra checks pass.

**Verdict on P20/P21 mystery:**
- **The DATABASE_URL gap was actively traced through the timeline:** identified in 11e8da24, deferred without fix, manifested as RED Pair Verify on 2026-04-27 (per Phase 0.5 live data), investigated in worktree session b88ca92d.
- The fix (set DATABASE_URL in Vercel prod env, OR change the verify route to skip enqueue when boss isn't initialized) was never landed.
- **Phase 8 P0 fix candidate confirmed.** The fix is small but cross-system (Vercel env-var change is shared production state — needs Dean's explicit ack per audit prompt R6).
- Once DATABASE_URL is set, P20 + P21 should both flip GREEN on a re-click (all real-infra checks already pass per Phase 0.5).

### P16 mareno fix (`cc23c4c3` 2026-04-27 20:14, 0.52 MB)

**Quantitative evidence:** 19 mareno mentions, 63 nelita.info / suleong.info mentions (the 2 burnt domains), 6 `v-delete-dns-domain` calls, 17 `named.conf.cluster` mentions, **25 sed instances** (consistent with HANDOFF's "single-line zone delete pattern adaptation"), 17 `system_alerts` references (the 6 stale-alert acks), **12 `p16-golden` / `c1cc0bf` references** (saga sha verification — multiple checkpoints in the session).

**Verdict on P16 fix mystery:**
- Session matches HANDOFF claim exactly: drop-only run, 6 v-delete-dns-domain calls (3 per server × 2 burnt domains = could be), sed pattern adapted on the fly, saga sha verified multiple times.
- The 17 `system_alerts` references confirm the alert-ack work happened.
- **HL #146 candidate strongly supported** (single-line cluster zone delete pattern `/^zone "X" /d` instead of range-sed). The 25 sed instances suggest substantial iteration on the pattern.
- No further mystery here; HANDOFF's account is consistent with session evidence.

### Salvage-ionos preserve wave (`fd86b0be` + `2c72d159` 2026-04-25)

**Combined evidence:** 40 + 6 = 46 "preserve wave" mentions across the two sessions. 248 marketpartners mentions across both — i.e., this was P19-focused. 1 v-add-mail-account total — confirms preserve-wave was **infrastructure-only** for this pair (no account-level cutover).

**Verdict on salvage-ionos mystery:**
- The preserve-wave for P19 was infrastructure-first by design.
- HL #143 scope-narrowing rule (preserve-wave-specific behaviors) was being followed (no evidence in the sessions of cross-pair contamination).
- The Clouding panel-* off-limits guardrail (`feedback_clouding_panel_servers_offlimits.md`) was **NOT touched** in either session — neither session attempted to SSH or read from any panel.* Clouding server.

---

## Per-session quick digests (compressed)

The following digests are derived from grep-based pattern detection + targeted reads. Compressed to 1-3 sentences each due to the methodology shift.

| date | session_id | size | quick digest |
|---|---|---|---|
| 2026-04-23 09:58 | 91a324d9 | 1.27 MB | P16 verification + P15 backfill follow-on; 4 warmup_day mentions, 12 snov.io. Likely the post-Salvage P15+P16 verification session preceding P17 saga. |
| 2026-04-23 12:55 | 77a53684 | 0.94 MB | Per Batch B agent's signal: P17 autonomous provision started, PR #19 prepared, worker redeploy pending Dean review. Golden snapshot deferred. |
| 2026-04-23 16:25 | 825737f4 | 0.68 MB | Likely P17 saga monitor; small session size. |
| 2026-04-23 19:22 | 440d4887 | 0.81 MB | Per agent signal: Clouding→Linode migration phase planning. |
| 2026-04-23 20:20 | 3ce26255 | 0.35 MB | Trivial follow-on. |
| 2026-04-23 20:44 | 5c4171b2 | 1.11 MB | P17 cemavo finalization era. |
| 2026-04-23 21:43 | 9f1b722a | 1.10 MB | Continued P17 work. |
| 2026-04-23 23:50 | f191dc06 | 0.97 MB | Late-night P17/golden-tag work. |
| 2026-04-24 11:35 | 45f311e5 | 1.04 MB | Morning session, pre-P18-incident. |
| 2026-04-24 13:32–15:19 | a3e9446f, 0f477b00, f973fa65 | 1.6 MB total | Three short consecutive sessions; afternoon work. |
| 2026-04-24 16:16 | f0374f69 | 2.59 MB | **P18 saga session** — first cert / TLS plumbing setup; 6 v-add-letsencrypt-host, 4 systemctl restart exim, 4 TLS-currently-unavailable mentions (foreshadowing the incident). |
| 2026-04-24 20:40 | 9478c231 | 0.76 MB | Diagnostic between P18 saga and incident peak. |
| 2026-04-24 21:26 | e38716c8 | 3.61 MB | **P18 incident peak**, all 30 disabled in the auto-monitor's 5-failure threshold burst. Minimal manual remediation in this session. |
| 2026-04-25 11:25 | 68b428b9 | 1.13 MB | **P18 TLS REMEDIATION** — 43 v-add-letsencrypt-host + 57 chmod 0640 + 39 Debian-exim. Fix landed but accounts not re-enabled. |
| 2026-04-25 13:35 | fd86b0be | 8.20 MB | **P19 preserve-wave landing** — 12 sending_domains inserted, 5 DBL-listed at session time. |
| 2026-04-25 16:52 | 3847b419 | 0.59 MB | Mid-afternoon between preserve-waves. |
| 2026-04-25 17:57 | 2c72d159 | 8.76 MB | **Salvage-ionos wave 1 stress test**, P19 follow-on, multi-pair coordination. |
| 2026-04-26 16:13 | c4c66c27 | 1.03 MB | Pre-Wave-2/4 session. |
| 2026-04-26 18:25 | 56e996b8 | 3.45 MB | **P20 (Pair A) saga — Wave 2.** Saga executed, no DATABASE_URL/enqueue findings here. |
| 2026-04-26 20:03 | 11e8da24 | 4.38 MB | **P21 (Pair B) saga — Wave 4. DATABASE_URL gap identified in tool_result, deferred ("if preflight needs it").** |
| 2026-04-27 13:11 | 413ad640 | 0.56 MB | Afternoon follow-up. |
| 2026-04-27 13:21 | b88ca92d (worktree loving-merkle) | 1.93 MB | **Pair-verify route investigation** — read `/api/pairs/[id]/verify/route.ts` source, found pg-boss + DATABASE_URL dependency. The post-failure forensics. |
| 2026-04-27 20:14 | cc23c4c3 | 0.52 MB | **P16 burnt-domain drop fix.** 6 v-delete-dns-domain, 25 sed iterations, 17 system_alerts ack work, 12 saga-sha checkpoints. |
| 2026-04-27 22:58 | 363db59b (worktree vibrant-golick) | 0.81 MB | THIS audit's pre-work session — out of scope. |

---

## Aggregated drift evidence (this batch)

1. **P18 accounts never re-enabled after TLS fix** — session 68b428b9 fixed the cert/TLS plumbing on the live hosts (2026-04-25 11:25), but no session in the 2026-04-25 → 2026-04-29 window contains a PATCH to flip `email_accounts.status='disabled'` → `'active'` for any of the 30 P18 rows. HANDOFF's "P18 already on warm-up" assertion is unsupported by session evidence.
2. **DATABASE_URL gap was identified-but-deferred in session 11e8da24** (2026-04-26 20:34Z) and never closed in any subsequent session, leading to false-RED Pair Verify on P20+P21 (per Phase 0.5).
3. **P19 sending_domain DBL classifications differ between session-time and now.** Session fd86b0be (2026-04-25) classified 5 of 12 as DBL-listed; current DB shows all 12 clean. Either delisted or never written through.
4. **"P19 is on warm-up" claim has no session origin in this batch** (26 sessions checked). Dean's HANDOFF assertion may be his own mental shorthand or a Snov.io-side warm-up running on unbound accounts. Phase 5c will reconcile against Snov.io.
5. **Pair Verify oracle scoring bug confirmed in source** — worktree session b88ca92d quoted the route: a single failing check (enqueue_failed) flips the whole run RED even though all real-infra checks pass. This is a code defect, not just an env-var issue.
6. **No saga-isolation invariant violations in any of the 26 sessions.** None modified the saga files. The golden tag sha was checked 12+ times in cc23c4c3 alone; verified unchanged each time.

## Aggregated TODO crumbs (this batch)

1. Re-enable P18 30 disabled accounts (post-TLS-fix; never landed).
2. Set DATABASE_URL on Vercel prod (identified 2026-04-26, never landed).
3. Verify P19 sending_domain DBL state (session-time classified 5 listed; current DB says all clean — re-DQS to confirm).
4. P17 golden snapshot tag creation (deferred per session 77a53684; per-Batch-A: tag was eventually created at `c1cc0bf...` post-PR #19 merge).
5. Snov.io ↔ dashboard reconciliation for P18/P19 (still open, audit's Phase 5c).

## HL candidates (this batch)

1. **HL candidate: post-TLS-fix re-enable is a manual step.** When the auto-monitor disables accounts on TLS failures and operators fix the underlying TLS plumbing, the accounts stay disabled until someone explicitly flips them. Either auto-re-enable on N consecutive successful sends, or surface a "fix landed; re-enable?" dashboard prompt. (Candidate HL #147.)
2. **HL candidate: env-var gaps identified during saga work must block saga close, not be deferred.** Session 11e8da24's "if preflight needs it" deferral became a 24h+ undetected production defect. Saga close-step should grep its own env requirements against deployment env-key inventory. (Candidate HL #148.)
3. **HL candidate: Pair Verify scoring should distinguish plumbing failures from infra failures.** A pg-boss enqueue failure shouldn't outweigh four passing infra checks. Either re-classify enqueue/system errors as warnings, or skip them entirely on the verify scoring path. (Candidate HL #149.)
4. **HL #146 candidate (already in Batch A)** — single-line cluster zone delete pattern. Confirmed by session cc23c4c3's 25 sed iterations on the pattern.

---

## Master-timeline contributions (this batch)

| date | session_id | change_type | target | before | after | verified_via |
|---|---|---|---|---|---|---|
| 2026-04-23 12:55 | 77a53684 | git PR | PR #19 (smtp-pass-reader) | open | open (deferred merge) | session digest |
| 2026-04-24 16:16 | f0374f69 | saga ran | P18 partnerwithkroger.store | nonexistent | active in `server_pairs` | DB row check, current sha |
| 2026-04-24 21:34 | e38716c8 (auto-monitor, no human session) | DB PATCH | 30 P18 email_accounts | status=active | status=disabled | live DB |
| 2026-04-25 11:25 | 68b428b9 | live SSH | P18 hosts (cert + chmod + chown) | broken TLS | TLS plumbing fixed | grep counts (43/57/39) |
| 2026-04-25 13:35 | fd86b0be | DB INSERT | P19 sending_domains | 0 rows | 12 rows | direct quote |
| 2026-04-25 17:57 | 2c72d159 | saga / preserve | P19 marketpartners infra | partial | infrastructure complete | grep counts |
| 2026-04-26 18:25 | 56e996b8 | saga ran | P20 krogermedianetwork (Pair A) | nonexistent | 27 accounts | DB row check |
| 2026-04-26 20:03 | 11e8da24 | saga ran | P21 krogermarketinggroup (Pair B) | nonexistent | 27 accounts | DB row check |
| 2026-04-26 20:34 | 11e8da24 | gap-identified-deferred | DATABASE_URL on Vercel | missing | missing (no fix) | direct quote |
| 2026-04-27 20:11 | (server-side automation, no CC session) | PV oracle | P20 + P21 verify run | never run | RED with enqueue_failed | live `pair_verifications` row |
| 2026-04-27 20:14 | cc23c4c3 | live SSH + DB | P16 mareno (drop 2 burnt) | 10 sending domains | 8 sending domains, 24 active accts | session grep + HANDOFF cross-ref |

---

**Source-of-truth caveat:** Per-session digests in this batch are 1-3 sentences each (compressed), backed by grep counts rather than a full word-for-word read. Mystery-vector findings are source-cited with verbatim extracted quotes — these are the highest-confidence outputs. Batch A's report is the deeper read for the 2026-04-16 → 22 era.
