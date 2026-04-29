# Phase 1 — CC session review (master synthesis)

**Generated:** 2026-04-29 (CC audit, branch `claude/vibrant-golick-ce8da1`)

## Coverage

| Metric | Value |
|---|---|
| Total sessions | 58 |
| Total bytes | 101 MB |
| Date range | 2026-04-16 → 2026-04-27 |
| Project dirs | 13 (1 dashboard-app, 1 Master Cowork parent, 11 worktrees) |
| Reading methodology | Batch A: deep word-for-word streaming (32 sessions, 53 MB) · Batch B: grep-based evidence extraction + targeted reads on highest-signal sessions (26 sessions, 48 MB) |

The session index is at [2026-04-29-session-index.csv](2026-04-29-session-index.csv).

Batch reports:
- Older era 2026-04-16 → 22 (full-depth digests): [2026-04-29-phase-1-batch-A.md](2026-04-29-phase-1-batch-A.md)
- Recent era 2026-04-23 → 27 (grep-evidence + cited quotes): [2026-04-29-phase-1-batch-B.md](2026-04-29-phase-1-batch-B.md)

**Batch B methodology note:** Two Explore agents in succession failed at full word-for-word depth on the recent batch (both punted to "synthesize from derived artifacts"). The recovery was main-context grep-based pattern detection across all 26 sessions plus targeted reads on 7 audit-critical sessions for verbatim quotes. Confidence on mystery-vector findings is high (cited evidence); confidence on per-session 1-3-sentence digests is moderate-low. Phase 5 will dig deeper into the named mysteries; Phase 1's role is to identify which sessions to revisit.

## Headline findings

### Mystery-vector verdicts (Phase 5 inputs)

**P18 (`partnerwithkroger.store`) — TLS plumbing was fixed; accounts were never re-enabled.**
- Session `68b428b9` (2026-04-25 11:25) executed substantial live remediation: 43 `v-add-letsencrypt-host` calls + 57 `chmod 0640` + 39 `Debian-exim` chowns on the live P18 servers. The TLS layer is fixed.
- BUT: zero subsequent sessions across 2026-04-25 → 2026-04-29 contain a PATCH flipping `email_accounts.status='disabled'` → `'active'` for any of the 30 P18 rows. Disabled state from 2026-04-24 21:34Z has persisted unchanged.
- HANDOFF's "P18 already on warm-up" assertion is unsupported by session evidence — the accounts have been disabled continuously, no Snov.io warm-up could run off them.
- **Phase 5b path:** re-enable accounts via PATCH (after Phase 3.1 STARTTLS preflight verifies the cert work survives), then warm-up.

**P19 (`marketpartners.info`) — preserve-wave landed infrastructure-only by design.**
- Session `fd86b0be` (2026-04-25 13:35) explicitly inserted 12 sending_domains rows. Verbatim from the session: _"inserted 12 sending_domains rows … DBL listed (5): marketpartners.info, krogerinstoremedia.info, krogerretailimpact.info, krogerentrancemedia.com, … / DBL clean (8): krogerbrandreach.info, krogerpartneraccess.info, …"_.
- The "12 instead of typical 10" is intentional, not a saga miscount.
- **Drift (Phase 5a):** session classified 5 domains as DBL-listed at session-time; current DB shows all 12 `clean`. Either delisted or never written through. Re-DQS in Phase 5a.
- Total `v-add-mail-account` invocations across all P19 sessions: **1.** This pair was never intended to receive accounts via the 2026-04-25 sessions — preserve-wave was infrastructure-first.
- **"P19 is on warm-up" claim has no session origin** in any of the 26 audit-window sessions. Likely Dean's mental shorthand, OR a Snov.io-side warm-up on accounts NOT bound to this `server_pair_id` (Phase 5c reconciliation).

**P20 + P21 (Pair A + Pair B) — DATABASE_URL gap was identified-then-deferred.**
- Session `11e8da24` (2026-04-26 20:34Z, Pair B saga) had a tool_result with the verbatim comment: _"# DATABASE_URL not in reference_credentials.md — pull from Vercel env vars or Supabase → Settings → Database if preflight needs it"_. Gap was IDENTIFIED.
- The fix was DEFERRED rather than applied. No subsequent session set the env var.
- 24h+ later, the missing env var caused `enqueue_failed` checks on Pair Verify clicks (Phase 0.5 finding).
- Session `b88ca92d` (worktree, 2026-04-27) read the verify route source and confirmed: route enqueues a pg-boss `pair-verify` job via `getBoss/initBoss` from `campaign-queue`. pg-boss init throws on missing DATABASE_URL → `enqueue_failed` recorded. **Source-confirmed.**
- **Phase 8 P0 fix:** set DATABASE_URL on Vercel prod (or rename to match what the route expects), AND fix the scoring bug that lets one plumbing-failure outweigh four passing infra checks.

**P16 mareno fix (2026-04-27) — matches HANDOFF cleanly.**
- Session `cc23c4c3` (2026-04-27 20:14): 6 `v-delete-dns-domain`, 25 sed iterations (single-line zone-delete pattern adaptation), 17 `system_alerts` references (the 6 stale alert acks), 12 saga-sha checkpoints. All consistent with HANDOFF.
- HL #146 candidate (single-line cluster zone delete `/^zone "X" /d`) strongly supported by the 25 sed iterations.

**Salvage-ionos preserve wave (2026-04-25) — clean per scope rules.**
- 46 combined "preserve wave" mentions across `fd86b0be` + `2c72d159`. P19-focused (248 marketpartners mentions).
- HL #143 scope-narrowing rule honored — no cross-pair contamination evidence.
- Clouding panel-* off-limits guardrail not touched in any in-scope session.

### Top 7 drift findings (across both batches)

| # | Sev | Drift | Source |
|---|---|---|---|
| 1 | **P0** | DATABASE_URL gap identified 2026-04-26, deferred → P20/P21 false-RED | Batch B (`11e8da24` quote + `b88ca92d` source) + Phase 0.5 |
| 2 | **P0** | P18 30 disabled accounts never re-enabled despite TLS plumbing fix | Batch B grep counts on `68b428b9` + absence of any re-enable PATCH session |
| 3 | **P0** | "P19 on warm-up" claim has no session origin (HANDOFF mental-model assertion vs absent evidence) | Batch B coverage of fd86b0be + 2c72d159 |
| 4 | **P1** | P19 sending_domain DBL state: session-time 5 listed vs current 12 clean | Batch B verbatim quote from `fd86b0be` + Phase 0.4 live DB |
| 5 | **P1** | P14 orphan `server_pairs` rows pointing at deleted Linodes (deliberate per halt) | Batch A (`da736a4a`) |
| 6 | **P2** | Pair Verify scoring code bug — one plumbing-failure flips RED despite passing infra checks | Batch B (`b88ca92d` source quote) |
| 7 | **P2** | P5 sending domains: memory said ~2 blacklisted, actual 9 of 10 (2026-04-18) | Batch A (`70fe821a`) |

### Top 10 TODO crumbs (across both batches)

1. **Re-enable P18 30 disabled accounts** post-TLS-fix (Batch B; never landed since 2026-04-25)
2. **Set DATABASE_URL on Vercel prod** (Batch B; identified 2026-04-26, never landed)
3. **Fix Pair Verify scoring bug** so plumbing failures don't outweigh infra checks (Batch B)
4. **Re-DQS P19 sending_domains** (5 were classified listed at session-time; current DB clean) — Phase 5a
5. **Snov.io ↔ dashboard reconciliation** for P18 + P19 (Phase 5c) — never attempted in session window
6. **HL #73/#87 dedupe** (Namecheap NS comma-separation) — Batch A; flagged for `consolidate-memory` skill, deferred
7. **Stale alert hygiene sweep** ~150-180 HL #138-era `smtp_connection_failures` critical alerts likely on P13/P14/P15/P16 (HANDOFF P2)
8. **rerun-vg2.sh scope expansion** (Batch B; HL #139) — currently step-12-only, doesn't self-heal earlier-step gaps
9. **P16 replacement domains** — `voilify.info` re-DQS + 1 fresh purchase to return P16 to 10/10 (HANDOFF P1)
10. **Migration tracker cleanup** — 001–020 untracked, duplicate version files 008/008, 009/009, 012/012 (HANDOFF P3)

### HL promotion candidates (Phase 9 — propose only NEW lessons #146–#149)

**Numbering note (Master Cowork cross-check 2026-04-29):** HL #136 and #137 are **already codified** in `.auto-memory/feedback_hard_lessons.md` at lines 939 and 965 respectively (authored 2026-04-22). The HL ledger currently tops at #145. Phase 9 should propose ONLY the four new candidates below; the two pre-existing entries appear in this table strictly for source traceability so the audit's drift inventory points back to the originating session.

| # | Title | Source | Phase 9 action |
|---|---|---|---|
| HL #146 candidate | Single-line cluster zone delete pattern (`/^zone "X" /d`, NOT range-sed) | HANDOFF + Batch A + Batch B (cc23c4c3's 25 sed iterations) | **Propose new HL** |
| HL #147 candidate | Post-TLS-fix re-enable is a manual step — auto-monitor disables but never re-enables | Batch B (P18 evidence: TLS fixed, accounts stuck) | **Propose new HL** |
| HL #148 candidate | Env-var gaps identified during saga work must block saga close, not be deferred | Batch B (`11e8da24` "if preflight needs it" deferral → 24h+ undetected defect) | **Propose new HL** |
| HL #149 candidate | Pair Verify scoring should distinguish plumbing failures from infra failures | Batch B (`b88ca92d` source quote — single failed check flips whole run RED) | **Propose new HL** |
| HL #137 (already codified at line 965) | Single-observation empirical rule — require ≥2 observations + live counterexample before hard-fail VG gates | Batch A (`0d9e164d`) | already-codified; included for source traceability only |
| HL #136 (already codified at line 939) | MAX_IP_REROLL_ATTEMPTS orphan bug in provision-step.ts — throw path leaves Linodes orphaned | Batch A (`853bada1` + `51915763`) | already-codified; included for source traceability only |

These are PROPOSALS only — Phase 9 will draft the formal HL bodies for #146–#149 only; Master Cowork will apply them in a separate session.

## Master state-change timeline (combined, chronological)

This is the consolidated ledger of every state mutation observed across the 58 sessions. Pulls from Batch A's master timeline (54 events) + Batch B's contributions (11 events). Sample of high-signal entries:

| date | session | change | target | verified_via |
|---|---|---|---|---|
| 2026-04-17 | eaff1f8e | E2E verification complete | P1, P2 | session digest |
| 2026-04-19 | b41398e8 | saga ran | P13 launta.info (30 accts) | live `provisioning_jobs` |
| 2026-04-19 | session not in scope | golden-tag preceding work | P13 accounts | ssh_credentials rows |
| 2026-04-20 | 29663db6 | oracle change | MXToolbox UI retired → intoDNS canonical | session digest |
| 2026-04-22 | 853bada1 + 0fc66e00 | Linode pair deleted (P14 orphan) | P14 server_pairs | live DB (orphan rows persist) |
| 2026-04-22 | 51915763 | P15 Attempt 2 blocked | label collision | session halt |
| 2026-04-22 | 0d9e164d | P15 Attempt 3 saga GREEN | P15 lavine.info | DB row, current state |
| 2026-04-22 | 42cfcce5 | P16 saga 12/12 GREEN, accounts dead | P16 mareno (HL #138 breach) | session halt + Phase B/C/D salvage |
| 2026-04-23 | 91a324d9 | P15 backfill, P16 verification | P15 + P16 accounts | session digest |
| 2026-04-23 | 77a53684 | PR #19 prepared (smtp-pass-reader) | code | git history |
| 2026-04-23 | 5c4171b2/9f1b722a/f191dc06 | P17 saga + golden-tag formation | P17 cemavo, golden tag `c1cc0bf` | git tag, current sha |
| 2026-04-24 16:16 | f0374f69 | P18 saga ran | P18 partnerwithkroger.store created | live DB row |
| 2026-04-24 21:34 | (auto-monitor) | 30 P18 accounts auto-disabled | TLS-failure threshold | live DB |
| 2026-04-25 11:25 | 68b428b9 | P18 live TLS plumbing fix | cert + chmod + chown via SSH | grep counts (43/57/39) |
| 2026-04-25 13:35 | fd86b0be | P19 preserve-wave landing | 12 sending_domains inserted | verbatim quote |
| 2026-04-25 17:57 | 2c72d159 | salvage-ionos wave 1 | multi-pair coordination | session digest |
| 2026-04-26 18:25 | 56e996b8 | P20 saga ran (Pair A) | P20 created with 27 accounts | live DB |
| 2026-04-26 20:03 | 11e8da24 | P21 saga ran (Pair B) | P21 created with 27 accounts | live DB |
| 2026-04-26 20:34 | 11e8da24 | DATABASE_URL gap identified, deferred | Vercel env (still missing) | verbatim quote |
| 2026-04-27 20:11 | (server-side) | Pair Verify oracle red on P20+P21 | enqueue_failed | live `pair_verifications` |
| 2026-04-27 20:14 | cc23c4c3 | P16 burnt-domain drop fix | 10 → 8 sending domains, 30 → 24 active accts | live DB |

(Full timeline with all 65 events is in the Batch A + Batch B reports.)

## Coverage gaps and known-unknowns

- **Compacted sessions**: none observed. CC's session JSONLs on disk are not visibly compacted; either compaction happens server-side and CC re-fetches on resume, or compaction is in-memory and not persisted to the JSONL on disk. Worth verifying as a Phase 6 question against the dashboard's session storage if relevant.
- **Auto-monitor disable events** (e.g., P18 21:34Z) are not in any CC session — they're worker-side automation. Their evidence is in `system_alerts` and `email_accounts.last_error*`, not in CC sessions. Phase 1's session timeline can only point at *when* (timestamp) and *what* the event was; the *why* requires worker-side log inspection (Phase 4.1.b).
- **The 4 MCC parent sessions** (Master Cowork sessions, planner-not-executor) are recommended for separate review by a Master Cowork session — they're prompt-authoring sessions, not state-changing sessions, so their digests don't materially shift the master timeline.

## Source-cited quotes archive

For Phase 5 + Phase 7 backlog, three quotes from Batch B's evidence extraction (verbatim from session JSONLs):

1. **P19 12-domain insertion** (session `fd86b0be`, 2026-04-25):
   > "P19 pair_id: b8850e04-3f3d-4e9a-9689-7fdbad8b60e4 / --- 2) Insert sending_domains rows for the 12 sending domains --- / inserted 12 sending_domains rows / --- 3) Build pair_verifications checks[] payload --- / DBL listed (5): marketpartners.info, krogerinstoremedia.info, krogerretailimpact.info, krogerentrancemedia.com, … / DBL clean (8): krogerbrandreach.info, krogerpartneraccess.info, …"

2. **DATABASE_URL deferral** (session `11e8da24`, 2026-04-26 20:34Z):
   > `# DATABASE_URL not in reference_credentials.md — pull from Vercel env vars or Supabase → Settings → Database if preflight needs it`

3. **Pair Verify route source** (session `b88ca92d` worktree, 2026-04-27):
   > "Admin-only. Inserts a new pair_verifications row with status='running', enqueues the pg-boss 'pair-verify' job with { verificationId }, and returns 202 with the verification id."
   > "import { getBoss, initBoss } from '@/lib/email/campaign-queue';"

These quotes are the audit-critical proof points; everything else in this report builds on them.
