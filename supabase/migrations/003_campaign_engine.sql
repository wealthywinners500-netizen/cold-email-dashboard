-- B7: Campaign Sending Engine
-- New tables: email_accounts, campaign_recipients, email_send_log
-- Alter: campaigns (add sending columns)

-- ============================================================
-- Table: email_accounts
-- ============================================================
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INT DEFAULT 587,
  smtp_secure BOOLEAN DEFAULT FALSE,
  smtp_user VARCHAR(255) NOT NULL,
  smtp_pass TEXT NOT NULL,
  imap_host VARCHAR(255),
  imap_port INT DEFAULT 993,
  imap_secure BOOLEAN DEFAULT TRUE,
  server_pair_id UUID REFERENCES server_pairs(id) ON DELETE SET NULL,
  daily_send_limit INT DEFAULT 50,
  sends_today INT DEFAULT 0,
  warmup_day INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  last_error TEXT,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- ============================================================
-- Table: campaign_recipients
-- ============================================================
CREATE TABLE campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  company_name VARCHAR(255),
  custom_fields JSONB DEFAULT '{}',
  assigned_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  bounce_type VARCHAR(20),
  message_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, email)
);

-- ============================================================
-- Table: email_send_log
-- ============================================================
CREATE TABLE email_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  to_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  message_id VARCHAR(255),
  smtp_response TEXT,
  status VARCHAR(50) DEFAULT 'queued',
  error_message TEXT,
  retry_count INT DEFAULT 0,
  tracking_id VARCHAR(255) UNIQUE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ALTER campaigns table
-- ============================================================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subject_lines JSONB DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sending_schedule JSONB DEFAULT '{"send_between_hours":[9,17],"timezone":"America/New_York","days":["mon","tue","wed","thu","fri"],"max_per_day":500,"per_account_per_hour":13}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_sent INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_opened INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_clicked INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_replied INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_bounced INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_email_accounts_org_id ON email_accounts(org_id);
CREATE INDEX idx_email_accounts_status ON email_accounts(status);
CREATE INDEX idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_status ON campaign_recipients(status);
CREATE INDEX idx_campaign_recipients_org_id ON campaign_recipients(org_id);
CREATE INDEX idx_email_send_log_campaign_id ON email_send_log(campaign_id);
CREATE INDEX idx_email_send_log_account_id ON email_send_log(account_id);
CREATE INDEX idx_email_send_log_status ON email_send_log(status);
CREATE INDEX idx_email_send_log_org_id ON email_send_log(org_id);
CREATE INDEX idx_email_send_log_tracking_id ON email_send_log(tracking_id);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;

-- email_accounts policies
CREATE POLICY "email_accounts_select" ON email_accounts FOR SELECT USING (true);
CREATE POLICY "email_accounts_insert" ON email_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "email_accounts_update" ON email_accounts FOR UPDATE USING (true);
CREATE POLICY "email_accounts_delete" ON email_accounts FOR DELETE USING (true);

-- campaign_recipients policies
CREATE POLICY "campaign_recipients_select" ON campaign_recipients FOR SELECT USING (true);
CREATE POLICY "campaign_recipients_insert" ON campaign_recipients FOR INSERT WITH CHECK (true);
CREATE POLICY "campaign_recipients_update" ON campaign_recipients FOR UPDATE USING (true);
CREATE POLICY "campaign_recipients_delete" ON campaign_recipients FOR DELETE USING (true);

-- email_send_log policies
CREATE POLICY "email_send_log_select" ON email_send_log FOR SELECT USING (true);
CREATE POLICY "email_send_log_insert" ON email_send_log FOR INSERT WITH CHECK (true);
CREATE POLICY "email_send_log_update" ON email_send_log FOR UPDATE USING (true);
CREATE POLICY "email_send_log_delete" ON email_send_log FOR DELETE USING (true);

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE campaign_recipients;
ALTER PUBLICATION supabase_realtime ADD TABLE email_send_log;
ALTER PUBLICATION supabase_realtime ADD TABLE email_accounts;
