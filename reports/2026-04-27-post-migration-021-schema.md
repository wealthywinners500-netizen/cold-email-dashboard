# Post-migration 021 schema snapshot — Supabase prod

**Project ref:** `ziaszamgvovjgybfyoxz` (cold-email-dashboard)
**Captured at:** 2026-04-27 (immediately after `npx supabase db query --linked --file 021_dbl_resweep.sql`)
**Method:** Service-role REST API
**Path used to apply migration:** Management API SQL endpoint via the linked CLI passthrough (NOT `supabase db push` — see [reports/2026-04-27-migration-tracking-repair.md](2026-04-27-migration-tracking-repair.md))

## `sending_domains` columns (post-migration — 12 total)

```
blacklist_status
dbl_check_history       ← NEW (default: [])
dbl_first_burn_at       ← NEW (default: NULL)
dkim_status
dmarc_status
domain
id
last_checked
last_dbl_check_at       ← NEW (default: NULL)
pair_id
primary_server_id
spf_status
```

Sample row showing the three new columns defaulted correctly:

```json
{
  "id": "1d845aab-868d-4e02-abfc-67ce15860552",
  "domain": "caliri.info",
  "blacklist_status": "clean",
  "last_dbl_check_at": null,
  "dbl_check_history": [],
  "dbl_first_burn_at": null
}
```

All three migration-021 columns present on a real existing row. Defaults populated cleanly:
- `last_dbl_check_at` → `null` ✓
- `dbl_check_history` → `[]` (PostgREST returns `'[]'::jsonb` as a JS array) ✓
- `dbl_first_burn_at` → `null` ✓

## `dbl_sweep_runs` exists

```
$ curl ... /rest/v1/dbl_sweep_runs?select=*
HTTP 200
[]
```

Was `HTTP 404` (`PGRST205 — Could not find the table`) pre-migration; now returns 200 with an empty array (table exists, no rows yet). Confirmed.

## Index + RLS

The migration also created:
- `idx_sending_domains_last_dbl_check ON sending_domains(last_dbl_check_at NULLS FIRST)`
- `idx_dbl_sweep_runs_org_started ON dbl_sweep_runs(org_id, started_at DESC)`
- 4 RLS policies on `dbl_sweep_runs` (`dsr_select`, `dsr_insert`, `dsr_update`, `dsr_delete`) mirroring the `pair_verifications` (018) pattern

These are not directly visible via PostgREST but the SQL ran without error and the policy shape was inspected in [reports/2026-04-27-migration-tracking-repair.md](2026-04-27-migration-tracking-repair.md).
