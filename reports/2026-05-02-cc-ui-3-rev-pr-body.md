## Summary

Refactors the campaign detail page from PR #51's 4-tab structure (Overview / Sequences / Recipients / Analytics) to the Instantly-style 5-tab layout (Analytics / Leads / Sequences / Schedule / Options), adds two missing schema columns (`campaigns.tags`, `campaigns.assigned_account_id`), removes the in-page Subsequences section (subsequences move to `/dashboard/follow-ups` in CC #UI-4), and reorders the sidebar to put Leads before Campaigns.

## What changed

| Area | Change |
|---|---|
| **Schema (additive)** | Migration `025` adds `campaigns.tags TEXT[] NOT NULL DEFAULT '{}'` + GIN index; migration `026` adds `campaigns.assigned_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL` + partial index. Both `IF NOT EXISTS`-guarded. |
| **`campaign-detail-client.tsx`** | 4 tabs → 5 tabs; default tab `analytics`; URL `?tab=…` persistence via `window.history.replaceState`. Subsequences section (~82 LOC) deleted. Schedule editor moved to dedicated tab. Recipients tab renamed Leads. Start/Pause/Resume + new Tags input land in Options tab. |
| **`src/lib/supabase/types.ts`** | `Campaign` interface gains `tags: string[]` and `assigned_account_id: string \| null`. |
| **`src/app/dashboard/layout.tsx`** | `navigationItems` reordered: Leads before Campaigns (workflow stage order). |
| **Tests** | Extended `campaign-detail-client.test.ts` with 12 new CC #UI-3-rev assertions; updated `sequence-composer-helpers.test.ts` to drop the now-obsolete in-file subsequence-wiring assertions (the helper-level subsequence contract is preserved). |

## Adaptations from CC #UI-3-rev prompt (ground-verify corrections)

| Prompt assumption | Ground-truth | Action |
|---|---|---|
| Migrations 027 + 028 | Max migration is 024 | Used 025 + 026 |
| `src/lib/email/threading.ts` exports `buildReplyHeaders`; not yet wired | File does **not** exist; outbound threading is already wired inline at `src/worker/handlers/process-sequence-step.ts:158-166` (sets `In-Reply-To` / `References` from `state.last_message_id` and prefixes "Re: ") | Skipped §1.2 wire-fix entirely — there is no gap |
| PR #51 PATCHes `tags` & `assigned_account_id` (silent breakage) | PR #51 commit message: *"Sub-feature E (email account picker) HALTED — campaigns.assigned_account_id does not exist"*. Tags input was also not shipped. | Migrations are still useful (real consumer for tags via new Options-tab input; future-use for assigned_account_id) — but framing is "additive future-use", not "fix silent breakage" |
| "Account picker shipped by PR #51 — relocate to Options tab" | Account picker NOT shipped by PR #51 | Skipped account-picker UI in this CC; deferred to CC #UI-4 along with sequence-engine refactor |

Full design doc with line-range mapping and per-file rollback isolation: `reports/2026-05-02-cc-ui-3-rev-design.md`.

## Saga / sender-pipeline carve-out

- No changes to `src/lib/provisioning/`, `provision-*` handlers, `pair-verify`, `rollback-*`, `smtp-manager.ts`, `error-handler.ts`, `imap-sync.ts`, `smtp-connection-monitor.ts`, `sidecar-health-monitor.ts`, `panel-sidecar/`, `sequence-engine.ts`, or `/api/campaigns/[id]/send/route.ts`.
- `email-preparer.ts` and `process-sequence-step.ts` are read-only in this CC (the §1.2 threading-wire edit was skipped because outbound threading is already wired).

## Test plan
- [ ] Migrations 025 + 026 apply idempotently (verified locally; re-applies as no-ops via `IF NOT EXISTS`).
- [ ] `npm run typecheck` clean.
- [ ] `npm run build` clean.
- [ ] `npm run test:gate0` GREEN (330 ✓ across 45 source-grep / unit modules).
- [ ] Vercel deploy READY post-merge.
- [ ] Probes 1-8 GREEN per `reports/2026-05-02-cc-ui-3-rev-deploy.md`.
- [ ] **Probe 8 critical safety:** `email_send_log` count for smoke campaign = 0 (no live sends triggered by Start button check).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
