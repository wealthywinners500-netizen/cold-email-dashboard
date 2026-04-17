-- Migration 016: Campaigns v2 sending engine columns (Phase 1)
--
-- Adds per-campaign settings needed by the bandit / smart-sending / ramp-up /
-- tracking-toggle retrofit. All ADD COLUMN IF NOT EXISTS so safe to re-run.
-- org_settings carries the per-org default for autosender_mode (Phase 8 picks
-- it up; Phase 1 just lands the table).

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS fallback_variables JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ramp_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ramp_start_rate INT,
  ADD COLUMN IF NOT EXISTS ramp_increment INT,
  ADD COLUMN IF NOT EXISTS ramp_target_rate INT,
  ADD COLUMN IF NOT EXISTS ramp_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS html_body_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS track_opens BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS track_clicks BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS include_unsubscribe BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autosender_mode TEXT DEFAULT 'require_approval'
    CHECK (autosender_mode IN ('require_approval','send_immediately','disabled')),
  ADD COLUMN IF NOT EXISTS variant_exploration_threshold INT DEFAULT 100;

-- org_settings: per-org default for autosender_mode + future per-org Phase 8 settings.
CREATE TABLE IF NOT EXISTS org_settings (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  default_autosender_mode TEXT DEFAULT 'require_approval'
    CHECK (default_autosender_mode IN ('require_approval','send_immediately','disabled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON org_settings;
CREATE POLICY "org_isolation" ON org_settings
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- Realtime for org_settings (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE org_settings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
