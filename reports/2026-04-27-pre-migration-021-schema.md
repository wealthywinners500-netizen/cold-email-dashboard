# Pre-migration 021 schema snapshot — Supabase prod

**Project ref:** `ziaszamgvovjgybfyoxz` (cold-email-dashboard)
**Captured at:** 2026-04-27 (just before `npx supabase db push`)
**Method:** Service-role REST API (`/rest/v1/sending_domains?select=*&limit=1`)

## `sending_domains` columns (pre-migration)

```
blacklist_status
dkim_status
dmarc_status
domain
id
last_checked
pair_id
primary_server_id
spf_status
```

None of the migration-021 columns are present yet:
- `last_dbl_check_at` — absent (will be added)
- `dbl_check_history` — absent (will be added with default `'[]'::jsonb`)
- `dbl_first_burn_at` — absent (will be added)

## `dbl_sweep_runs` — does not exist yet

```
$ curl ... /rest/v1/dbl_sweep_runs?select=id&limit=1
HTTP 404
{
  "code": "PGRST205",
  "message": "Could not find the table 'public.dbl_sweep_runs' in the schema cache",
  "hint": "Perhaps you meant the table 'public.follow_ups'"
}
```

The post-migration snapshot ([reports/2026-04-27-post-migration-021-schema.md](2026-04-27-post-migration-021-schema.md)) is captured immediately after `supabase db push` returns.
