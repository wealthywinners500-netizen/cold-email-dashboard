-- Migration 017: Leads + Contacts Outscraper/Reoon integration

-- Extend email_status to cover role_account / catch_all
ALTER TABLE lead_contacts
  DROP CONSTRAINT IF EXISTS lead_contacts_email_status_check;
ALTER TABLE lead_contacts
  ADD CONSTRAINT lead_contacts_email_status_check
  CHECK (email_status IN (
    'pending','valid','role_account','catch_all',
    'invalid','unknown','suppressed'
  ));

-- Track Reoon raw status separately from our bucket (for debugging / re-verify)
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS reoon_raw_status TEXT,
  ADD COLUMN IF NOT EXISTS reoon_overall_score INT,
  ADD COLUMN IF NOT EXISTS reoon_is_role_account BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reoon_is_catch_all BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reoon_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS position VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reoon_company_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(5);

-- Scrape jobs table (async Outscraper tasks)
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'outscraper',
  query TEXT NOT NULL,
  location TEXT NOT NULL,
  places_per_query INT DEFAULT 140,
  max_results INT DEFAULT 0,  -- 0 = unlimited
  filters JSONB DEFAULT '{"website_only":true,"operational_only":true,"dedup":true,"enrichment":true}',
  outscraper_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','polling','completed','failed','cancelled')),
  raw_count INT DEFAULT 0,
  imported_count INT DEFAULT 0,
  duplicate_count INT DEFAULT 0,
  filtered_count INT DEFAULT 0,
  cost_cents INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by_user_id TEXT
);
CREATE INDEX idx_scrape_jobs_org_status ON scrape_jobs(org_id, status);
CREATE INDEX idx_scrape_jobs_outscraper_request ON scrape_jobs(outscraper_request_id);
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON scrape_jobs
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
ALTER PUBLICATION supabase_realtime ADD TABLE scrape_jobs;

-- Verify jobs table (async Reoon tasks > 50 emails)
CREATE TABLE IF NOT EXISTS verify_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reoon_task_id BIGINT,
  total_emails INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','polling','completed','failed')),
  progress_percentage INT DEFAULT 0,
  count_safe INT DEFAULT 0,
  count_role_account INT DEFAULT 0,
  count_catch_all INT DEFAULT 0,
  count_invalid INT DEFAULT 0,
  count_unknown INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_verify_jobs_org_status ON verify_jobs(org_id, status);
CREATE INDEX idx_verify_jobs_reoon_task ON verify_jobs(reoon_task_id);
ALTER TABLE verify_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON verify_jobs
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
ALTER PUBLICATION supabase_realtime ADD TABLE verify_jobs;

-- Integration key audit table (BYOK tracking)
CREATE TABLE IF NOT EXISTS integration_key_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN
    ('saved','rotated','removed','used_platform_fallback','test_success','test_failed')),
  actor_user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_integration_key_events_org ON integration_key_events(org_id, created_at DESC);
ALTER TABLE integration_key_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON integration_key_events
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
