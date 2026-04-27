-- Migration 021: weekly post-launch DBL re-sweep
--
-- Adds the schema needed by the dbl_resweep_warmup pg-boss cron (weekly
-- Monday 09:00 ET) and the /dashboard/admin/dbl-monitor admin panel.
--
-- Background — Pair A's krogerengage.info (2026-04-26) and Wave-2-to-Wave-3's
-- krogerlocalmedia.info both proved a sending domain that passed VG1 at saga
-- time can become DBL-listed within hours-to-days post-launch. Today these
-- burns are caught only by manual reviews. Weekly cadence; per-pair scoping
-- supported via the manual API; saga-generated Linode pairs only by default
-- (Clouding-imported pairs P1/P2/P3/P12 have stale sending_domains rows from
-- the P1–P8 + Salvage-Ionos migration and would produce false alarms — pass
-- explicit pair_ids to override).

-- ============================================================
-- sending_domains: per-domain DBL tracking columns
-- ============================================================

ALTER TABLE sending_domains
  ADD COLUMN IF NOT EXISTS last_dbl_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS dbl_check_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dbl_first_burn_at timestamptz;

-- Fairness index for scheduling — NULLS FIRST so domains never checked
-- get picked up before stale ones.
CREATE INDEX IF NOT EXISTS idx_sending_domains_last_dbl_check
  ON sending_domains(last_dbl_check_at NULLS FIRST);

-- ============================================================
-- dbl_sweep_runs: audit row per sweep
-- ============================================================

CREATE TABLE IF NOT EXISTS dbl_sweep_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT NOW(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  pairs_scanned int NOT NULL DEFAULT 0,
  domains_scanned int NOT NULL DEFAULT 0,
  new_burns_found int NOT NULL DEFAULT 0,
  burns_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  trigger_source text NOT NULL
    CHECK (trigger_source IN ('cron', 'manual', 'test'))
);

CREATE INDEX IF NOT EXISTS idx_dbl_sweep_runs_org_started
  ON dbl_sweep_runs(org_id, started_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- Mirrors the pair_verifications (018) pattern — scope by org_id from
-- the Clerk JWT claim. Service role bypasses RLS for the worker writes.
-- ============================================================

ALTER TABLE dbl_sweep_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dsr_select" ON dbl_sweep_runs FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));

CREATE POLICY "dsr_insert" ON dbl_sweep_runs FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));

CREATE POLICY "dsr_update" ON dbl_sweep_runs FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));

CREATE POLICY "dsr_delete" ON dbl_sweep_runs FOR DELETE
  USING (
    org_id = (auth.jwt()->>'org_id')
    AND (auth.jwt()->>'org_role') = 'org:admin'
  );
