-- B12: System Health — Worker heartbeat + system alerts
-- Migration 008

CREATE TABLE system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL,        -- smtp_auth_failure, imap_error, high_bounce_rate, worker_down, queue_backup
  severity VARCHAR(20) NOT NULL,           -- info, warning, critical
  title VARCHAR(255) NOT NULL,
  details JSONB DEFAULT '{}',
  account_id UUID REFERENCES email_accounts(id),
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_system_alerts_org ON system_alerts(org_id, created_at DESC);
CREATE INDEX idx_system_alerts_unack ON system_alerts(org_id, acknowledged) WHERE acknowledged = false;

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON system_alerts
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

ALTER PUBLICATION supabase_realtime ADD TABLE system_alerts;

-- Add worker heartbeat columns to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS worker_last_heartbeat TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS worker_jobs_today INT DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS worker_errors_today INT DEFAULT 0;

-- Add consecutive_failures to email_accounts for auto-disable logic
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS consecutive_failures INT DEFAULT 0;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
