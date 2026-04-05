-- Cold Email Dashboard â Initial Schema
-- Multi-tenant with Clerk Organizations + Supabase RLS
-- Clerk uses string IDs (not UUIDs) â org_id is text throughout

-- Organizations table (synced from Clerk via webhook)
CREATE TABLE organizations (
  id text PRIMARY KEY,
  clerk_org_id text UNIQUE NOT NULL,
  name text NOT NULL,
  plan_tier text NOT NULL DEFAULT 'starter',
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Server pairs (10 pairs per org = 20 servers)
CREATE TABLE server_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pair_number int NOT NULL,
  ns_domain text NOT NULL,
  s1_ip text NOT NULL,
  s1_hostname text NOT NULL,
  s2_ip text NOT NULL,
  s2_hostname text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  mxtoolbox_errors int NOT NULL DEFAULT 0,
  warmup_day int NOT NULL DEFAULT 0,
  total_accounts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, pair_number)
);

-- Sending domains attached to server pairs
CREATE TABLE sending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES server_pairs(id) ON DELETE CASCADE,
  domain text NOT NULL,
  spf_status text NOT NULL DEFAULT 'unchecked',
  dkim_status text NOT NULL DEFAULT 'unchecked',
  dmarc_status text NOT NULL DEFAULT 'unchecked',
  blacklist_status text NOT NULL DEFAULT 'clean',
  last_checked timestamptz
);

-- Campaigns (Snov.io campaigns)
CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snovio_id text,
  name text NOT NULL,
  region text NOT NULL,
  store_chain text NOT NULL,
  recipients int NOT NULL DEFAULT 0,
  open_rate decimal,
  reply_rate decimal,
  bounce_rate decimal,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lead batches
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  total_scraped int NOT NULL DEFAULT 0,
  verified_count int NOT NULL DEFAULT 0,
  cost_per_lead decimal,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Follow-up threads
CREATE TABLE follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  thread_id text NOT NULL,
  classification text NOT NULL DEFAULT 'unclassified',
  template_assigned text,
  action_needed text,
  last_reply_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Clerk JWT claims: sub (user ID), org_id, org_role
-- Supabase configured with Clerk as third-party auth provider
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sending_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

-- Organizations: users see only their own org
CREATE POLICY "org_select" ON organizations FOR SELECT
  USING (id = (auth.jwt()->>'org_id'));
CREATE POLICY "org_insert" ON organizations FOR INSERT
  WITH CHECK (id = (auth.jwt()->>'org_id'));
CREATE POLICY "org_update" ON organizations FOR UPDATE
  USING (id = (auth.jwt()->>'org_id'));
CREATE POLICY "org_delete" ON organizations FOR DELETE
  USING (id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

-- Server pairs
CREATE POLICY "sp_select" ON server_pairs FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sp_insert" ON server_pairs FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sp_update" ON server_pairs FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sp_delete" ON server_pairs FOR DELETE
  USING (org_id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

-- Sending domains (join through server_pairs for org scope)
CREATE POLICY "sd_select" ON sending_domains FOR SELECT
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );
CREATE POLICY "sd_insert" ON sending_domains FOR INSERT
  WITH CHECK (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );
CREATE POLICY "sd_update" ON sending_domains FOR UPDATE
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );
CREATE POLICY "sd_delete" ON sending_domains FOR DELETE
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
    AND (auth.jwt()->>'org_role') = 'org:admin'
  );

-- Campaigns
CREATE POLICY "camp_select" ON campaigns FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "camp_insert" ON campaigns FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "camp_update" ON campaigns FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "camp_delete" ON campaigns FOR DELETE
  USING (org_id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

-- Leads
CREATE POLICY "leads_select" ON leads FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "leads_insert" ON leads FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "leads_update" ON leads FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "leads_delete" ON leads FOR DELETE
  USING (org_id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

-- Follow-ups
CREATE POLICY "fu_select" ON follow_ups FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "fu_insert" ON follow_ups FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "fu_update" ON follow_ups FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "fu_delete" ON follow_ups FOR DELETE
  USING (org_id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

-- Indexes for performance
CREATE INDEX idx_server_pairs_org ON server_pairs(org_id);
CREATE INDEX idx_campaigns_org ON campaigns(org_id);
CREATE INDEX idx_leads_org ON leads(org_id);
CREATE INDEX idx_follow_ups_org ON follow_ups(org_id);
CREATE INDEX idx_follow_ups_campaign ON follow_ups(campaign_id);
CREATE INDEX idx_sending_domains_pair ON sending_domains(pair_id);

-- SMS workflow stages (GHL)
CREATE TABLE sms_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stage text NOT NULL,
  name text NOT NULL,
  message_type text NOT NULL DEFAULT 'SMS',
  message_count int NOT NULL DEFAULT 0,
  description text,
  tag_applied text,
  region text NOT NULL DEFAULT 'NY',
  store_chains text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending_build',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sms_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_select" ON sms_workflows FOR SELECT
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sms_insert" ON sms_workflows FOR INSERT
  WITH CHECK (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sms_update" ON sms_workflows FOR UPDATE
  USING (org_id = (auth.jwt()->>'org_id'));
CREATE POLICY "sms_delete" ON sms_workflows FOR DELETE
  USING (org_id = (auth.jwt()->>'org_id') AND (auth.jwt()->>'org_role') = 'org:admin');

CREATE INDEX idx_sms_workflows_org ON sms_workflows(org_id);

-- Enable Supabase Realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE server_pairs;
ALTER PUBLICATION supabase_realtime ADD TABLE campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE follow_ups;
ALTER PUBLICATION supabase_realtime ADD TABLE sms_workflows;
