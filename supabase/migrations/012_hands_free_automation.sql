-- B16: Hands-Free Automation — warm-up tracking, performance stats, query indexes

-- Email accounts: warm-up tracking + disable reason + stats
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS warm_up_phase INTEGER DEFAULT 0;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS disable_reason TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}';
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ;

-- Campaigns: 7-day performance stats
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{}';

-- Lead contacts: verification tracking (if not already there)
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS verification_result JSONB DEFAULT '{}';

-- Index for sequence step queuing (critical for performance)
CREATE INDEX IF NOT EXISTS idx_lead_sequence_state_ready
  ON lead_sequence_state(status, next_send_at)
  WHERE status = 'active';

-- Index for account deliverability queries
CREATE INDEX IF NOT EXISTS idx_email_send_log_account_time
  ON email_send_log(account_id, sent_at DESC);

-- Index for campaign performance queries
CREATE INDEX IF NOT EXISTS idx_email_send_log_campaign_time
  ON email_send_log(campaign_id, sent_at DESC);

-- Index for tracking event queries
CREATE INDEX IF NOT EXISTS idx_tracking_events_campaign_time
  ON tracking_events(campaign_id, created_at DESC);
