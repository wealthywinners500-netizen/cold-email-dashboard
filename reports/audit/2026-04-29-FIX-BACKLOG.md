# Phase 9.4b — Audit fix backlog (deferred items + post-audit queue)

**Generated:** 2026-04-28 (V4 streamlined finish, Phase 9.4b)
**Status:** Backlog — items deferred from this audit's Phase 8 scope or surfaced as side observations during execution. Each item has trigger evidence + remediation steps + estimated effort. Surface in Phase 10 PR description "Deferred items" section so Dean catches them in subsequent sessions.

---

## Deferred items (audit-scope items NOT applied this session)

### F-14 — Supabase typed-column regen (deferred from Phase 8.2; P2 → P3 cleanup)

**Trigger:** 30 live-but-untyped columns identified in Wave 4.1.a. Zero typed-accessor callers (Wave 4.2.a empirical re-probe). Future-proofing only — no current functional impact.

**Why deferred:** `npx supabase gen types typescript` requires either Docker Desktop (not installed locally or on worker) or a Supabase Personal Access Token (`sbp_...`, not in `.auto-memory/reference_credentials.md`). Minting a token now adds Dean overhead for a P2 with no current functional impact — defer per audit-streamline directive ("P2s defer").

**Remediation (~5 min once sbp_ token exists):**

1. Mint Supabase Personal Access Token at https://supabase.com/dashboard/account/tokens (one-time setup; choose "Personal Access Token", scope to project `ziaszamgvovjgybfyoxz` or organization-wide).
2. Save the `sbp_...` value to `.auto-memory/reference_credentials.md` under the Supabase section as `SUPABASE_ACCESS_TOKEN: sbp_...` (a slot is proposed in `2026-04-29-MEMORY-PROPOSAL.md` §3c).
3. Run:
   ```bash
   cd "/Users/deanhofer/Documents/Claude/Projects/Master Claude Cowork/dashboard-app"
   SUPABASE_ACCESS_TOKEN=sbp_... npx supabase gen types typescript \
     --project-id ziaszamgvovjgybfyoxz \
     > src/lib/supabase/types.ts
   ```
4. Verify: `cd dashboard-app && npx tsc --noEmit` passes.
5. Atomic commit on a fresh branch (NOT the audit branch; audit is PR-and-stop):
   `audit-followup: F-14 supabase gen types regen (30 live-but-untyped columns)`
6. Re-run `npm run test:gate0` (23 inline steps); confirm green.

**Owner:** Dean (provisioning the token) + a future CC session (running the gen + commit). Estimated 5 min total once the token is saved.

---

## Side observations (NOT in audit scope — surfaced during execution; queued for future sessions)

### Side-1 — F-16 deeper finding: `poll-provisioning-jobs` queue has no worker handler registered

**Trigger:** Phase 7-collapsed (F-16 benign-check). 21,522 pg-boss jobs in `created` state on `poll-provisioning-jobs` queue, steady-state at 14-day retention boundary. F-16 demoted from P1-conditional to P2 (TTL artifact) because the queue is bounded by `retention_seconds=1209600`, not growing unbounded. **However:** the deeper observation is that this is the ONLY queue stuck in `created` state — every other pg-boss queue (`smtp-connection-monitor`, `sync-all-accounts`, `provision-step`, `queue-sequence-steps`, `__pgboss__send-it`, etc.) shows `completed` work. Worker is alive (`systemctl is-active dashboard-worker = active`, processing ~1 active job per poll cycle), just not registered for `poll-provisioning-jobs` specifically.

The cron is firing into a void: emits ~1 job/min, retention sweeps at 14d, the work the queue is supposed to trigger never happens.

**Why deferred:** This is a deploy/config investigation, not a data-integrity bug. Out of audit Phase 8 scope per Dean's "don't expand scope mid-task" directive (V4 Directive 2).

**Remediation (~30 min — investigation, may surface a real fix):**

1. SSH worker, grep `/opt/dashboard-worker/` for handler registrations:
   ```bash
   grep -rEn "boss\.work\(\s*['\"]poll-provisioning-jobs|registerHandler.*poll-provisioning" /opt/dashboard-worker/
   ```
2. Check `src/worker/index.ts` (line ~50, per recent commits) — is `poll-provisioning-jobs` in the handler registration list?
3. If missing → add `boss.work('poll-provisioning-jobs', pollProvisioningJobsHandler)` (handler may need to be written; check git history for prior implementations).
4. If present → check why `consume` isn't firing. Possible: handler errors silently, or queue name mismatch (case-sensitive).
5. Once handler runs, expect `created` count to drain to ~0 within one poll cycle.

**Owner:** any future infra session. Folded into Phase 9.5 worker-drift report for cross-reference.

### Side-2 — `pair-verify` route swallows distinct pg-boss error classes under generic `enqueue_failed`

**Trigger:** Phase 8.1 surfaced the F-1 fix initially failed because the worker's session-mode `DATABASE_URL` (port 5432) was wrong for Vercel's serverless surface (needs transaction-mode 6543). The route at `src/app/api/pairs/[id]/verify/route.ts:96-104` correctly captured the error in the resulting `pair_verifications.checks[0].details.error` JSONB field — but the `name` field is hardcoded to `enqueue_failed`. An operator scanning the verifications history sees `enqueue_failed` regardless of whether the error is `MaxClientsInSessionMode` (config), `ECONNREFUSED` (network), or some other pg-boss send failure. The actual error text is in `details.error`, but it requires drilling into the JSONB to triage.

**Why deferred:** Code change to the saga API route is OUT of audit Hard Rule #9 ("No source code changes outside Phase 8 fixes"). Saga territory.

**Remediation (~30 min — saga-territory code change; needs its own PR + saga-isolation review):**

Replace `name: 'enqueue_failed'` with a classifier:

```ts
catch (queueErr) {
  const errStr = queueErr instanceof Error ? queueErr.message : String(queueErr);
  let errorClass = 'enqueue_failed';
  if (/MaxClientsInSessionMode/i.test(errStr)) errorClass = 'enqueue_pool_exhausted';
  else if (/ECONNREFUSED|ETIMEDOUT/i.test(errStr)) errorClass = 'enqueue_network_unreachable';
  else if (/no listening for queue|queue does not exist/i.test(errStr)) errorClass = 'enqueue_unknown_queue';

  await supabase.from('pair_verifications').update({
    status: 'red',
    checks: [{
      name: errorClass,
      result: 'fail',
      details: { error: errStr, error_kind: errorClass },
      is_sem_warning: false,
    }],
    completed_at: new Date().toISOString(),
  }).eq('id', inserted.id);
  // ...
}
```

Pair with HL #149 (PV scoring plumbing-vs-infra distinction) — same shape: surface error class to the operator UI, don't conflate.

**Owner:** any future saga-touch session (must advance the golden tag per HL #151 + run the saga-isolation invariant test on the new commit).

### Side-3 — `smtp-pass-reader.ts` is misleadingly named (HL #150 backlog)

**Trigger:** HL #150 codifies the F-9 finding: the helper at `src/lib/provisioning/smtp-pass-reader.ts` reads `ssh_credentials.password_encrypted`, NOT `email_accounts.smtp_pass`. The name is a 14-min CC bug magnet — every new CC session that encounters smtp_pass storage has a coin flip on whether they realize the helper isn't applicable.

**Why deferred:** Code rename is saga territory (`smtp-pass-reader.ts` is in FORBIDDEN_FILES via the `src/lib/provisioning/` directory). Out of audit Phase 8 scope.

**Remediation (~15 min — saga-touch refactor):**

1. Rename file: `src/lib/provisioning/smtp-pass-reader.ts` → `src/lib/provisioning/ssh-credential-pass-reader.ts`.
2. Rename exported function: `decryptSmtpPass` → `decryptSshCredentialPass` (or keep symbol with deprecation alias).
3. Update all 3 callers (`worker-callback/route.ts:310-311`, `execute-step/route.ts:717-718`, `provision-step.ts:454`).
4. Add a clarifying comment at top of the renamed file explaining it reads `ssh_credentials.password_encrypted` (AES-256-GCM), NOT `email_accounts.smtp_pass` (plaintext).
5. Update FORBIDDEN_FILES const in `src/__tests__/dbl-resweep-saga-isolation.test.ts` to use the new path.
6. Advance saga golden tag to next pXX per HL #151.

**Owner:** any future saga-touch session. NOT urgent — codify-only debt.

### Side-4 — Phase 8.3 FK pattern observation (HL #154 codifies; remediation already done)

**Trigger:** Phase 8.3 attempt blocked on `system_alerts_account_id_fkey` (default RESTRICT). Audit prompt's per-row gate spec only enumerated `inbox_messages`. Pattern observation: ALL `pg_constraint` referrers must be enumerated pre-DELETE, not just the ones an inherited spec remembers.

**Why "remediation done":** HL #154 codifies the lesson; Phase 9.1 audit-prompt patch #10 propagates the pre-DELETE FK probe into the next iteration of the audit prompt. No code change needed — pattern enforcement is process-level (lesson + spec), not code.

**No backlog action.** Reference: `2026-04-29-HL-PROPOSALS.md` §HL #154 + `2026-04-29-AUDIT-PROMPT-PATCHES.md` §Patch 10.

---

## P2/P3 items NOT in this backlog (deferred to broader workstreams)

These are P2/P3 findings from this audit that don't fit the "deferred" or "side observation" categories — they're Workstream-level work for the post-audit roadmap:

- **F-19 / F-20 / F-21** — IONOS/LINODE/NAMECHEAP env-key naming asymmetry on Vercel + worker. Held P2 per Dean lock; DB-driven creds are the real path; these orphan env-vars are infrastructure cleanup. Folded into the post-audit cleanup pass that touches `.env` files.
- **F-22** — `commandForIgnoringBuildStep=null` on Vercel — clarified in Phase 9.1 audit-prompt patch #4 as conditionally engaged (set during launch freeze). No fix needed; documentation patch only.
- **F-25** — Audit-prompt path drift `/dashboard/pairs/[id]` → `/dashboard/servers/[id]`. Folded into Phase 9.1 audit-prompt patch #2.
- **F-28** — Pair 4 historic Clouding S8 IP `187.33.147.57` has no `ssh_credentials` row. Pre-saga gap; rolls into the relay-migration session per F-32.
- **F-7** — Kernel mismatch on P11-S1 (`5.15.0-176`) vs P11-S2/P12-S1/P12-S2 (`5.15.0-130`). Cosmetic; reboot during next maintenance window will close.
- **F-8** — Cert SAN asymmetry P11-S1 includes `webmail.<sd>` SAN, P12-S1 doesn't. Cosmetic; LE re-issue will close on next renewal.
- **F-18** — 67 untracked debug `.mjs` files in `/opt/dashboard-worker/`. Cleanup item for the worker-housekeeping session.

---

## Workstream queue (Dean's stated order, 2026-04-25 + V4 post-audit roadmap)

Per V4 post-audit roadmap (in `HANDOFF_2026-04-29-V4-DIAGNOSIS-COMPLETE.md` §"TASK 4"):

1. **Workstream 1** — Preserve waves continuation (Salvage-Ionos Wave 3 — `CC_PROMPT_PAIR_B_WAVE_3_2026-04-25.md`, Pair B re-launch). Effort: 1 CC session, ~3-5 hr.
2. **Workstream 2** — P18 + P19 reactivation (relay-migration session). Folds in the F-32 bundling. Effort: 1-2 CC sessions, ~4-6 hr total. **Add F-14 5-min remediation as pre-flight task** (token mint + types regen).
3. **Workstream 3** — 10 panel.* relay-server preserve wave. Effort: 1 reviewer-Cowork plan + 1-2 CC migration sessions.
4. **Workstream 4** — P2 recommission (rebind 18 non-collision rows to NEW Linode pair, NOT reactivate Clouding). Effort: 1 CC session, ~2-3 hr. **Add Side-1 (`poll-provisioning-jobs` worker handler investigation) as a sub-task** since both touch worker-side state.
5. **Workstream 5** — App-building (B16 hands-free, Phase 6A role partitioning, etc.). Multi-week.

**Side observations 2 + 3 fit Workstream 5** (saga-touch refactors that should land alongside the next major saga PR cycle to amortize the saga-tag advancement cost).

— end of backlog —
