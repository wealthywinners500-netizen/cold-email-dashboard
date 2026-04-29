# Phase 9.2 — HL proposals (9 new entries: #146–#154)

**Generated:** 2026-04-28 (V4 streamlined finish, Phase 9.2)
**Status:** PROPOSAL — CC writes; Dean acks per-file at the 9.7 HALT; CC then APPENDS verbatim to `.auto-memory/feedback_hard_lessons.md`.
**Append target:** end of `.auto-memory/feedback_hard_lessons.md` (currently tops out at HL #145 — last entry "Real-auth preflight MUST be external STARTTLS + AUTH PLAIN, not localhost-port-25 EHLO" 2026-04-25). DO NOT re-promote HL #136/#137/#140 — already codified per V2 reviewer note.

**Format note:** all entries match the existing `## N. <title> (date)` + `**Why:**` + `**How to apply:**` pattern from `.auto-memory/feedback_hard_lessons.md`.

---

## 146. Single-line cluster zone delete pattern — `/^zone "X" /d`, NOT a range-sed (2026-04-29)

**Why:** Cluster-wide `named.conf.cluster` cleanup during preserve waves and post-DBL-burn drops needs to remove a single `zone "X" { ... };` block while leaving the surrounding zones untouched. Range-sed (`/^zone "X"/,/};/d`) is fragile — comment lines, multi-line includes, or unusual whitespace in adjacent zones can wedge the match window and chew the wrong block. The single-line pattern `/^zone "X" /d` (note the trailing space inside the literal) anchors on the exact `zone "X" {` opening, plus the BIND convention that each zone declaration occupies one line (`zone "domain.tld" { type ... };` all on one line in `named.conf.cluster`). Discovered Phase 1 review of session `cc23c4c3` — 25 sed iterations across the post-launch DBL re-sweep work, all single-line form, all clean. (Re-validated by HL #108: never direct-edit HestiaCP zone files; always via the cluster file or v-update-* helpers.)

**How to apply:** Three rules.

1. **Use the single-line form for zone removal:** `sed -i '/^zone "<domain>" /d' /etc/bind/named.conf.cluster`. The trailing space after the closing quote is critical — it prevents `/^zone "X"` from also matching `/^zone "X-prefix"` zones if the file contains long-lived domains with overlapping prefixes.
2. **Cluster sync after the sed:** `systemctl reload bind9` on master, plus `v-rebuild-dns-domain admin <domain>` if the slave nodes need the deletion explicitly propagated. Without the rebuild, the slave can still serve cached records.
3. **NEVER use range-sed** (`/^zone "X"/,/};/d`) — it can chew adjacent blocks if any zone's `};` closer is on a separate line, if comments interleave, or if a zone definition wraps across lines. The pattern is a footgun even when it appears to work in dev.

Source: 2026-04-29 audit Phase 1 Batch B review of session `cc23c4c3` (post-DBL-burn drop work, 25 sed iterations, zero blast-radius incidents). Companion: HL #108 (never direct-edit HestiaCP zone files).

---

## 147. Post-TLS-fix re-enable is operator-driven — auto-monitor disables but never re-enables; HL #152's specific case (2026-04-29)

**Why:** When the SMTP auto-monitor flags `consecutive_failures >= 5` and flips an `email_accounts` row to `status='disabled'`, the row is sticky. The operator-side fix (TLS plumbing, cert perms, DKIM rotation, host EHOSTUNREACH) does NOT trigger an auto-re-enable. The account stays disabled until someone explicitly PATCHes the row back to `active` AND zeroes `consecutive_failures`. P18 sat 5+ days disabled after its 2026-04-25 TLS fix (HL #145 chmod 0640 cert key) because the post-fix re-enable PATCH never landed. Snov bounce-rate stayed elevated through the whole window even though the underlying SMTP path was healthy by 12:54 UTC on day 1.

**How to apply:** Three rules.

1. **Pair every infra fix with a re-enable step.** For each fix that resolves a known auto-disable cause: (a) one live-auth preflight per HL #140 on a representative account, (b) bulk PATCH of affected disabled rows (`PATCH email_accounts WHERE pair_id=<X> AND status='disabled' SET status='active', consecutive_failures=0, disable_reason=NULL`), (c) wait one `smtp-connection-monitor` cycle (~10 min) to re-validate against the live path. If any account flips back to `disabled` in that cycle, the fix wasn't complete — investigate before declaring the incident closed.
2. **Surface a "fix landed; re-enable?" dashboard prompt.** When the operator marks a system_alerts row as acknowledged AND the underlying alert_type matches `smtp_connection_failure`, the dashboard should suggest a one-click bulk re-enable for accounts whose `last_disabled_at` is within the alert's time window AND whose `disable_reason` matches the alert's `lastError`. The current UI requires manual SQL or a per-row UI flip — too easy to miss for 30+ rows.
3. **Or build an auto-re-enable on N consecutive successful sends.** Trade-off: faster recovery vs. risk of false-positive recovery (a broken account that occasionally succeeds shouldn't auto-re-enable). N=10 successful sends across 2+ recipients within 24h is the conservative threshold.

Source: 2026-04-29 audit Phase 1 Batch B review of P18 evidence; Phase 5b verdict; HL #152 (cascade-disable rollback) is the broader rule, this is its specific TLS-fix case. Companion: HL #140 (real-auth preflight is the gate), HL #145 (chmod 0640 cert key — the upstream fix this lesson chains from).

---

## 148. Env-var gaps identified during saga work MUST block saga close, NOT be deferred (2026-04-29)

**Why:** Session `11e8da24`'s "if preflight needs it" deferral on a missing env-var (the F-1 `DATABASE_URL` gap on Vercel) became a 24h+ undetected production defect. The saga "completed" with a known env-var gap, the operator moved on, and the gap surfaced only when a downstream Pair Verify call hit `enqueue_failed`. The cost of fixing the gap at saga-close is ~5 min; the cost of fixing it after a P0/P1 surfaces is the audit cycle that uncovered it (this audit was triggered partly by F-1's downstream symptoms).

**How to apply:** Three rules.

1. **Saga close-step gates on env-key parity** — after every saga run, the close step should `grep -E '^[A-Z_]+=' /opt/dashboard-worker/.env` (canonical env-key inventory) AND `vercel env ls --environment production --json | jq -r '.envs[].key' | sort` (Vercel env-key inventory) AND compare against an expected manifest (committed file `dashboard-app/env-required.json`). Any divergence FAILS the close step. The saga is not "complete" until parity is achieved. (Manifest needs to be created as a future deliverable.)
2. **Treat env-var observations during saga work as P1 by default**, not "deferred to post-launch." A missing env-var typically manifests as a downstream 500 / `enqueue_failed` / connection-refused — symptoms that look like infrastructure problems but trace back to a config gap. The saga is the right place to gate; downstream symptoms are too late.
3. **No "if preflight needs it" deferrals.** Either it needs it (in which case fix now) or it doesn't (in which case remove the variable from the manifest). Conditional deferrals accumulate as silent debt.

Source: 2026-04-29 audit Phase 1 Batch B review of session `11e8da24`; F-1 root cause (`DATABASE_URL` absent on Vercel from saga-close → only surfaced 24h+ later). Companion: HL #138 (writer/reader metadata contracts must be explicit — same pattern: silent fallback masks the contract violation), HL #149 (Pair Verify scoring conflation).

---

## 149. Pair Verify scoring must distinguish plumbing failures (route can't reach worker) from infra failures (worker says no) — currently both flip status to RED indistinguishably (2026-04-29)

**Why:** A single failed check inside the `pair_verifications.checks` JSONB array flips the whole row's `status` to `red`. There's no distinction in the top-level status between "DNS check failed because the domain isn't propagating yet" (a real infra-state finding) and "the API route couldn't enqueue the job to pg-boss because DATABASE_URL is missing" (an entirely different class — plumbing on the dashboard surface, not the pair). Phase 8.1 surfaced this directly: F-1's symptom was a `red` PV row with `checks[0].name='enqueue_failed'`, side by side in the UI's "recent verifications" list with rows whose red comes from real DBL failures. The operator can't tell them apart at a glance, so plumbing failures get triaged as infra problems and get fixed slowly.

**How to apply:** Three rules.

1. **Add a `result_class` (or `failure_kind`) field to each row of `pair_verifications.checks`.** Values: `infra_state` (the real check returned a fail), `transient` (timeout or retryable error), `plumbing` (the route couldn't even reach the worker — env-var gap, network, Vercel cold-start beyond timeout). The top-level `status` synthesis: if ALL fails are `plumbing`, status=`red_plumbing` (a distinct color in the UI). If ANY are `infra_state`, status=`red`. If only `transient`, status=`yellow_retry`.
2. **Surface the distinction in the UI's verification history table.** A `red_plumbing` row gets a wrench icon and a tooltip "Plumbing — operator fix needed on dashboard side, not on pair." A `red` row gets the standard alert icon and routes to the per-pair drilldown.
3. **The `pair-verify` API route at `src/app/api/pairs/[id]/verify/route.ts:96-104` already swallows pg-boss send errors under generic `enqueue_failed`** — extend that catch block to set `result_class='plumbing'` AND record the actual error class (`MaxClientsInSessionMode`, `ECONNREFUSED`, etc.) in `details.error_class` for debug visibility. The current `details.error` field captures the message but doesn't classify.

Source: 2026-04-29 audit Phase 1 Batch B review of session `b88ca92d` (the original Pair Verify scoring code review); reinforced by Phase 8.1 finding (F-1 `enqueue_failed` PV row indistinguishable from real DBL fails). Companion: HL #138 (silent fallback masks failure until send time), HL #148 (env-var gaps must block saga close), HL #153 (pooler mode per consumer surface — Phase 8.1's specific manifestation).

---

## 150. `email_accounts.smtp_pass` is plaintext at rest; `ssh_credentials.password_encrypted` is AES-256-GCM. Two columns, two storage formats. Don't conflate. (2026-04-29)

**Why:** F-9 surfaced during Phase 3.1.5 cert remediation: a CC operator tried to base64-decode `email_accounts.smtp_pass` then GCM-decrypt — and the decoder crashed on what looked like ciphertext but was actually a plaintext password. The saga writes the *already-decrypted* `serverPassword` directly to `email_accounts.smtp_pass` per `worker-callback/route.ts:335` and `execute-step/route.ts:748`. The helper `src/lib/provisioning/smtp-pass-reader.ts` (HL #133/#138) reads `ssh_credentials.password_encrypted` (AES-256-GCM, base64-encoded `iv+ciphertext+authTag`) — a different column on a different table. The naming is misleading: `smtp-pass-reader.ts` does NOT read `smtp_pass`. V3 reviewer verified via 5-row sample — every audited account's `smtp_pass` was plaintext, not encrypted.

**How to apply:** Four rules.

1. **`email_accounts.smtp_pass` is plaintext.** Read it directly from the row. Do NOT base64-decode. Do NOT GCM-decrypt. Use it verbatim as the SMTP AUTH password.
2. **`ssh_credentials.password_encrypted` is AES-256-GCM.** Use `src/lib/provisioning/smtp-pass-reader.ts` (despite its name — the helper reads ssh_credentials, not email_accounts). Pass the row's `password_encrypted` value to `decryptSmtpPass(encrypted, ENCRYPTION_KEY)`.
3. **Add a column-rename ticket to the post-audit backlog**: `smtp-pass-reader.ts` → `ssh-credential-pass-reader.ts` (or keep the helper name but add a clarifying comment at the top of the file explaining it reads ssh_credentials). Until renamed, the misleading name is a 14-min CC bug magnet — every new CC session that encounters smtp_pass storage is a coin flip.
4. **Audit-prompt patch (Phase 9.1 #3) reflects this**: the original prompt's wording "decrypt smtp_pass via smtp-pass-reader.ts" is wrong; the corrected wording is "read smtp_pass directly — it is plaintext at rest."

Source: F-9 (Phase 3.1.5); V3 reviewer 5-row sample verification; saga write-paths at `worker-callback/route.ts:335` + `execute-step/route.ts:748`. Companion: HL #133 (canonical credential persistence), HL #138 (silent-fallback masks failure — same pattern: a misleading helper name lets a CC operator base64-decode a plaintext value and crash).

---

## 151. Saga golden tags follow rolling-anchor `pXX-golden-saga-YYYY-MM-DD` convention — old tags stay frozen as immutable historical references; each saga-modifying PR advances to the next pXX. The TAG sha is necessary but NOT sufficient as a saga-isolation gate. (2026-04-29)

**Why:** F-24 surfaced in Wave 4.2.b: `auto-fix.ts` had drifted +10/-2 between `p16-golden-saga-2026-04-23` (sha `c1cc0bf...`) and main HEAD `00b3260`. The drift came from PR #20 (`6f9b317` — fixSOA empty-MNAME wipe + chmod 0640) which landed 2 days BEFORE PR #21 (`00b3260` — DBL re-sweep + the saga-isolation test framework itself). PR #20 could not have been gated by the framework; PR #21 was the first commit to add `dbl-resweep-saga-isolation.test.ts`. Both Path A (move the tag forward) and Path B (rebase audit onto a new tag) considered; Dean's call: keep `p16` immutable as historical reference, create `p17-golden-saga-2026-04-29` at main HEAD `00b3260` after audit close. Pattern generalizes.

**How to apply:** Four rules.

1. **Tag naming convention:** `pXX-golden-saga-YYYY-MM-DD` where pXX is a monotonically-increasing index and YYYY-MM-DD is the date of the snapshot. Old tags stay forever — they're immutable historical references for reverting or comparing past green states. Each saga-modifying PR (a PR that touches any file in `dbl-resweep-saga-isolation.test.ts`'s FORBIDDEN_FILES const) advances to the next pXX with a fresh date.
2. **The TAG sha is necessary but NOT sufficient as a saga-isolation gate.** Tag sha verification confirms the tag hasn't moved, but it doesn't prevent NEW commits on main from drifting saga files between snapshots. The actual gate is `dbl-resweep-saga-isolation.test.ts` running `git diff --name-only origin/main...HEAD` against FORBIDDEN_FILES + FORBIDDEN_PREFIXES. Both are required: tag sha (no movement of the historical anchor) + per-PR diff test (no new drift).
3. **Two separate measurements when reporting drift:**
   - "F-24 baseline holds (tag..HEAD on saga = N, <files>)" — drift since the last golden snapshot
   - "Audit isolation invariant holds (main..HEAD on saga = 0)" — this branch's purity vs main
   The "drift = 0" framing alone is ambiguous between the two. (See Phase 9.1 audit-prompt patch #11.)
4. **At audit / release close**, advance the tag manually:
   ```bash
   git tag pXX-golden-saga-YYYY-MM-DD <sha-at-which-saga-is-known-green>
   git push origin pXX-golden-saga-YYYY-MM-DD
   ```
   Don't move the prior tag. Don't delete it. Don't force-push it. Each is an immutable line in the history.

Source: F-24 (Wave 4.2.b); Path A REFINED policy decision (V2 + V3 reviewer); audit-prompt patch #1 (saga file count framing 13→16/dynamic). Companion: HL #108 (never direct-edit HestiaCP zone files — same pattern: an immutable boundary you don't violate), HL #135 (HEAD-anchor at audit start for diff comparisons).

---

## 152. Cascade-disable rollback is operator-driven, NOT saga-driven. The 5-failure auto-disable flag is sticky; resolving the root cause does not auto-rehabilitate affected rows. (2026-04-29)

**Why:** F-29 surfaced in Phase 5b's P18 verdict — and reinforced 4 days later when V3 reviewer's mid-audit probe caught the F-33 P2 cascade (30 active → 30 disabled in 6 minutes on 2026-04-28 17:45-51Z, error `EHOSTUNREACH 27.0.174.55:587 / 217.71.202.214:587`). The pattern is consistent across both incidents: when `smtp-connection-monitor` (or any auto-monitor) flags `consecutive_failures >= 5` and flips a row to `status='disabled'`, the row stays disabled. There is no auto-re-enable code path. Every other saga / cron / handler in the codebase only reads `status='active'` rows for sending — a `disabled` row is excluded from work assignment forever, until an operator explicitly PATCHes it back.

V3 grep-confirmed across `src/lib/provisioning/error-handler.ts` + `src/worker/handlers/smtp-connection-monitor.ts`: zero auto-rehab paths exist. This is by design — cascade-disable is a safety mechanism, and auto-re-enable on transient success would defeat its purpose. But the operator-driven recovery step is undocumented in operational runbooks.

**How to apply:** Five rules.

1. **Always pair an infra fix with operator-driven re-enable.** When a saga or post-launch fix resolves the root cause (TLS plumbing, cert-perm, DKIM rotation, host EHOSTUNREACH, DNS propagation), the affected `email_accounts` rows do NOT auto-rehabilitate. Required steps:
   - (a) one live-auth preflight per HL #140 on a representative account
   - (b) bulk PATCH: `UPDATE email_accounts SET status='active', consecutive_failures=0, disable_reason=NULL WHERE pair_id=<X> AND status='disabled' AND disable_reason LIKE '%<root-cause-pattern>%'`
   - (c) wait one `smtp-connection-monitor` cycle (~10 min) to re-validate
2. **Cascade events are "expected state" when the underlying infra is intentionally gone.** Per Directive 1 (V3 reviewer): newserver1-19 deletion → mail1/mail2 IPs route nowhere → P2 cascade is correct behavior, not an incident. The HL says: differentiate "cascade because of transient failure" (re-enable after fix) from "cascade because the infra is intentionally deleted" (DROP the rows, don't rehabilitate).
3. **Sticky disable is the right policy.** Don't add auto-re-enable on N consecutive successful sends — false-positive recovery is the failure mode (account succeeds occasionally on a flaky path, gets re-enabled, then fails worse later). HL #147 explored this trade-off; conservative threshold is N=10 across 2+ recipients within 24h, but even that is risky. Operator-driven is the safe default.
4. **Surface the "fix landed; re-enable?" prompt in the dashboard.** When an operator acknowledges a `system_alerts` row matching pattern `smtp_connection_failure` AND the alert is older than the most recent `provisioning_jobs.completed_at` for the affected pair, the dashboard should suggest the bulk PATCH. Currently the operator has to construct the PATCH manually.
5. **Audit checks should explicitly verify the post-fix re-enable landed.** A "P18 fix complete" without "P18 disabled count = 0" is incomplete. Phase 5b's verdict explicitly captured this gap.

Source: F-29 (Phase 5b); F-33 (Phase 5b mid-audit re-probe); V3 grep across error-handler.ts + smtp-connection-monitor.ts. Companion: HL #140 (real-auth preflight is the gate), HL #145 (TLS chmod 0640 cert key — common upstream root cause), HL #147 (specific TLS-fix case of this rule).

---

## 153. Pooler mode is per-consumer-surface, not per-project. Long-lived daemons use session-mode (port 5432); serverless invocations use transaction-mode (port 6543). Same DATABASE_URL except port. (2026-04-29)

**Why:** Phase 8.1 surfaced this directly: the V4 paste-back's "use the worker's `DATABASE_URL` value as canonical" instruction was wrong for the Vercel surface. The worker is a long-lived process that needs LISTEN/NOTIFY for pg-boss consume — that requires session-mode (port 5432). Vercel API routes are short-lived serverless invocations that need transaction-mode (port 6543) so the pool releases connections at the transaction boundary, allowing thousands of concurrent function instances to share a small pool budget. Trying to use the worker's session-mode value on Vercel produces `MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size` — surfaced as a generic 500 / `enqueue_failed` from the Pair Verify route (the symptom that drove F-1).

This extends an existing in-code lesson: `src/lib/email/campaign-queue.ts:23-37` documents what the codebase calls "Hard Lesson #R3" (2026-04-18, job `b920c716`) — pg-boss's default `max:10` connection pool plus its internal Bam/Timekeeper/Monitor pools can collectively open 20-30 session-mode connections, exhausting Supabase's ~30-client session-pool budget per project. The `max:4` workaround keeps pg-boss under budget. **HL #R3 was never promoted to `feedback_hard_lessons.md`** — this entry codifies it as the architectural truth, not the workaround.

**How to apply:** Five rules.

1. **Two pooler modes, two ports, one DB.** Same Supabase Supavisor cluster supports:

   | Surface | Port | Mode | Why |
   |---|---|---|---|
   | Worker daemon (long-lived) | 5432 | session | needs LISTEN/NOTIFY for pg-boss consume; supports prepared statements + session state |
   | Vercel API routes / serverless | 6543 | transaction | short-lived; pool releases at txn boundary; supports thousands of concurrent invocations |

2. **Don't propagate one consumer's value to another consumer's environment.** When provisioning a new env-var on Vercel based on a worker `.env` value (or vice versa): same host, same user, same password, same db — but **derive the port by surface**. Worker `.env`'s 5432 won't work on Vercel; Vercel's 6543 won't work on the worker (LISTEN/NOTIFY requires session mode).
3. **Symptom mapping** (so future operators recognize the bug shape):
   - Wrong port on Vercel (using 5432 in serverless): `MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size`
   - Wrong port on worker (using 6543 in long-lived process): pg-boss `LISTEN` fails or returns immediately; jobs stuck in `created` forever
4. **HL #R3 (`campaign-queue.ts:23-37`) workaround stays in place** — `new PgBoss({ connectionString, max: 4 })`. This caps the worker's pg-boss to 4 session-mode connections, leaving headroom for the wizard routes + cron polls + direct Supabase queries. The cap is an *additional* safety; it doesn't substitute for getting the port right.
5. **Audit-prompt patches (Phase 9.1 #9) propagate this** — the next iteration of the audit prompt's Phase 8.1 spec must say "derive port by surface" instead of "use worker value as canonical."

Source: F-1 fix execution (Phase 8.1 — port 5432 → 6543 PATCH and re-verify); HL #R3 in-code lesson at `campaign-queue.ts:23-37` (2026-04-18, never promoted before this entry). Companion: HL #138 (silent fallback masks failure — same pattern: wrong port produces a misleading error class, not a clear "wrong-port" message).

---

## 154. Before any production DELETE, enumerate ALL FK constraints referencing the target table via `pg_constraint`. Don't trust an inherited gate spec. (2026-04-29)

**Why:** Phase 8.3 surfaced this directly: the audit prompt's per-row gate spec for Phase 8 DELETEs only enumerated `inbox_messages` as the defense-in-depth check. The actual DELETE attempt failed on `system_alerts_account_id_fkey` (default RESTRICT). Postgres rolled back atomically — zero data damage — but cost a HALT cycle. 4 OTHER FK referrers (`campaign_recipients`, `email_send_log`, `lead_sequence_state`, `inbox_messages`) had safe ON DELETE clauses (SET NULL or CASCADE) plus zero rows for the target IDs, so weren't blocking. The gate spec was incomplete because the audit prompt was authored before the V3 cascade event populated `system_alerts` with rows referencing the target IDs.

The lesson generalizes: any time you write a "this DELETE is safe" gate spec, enumerate ALL FK referrers from `pg_constraint`, not just the ones you remember. Schemas evolve; alert tables get added; new dependencies land between when the gate was written and when it's executed.

**How to apply:** Five rules.

1. **Standard pre-DELETE FK probe** — run before EVERY production DELETE:
   ```sql
   SELECT conname, conrelid::regclass AS referencing_table,
          pg_get_constraintdef(oid) AS clause
   FROM pg_constraint
   WHERE confrelid = 'public.<target_table>'::regclass AND contype = 'f';
   ```
2. **Classify each referrer by ON DELETE clause:**
   - `ON DELETE SET NULL` → safe; Postgres handles automatically. Document in the report.
   - `ON DELETE CASCADE` → safe; the FK referrers also DELETE. Note that data is lost.
   - `ON DELETE RESTRICT` (or no `ON DELETE` clause = default RESTRICT) → **blocks the DELETE**. Must be handled in the same transaction:
     - **Option A (preserve):** if the FK column is nullable, `UPDATE referrer SET fk_col = NULL WHERE fk_col IN (target_ids)`, then DELETE the target. Trade: any join from referrer to target shows NULL; document in operational notes.
     - **Option B (cascade-cleanup):** `DELETE FROM referrer WHERE fk_col IN (target_ids)` first, then DELETE the target. Trade: loses the referrer rows. If they're operational history (alerts, audit logs), capture a forensic snapshot in the report before deleting.
     - **Option C (soft-delete):** don't DELETE the target; UPDATE its `status` to a tombstone value (`'archived'`, `'deleted'`). Trade: requires a code change to filter the tombstone status everywhere; out of scope for one-off cleanups.
3. **Capture pre-DELETE row counts on every referrer** for the target IDs. The report should show the FK landscape table even when most cells are 0.
4. **Atomic transaction.** If multiple DELETEs are needed (e.g., DELETE referrers first, then DELETE target), wrap in a single transaction. If any step fails, abort + HALT — Postgres rolls back without partial state.
5. **Add the FK probe to any future audit-prompt's "per-row gate spec".** The Phase 8.3 attempt cost ~30 min of HALT cycle time; the probe takes 5 seconds and prevents the cycle entirely. (Phase 9.1 audit-prompt patch #10 propagates this.)

Source: Phase 8.3 (2026-04-28, this audit); FK probed via `pg_constraint` after the failure. Companion: HL #152 (cascade-disable rollback is operator-driven — the inverse case, recovering rows; this HL covers the forward case, deleting rows with FK referrers). HL #138 (silent-fallback pattern — same shape: an inherited spec that didn't account for evolved state).

---

## Application order (per Dean's per-file ack at 9.7 HALT)

CC will append all 9 entries verbatim to `.auto-memory/feedback_hard_lessons.md` after Dean acks. Recommended ordering: numerical (#146 → #154). All 9 entries are independent; no internal cross-references that require a specific order.

After append: verify HL count went from 142 unique numbers (per CC's grep — `## 145.` is the last `## N.` heading) → 151 unique numbers (145 + 6 net new entries since #146 starts after #145). Wait — that's 9 new entries, so 145 → 154. Let me re-check the math:
- Pre-append: highest is #145
- Post-append: highest will be #154
- Net new: 9 (numbered #146, #147, #148, #149, #150, #151, #152, #153, #154)

Update `MEMORY.md`'s "144 hard lessons" line to "154 hard lessons" (technically 152 since #85 + #93 are UNRECOVERED stubs — depends on whether MEMORY.md's tally counts stubs).

— end of HL proposals —
