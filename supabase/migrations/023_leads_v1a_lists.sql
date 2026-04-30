-- Leads V1a: custom lists + async Outscraper task tracking + raw payload preservation
-- See dashboard-app/reports/2026-04-30-leads-v1a-design.md

-- 1) lead_lists: scoping entity for region/vertical separation
CREATE TABLE IF NOT EXISTS lead_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  region VARCHAR(255),
  vertical VARCHAR(255),
  sub_vertical VARCHAR(255),
  suggested_filters JSONB DEFAULT '{}',
  total_leads INT NOT NULL DEFAULT 0,
  last_scrape_status TEXT,
  last_scrape_started_at TIMESTAMPTZ,
  last_scrape_completed_at TIMESTAMPTZ,
  last_scrape_error TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lead_lists_org_active
  ON lead_lists(org_id, created_at DESC)
  WHERE archived_at IS NULL;

-- 2) outscraper_tasks: async task tracking
CREATE TABLE IF NOT EXISTS outscraper_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_list_id UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  outscraper_task_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('submitted','polling','downloading','complete','failed')),
  filters JSONB NOT NULL DEFAULT '{}',
  estimated_count INT,
  estimated_cost_cents INT,
  actual_count INT,
  results_location TEXT,
  error_message TEXT,
  last_polled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outscraper_tasks_pending
  ON outscraper_tasks(status, created_at DESC)
  WHERE status IN ('submitted','polling','downloading');

CREATE INDEX IF NOT EXISTS idx_outscraper_tasks_list
  ON outscraper_tasks(lead_list_id, created_at DESC);

-- 3) lead_contacts: scope to a list + preserve raw Outscraper payload
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS lead_list_id UUID REFERENCES lead_lists(id) ON DELETE SET NULL;
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS outscraper_task_id TEXT;
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_list
  ON lead_contacts(lead_list_id)
  WHERE lead_list_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_org_list
  ON lead_contacts(org_id, lead_list_id, created_at DESC)
  WHERE lead_list_id IS NOT NULL;

-- 4) RLS for new tables
ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON lead_lists;
CREATE POLICY "org_isolation" ON lead_lists
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

ALTER TABLE outscraper_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON outscraper_tasks;
CREATE POLICY "org_isolation" ON outscraper_tasks
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- 5) updated_at trigger for lead_lists
CREATE OR REPLACE FUNCTION update_lead_lists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lead_lists_updated_at ON lead_lists;
CREATE TRIGGER trigger_lead_lists_updated_at
  BEFORE UPDATE ON lead_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_lists_updated_at();
