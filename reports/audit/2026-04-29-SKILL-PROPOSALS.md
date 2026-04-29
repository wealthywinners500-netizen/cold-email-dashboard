# Phase 9.7 — Skill proposals (placeholder — no new skills surfaced)

**Generated:** 2026-04-28 (V4 streamlined finish, Phase 9.7)
**Status:** PLACEHOLDER — no new Claude Code skills are proposed by this audit. Per V4 plan §9.7: "none expected for this audit; placeholder if any surface."

## Context

Skills (Anthropic's bundled `~/.claude/skills/*` and project plugin skills) were checked during the audit's normal-flow work but no new skill is recommended. Existing Master-Cowork skills already cover the workstreams that touched this audit:

| Existing skill | Covers (relevant to this audit) |
|---|---|
| `master-command-center` | cross-project routing + memory-ownership enforcement (used by V3/V4 reviewer rounds) |
| `parallel-agents` | the 3-agent dispatch pattern in Wave 4.1 / 4.2 |
| `consolidate-memory` | the auto-memory consolidation mechanic that Phase 9.7 partially exercises |
| `update-config` | settings.json / hooks management — out of audit scope |
| `pair-deployment` | full pair launch via SSH/CLI — touches the saga-isolation invariant correctly |
| `hestiacp-automation` | HestiaCP browser-side ops |
| `domain-verification` / `domain-generator` | preserve-wave companion skills |
| `lead-gen-pipeline` / `snovio-automation` / `follow-up-automation` | downstream consumer-side skills |
| `email-copy-v3` / `ghl-sms-marketing` | campaign-side skills |
| `saas-dashboard-ops` | Next.js dashboard architectural truth — this audit IS this skill's domain |

## Candidates considered (not proposed)

These came up during execution but did NOT meet the bar for a standalone skill:

1. **"audit-runner"** — a skill that orchestrates the 10-phase audit pattern. Considered, but the audit is a one-shot per release/quarter; the existing `master-command-center` skill + the audit-prompt itself already encode the workflow. Building a skill wrapper adds maintenance overhead for a task that runs ~4× per year.

2. **"pre-DELETE FK probe"** — automation around HL #154's standard query (`SELECT FROM pg_constraint WHERE confrelid='<target>'::regclass`). Considered, but the codification in HL #154 is sufficient; a skill would just duplicate the lesson without adding capability beyond what `psql` already does.

3. **"pooler-mode-derive"** — a skill that derives the right port (5432 vs 6543) per consumer surface from a base `DATABASE_URL`. Considered, but HL #153 + the audit-prompt patch #9 propagate the rule operationally; the actual port-flip is a 1-line `urlparse` swap.

None of these justify a new skill.

## Recommendation

No skill changes from this audit. Existing skill bundle is correctly scoped.

If a future audit (V18 or later) finds a recurring multi-step pattern that's NOT captured by an existing skill, that's the right time to propose one.
