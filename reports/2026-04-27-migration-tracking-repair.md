# Migration tracker repair — Supabase prod (`ziaszamgvovjgybfyoxz`)

**Branch:** `feat/dbl-resweep-2026-04-27`
**PR:** [#21](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/21)
**Date:** 2026-04-27
**Operator:** Claude Code (auto-mode, under Dean's stepwise instructions)

> **Status:** SKELETON — written BEFORE any tracker write per Guardrail 3, so even a mid-loop halt leaves an audit trail. Updates below as each step lands.

---

## 1. Diagnosis

`npx supabase db push` from a clean local clone tried to apply **all 22 migrations starting from 001**. The first one errored with `relation "organizations" already exists (SQLSTATE 42P07)` — proving the schema is already in prod but the tracker `supabase_migrations.schema_migrations` is empty.

### Evidence (captured 2026-04-27, before any repair)

- `npx supabase migration list --linked` shows **every** migration row has an empty `Remote` column.
- Service-role REST verifies the actual schema is fully present and operational: `sending_domains` has its expected pre-021 columns; `organizations`, `server_pairs`, `campaigns`, etc. all exist; the dashboard, saga, and worker have been operating against this schema for weeks (14 active server_pairs, 30+ active email_accounts).
- `dbl_sweep_runs` does NOT exist (correct — migration 021 not applied yet).
- Pre-migration column inventory recorded in [reports/2026-04-27-pre-migration-021-schema.md](2026-04-27-pre-migration-021-schema.md).

### Root cause (interpretation)

The historical migrations (001–020) were applied to prod via some path that did not go through `supabase db push` — most likely the SQL editor or direct `psql`. That path doesn't write to `supabase_migrations.schema_migrations`, so the CLI's view of "what's applied" is empty.

---

## 2. Plan — `migration repair --status applied`

The official Supabase remediation. For each historical migration version, write a row into `supabase_migrations.schema_migrations` marking it as applied. **No SQL is re-run** — only tracking metadata is updated.

### Risk acknowledgement (per Dean)

If any migration's SQL was somehow never applied to prod (despite the application working), marking it applied here will silently skip it forever in future `db push` runs. Accepted because:
- The application is demonstrably operating against this schema with data in every tracked table.
- No alternate path is safe — running each migration from scratch would error on every existing table/column.

### Version set to repair (18 versions, NOT one-per-file)

```
001 002 003 004 005 006 007 008 009 010 011 012 013 014 017 018 019 020
```

Versions **015 and 016 are intentionally absent**:

> **Out-of-scope finding (surface for future Cowork session):** No `015_*.sql` or `016_*.sql` exists in the worktree, AND the tracker also doesn't expect them — both are consistent in skipping these versions. Per a 2026-04-21 audit log entry, "campaign v2 migrations 015/016" were noted as untracked working-tree paths covered by `untracked-snapshot-2026-04-21.tgz` and "handled in a separate session" — that session apparently never resulted in 015/016 being committed. Whether the campaigns_v2 SQL was applied to prod via SQL editor (schema present, files lost) or was abandoned entirely (schema not present) is unresolved. **Not investigated this session.** PR #21 deploy proceeds — migration 021 has no dependency on campaigns_v2 schema.

### Duplicate-version files (008 / 009 / 012)

The tracker shows duplicate-version rows (e.g., two `008` rows) corresponding to `008_atomic_counters.sql` + `008_system_health.sql`. **Hypothesis (to be probed first):** `migration repair --status applied 008` writes a single tracker row, and the CLI's local discovery resolves both files against that single tracker row — i.e. both rows in the listing flip to "Remote applied" after one repair call.

**Probe sequence (Step 2.A → 2.B → 2.C):**
1. Run `migration repair --status applied 008` once.
2. Re-run `migration list --linked`.
3. If BOTH 008 rows now show `Remote=008`, hypothesis confirmed → run the loop for the remaining 17 versions.
4. If only one 008 row shows `Remote`, hypothesis broken → HALT, fall back to direct SQL INSERT into `supabase_migrations.schema_migrations` with per-file version strings.

---

## 3. Execution log

> Updated as steps land.

### Step 2.A — probe `migration repair --status applied 008`

```
$ npx supabase migration repair --status applied 008
Initialising login role...
Connecting to remote database...
Repaired migration history: [008] => applied
Finished supabase migration repair.
```

Exit clean. Single tracker row written.

### Step 2.B — `migration list --linked` after probe

```
   Local | Remote | Time (UTC) 
   ...
   007   |        | 007        
   008   | 008    | 008        ← flipped
   008   |        | 008        ← STILL EMPTY
   009   |        | 009        
   ...
```

**Hypothesis BROKEN.** A single `migration repair --status applied 008` call only flipped ONE of the two `008` local rows. The CLI's `migration list` matches local files to remote tracker rows one-for-one, not many-to-one against a shared version.

### Step 2.C — decision: HALT

Per Dean's explicit halt clause: *"IF only ONE 008 row shows Remote=\"008\" and the other still empty: HALT, the CLI is per-file in remote tracking too, we need a different strategy."*

**Tracker state after probe (real data, NOT clean rollback):**
- One row exists in `supabase_migrations.schema_migrations` with `version='008'`.
- The second `008_*.sql` file is still flagged as un-applied by the CLI.
- It is **unclear which of the two local 008 files** the CLI considers covered by the new tracker row — `008_atomic_counters.sql` or `008_system_health.sql`.

The fallback Dean previously proposed: direct SQL INSERT into `supabase_migrations.schema_migrations` via the Management API SQL endpoint, crafting per-file distinct version strings (e.g., `'008_atomic_counters'` and `'008_system_health'` instead of bare `'008'`). That requires Dean's green light and a confirmation of the table's exact schema (`version` is likely `text PRIMARY KEY` so distinct strings are required).

### Switch to Option C (per Dean, after 2.C halt)

CLI's per-version repair is structurally incompatible with the worktree's duplicate-version files. Renaming them is the proper structural fix but is OUT OF SCOPE for PR #21 (Hard Rule #4 forbids modifying migration files in this PR). Switched to applying 021 directly via the Management API SQL endpoint and inserting one tracker row for `version='021'`.

### Step C.1 — discovered `supabase_migrations.schema_migrations` columns

```json
[
  { "column_name": "version",    "data_type": "text",  "is_nullable": "NO"  },
  { "column_name": "statements", "data_type": "ARRAY", "is_nullable": "YES" },
  { "column_name": "name",       "data_type": "text",  "is_nullable": "YES" }
]
```

PRIMARY KEY is `version` (proven by the earlier UNIQUE behavior + the `ON CONFLICT (version)` clause working in C.4).

### Step C.2 — applied migration 021 via CLI passthrough

Path: `npx supabase db query --linked --file supabase/migrations/021_dbl_resweep.sql` (uses persisted `supabase login` against the Management API SQL endpoint — no raw token exposure needed). Output: empty `rows: []` (DDL doesn't return rows). No error.

### Step C.3 — REST verification

See [reports/2026-04-27-post-migration-021-schema.md](2026-04-27-post-migration-021-schema.md). All three new columns present on `sending_domains` with correct defaults; `dbl_sweep_runs` returns HTTP 200 with `[]` (was HTTP 404 pre-migration).

### Step C.4 — INSERT tracker row for `021`

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('021', '021_dbl_resweep', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING
RETURNING version, name;

-- Result: { "version": "021", "name": "021_dbl_resweep" }
```

### Step C.5 — final tracker state

```
   Local | Remote | Time (UTC) 
   ...
   020   |        | 020        
   021   | 021    | 021        ← marked applied ✓
```

Row `021` now shows `Remote=021`. Future `db push` will skip 021. Other rows still show empty Remote — the historical drift remains unfixed (out of scope, see §5 below).

### Orphan tracker rows from this session

- `version='008'` — written by Step 2.A's probe before we switched to Option C. It covers ONE of the two `008_*.sql` files (which one is indeterminate from CLI behavior alone). Left in place (probe artifact, not harmful).
- `version='021'` — written by Step C.4. Correctly tracks migration 021.

---

## 4. Closing notes

PR #21's deploy is unblocked: migration 021 SQL is applied to prod and tracked. The path used (Management API SQL endpoint via the linked CLI passthrough) is a one-off — it does NOT fix the underlying tracker drift. Future migrations will hit the same wall until the duplicate-version files are renamed and the historical migrations are systematically repaired.

---

## 5. Open items for the next Cowork continuation review session

1. **Supabase migration tracker drift.** 001–020 are not tracked in `supabase_migrations.schema_migrations` (drift pre-existed this session — schema is in prod via SQL editor or older deploys, but the CLI tracker was empty until 2026-04-27 when 008 + 021 got added).

2. **Duplicate-version migration files (008/008, 009/009, 012/012)** — root cause of today's repair friction. Proper fix: rename one of each pair to an unused version slot (e.g., `008_system_health` → `015_system_health` since 015 is unused, or move all duplicates to fresh sequential numbers above 022). Must be a dedicated PR with its own saga-isolation gates because it touches the migrations directory.

3. **Missing 015 / 016 files** (campaigns_v2 work). Files are absent from this branch's history; tracker also doesn't expect them. Either the campaigns_v2 SQL was applied to prod via SQL editor (schema present, files lost) or campaigns_v2 was abandoned (schema not present). Needs independent investigation before any related work proceeds. Per a 2026-04-21 audit-log entry these were noted as untracked working-tree paths covered by `untracked-snapshot-2026-04-21.tgz` and "handled in a separate session" — that follow-up apparently never landed.

4. **Future `db push` will fail until items 1–3 are resolved.** Until then, any new migration must be applied via Management API SQL (the path used here) plus a tracker INSERT, with the same audit-trail pattern.

5. **Hostname / purpose drift on `200.234.226.226`** (worker host). `hostname` returns `mail1.partner-with-kroger.info` (legacy from when the host was a Clouding mail server `newserver9` repurposed as the dashboard worker). Not harmful but causes recurring confusion during SSH probes. Either `hostnamectl set-hostname dashboard-worker-01` on the host, or document explicitly in `project_server_deployment.md`.

6. **Worker journal showing IMAP cert errors** (`IP: 45.79.111.103 is not in the cert's list`). Unrelated to dbl-resweep — sync errors against an upstream IMAP server using a hostname/cert that doesn't include that IP. Pre-existing, not introduced by this PR.
