-- B10: Tracking + Bounce Handling
-- Migration 006

CREATE TABLE tracking_events (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  send_log_id UUID REFERENCES email_send_log(id) ON DELETE SET NULL,
  tracking_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,     -- 'open', 'click', 'bounce_hard', 'bounce_soft', 'unsubscribe'
  clicked_url TEXT,
  bounce_type VARCHAR(20),             -- 'hard' or 'soft'
  bounce_code VARCHAR(10),
  bounce_message TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tracking_events_tracking_id ON tracking_events(tracking_id);
CREATE INDEX idx_tracking_events_org_type ON tracking_events(org_id, event_type);
CREATE INDEX idx_tracking_events_campaign ON tracking_events(campaign_id, event_type);
CREATE INDEX idx_tracking_events_recipient ON tracking_events(recipient_id, event_type);
CREATE INDEX idx_tracking_events_date ON tracking_events(created_at DESC);

-- RLS
ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON tracking_events
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE tracking_events;

-- Add tracking columns to email_send_log if they don't already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_send_log' AND column_name = 'tracking_id') THEN
    ALTER TABLE email_send_log ADD COLUMN tracking_id VARCHAR(255);
    CREATE UNIQUE INDEX idx_email_send_log_tracking_id ON email_send_log(tracking_id) WHERE tracking_id IS NOT NULL;
  END IF;
END $$;

-- Add opened_at/clicked_at to campaign_recipients if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_recipients' AND column_name = 'opened_at') THEN
    ALTER TABLE campaign_recipients ADD COLUMN opened_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_recipients' AND column_name = 'clicked_at') THEN
    ALTER TABLE campaign_recipients ADD COLUMN clicked_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_recipients' AND column_name = 'bounced_at') THEN
    ALTER TABLE campaign_recipients ADD COLUMN bounced_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_recipients' AND column_name = 'bounce_type') THEN
    ALTER TABLE campaign_recipients ADD COLUMN bounce_type VARCHAR(20);
  END IF;
END $$;

-- Add aggregate tracking columns to campaigns if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'total_opened') THEN
    ALTER TABLE campaigns ADD COLUMN total_opened INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'total_clicked') THEN
    ALTER TABLE campaigns ADD COLUMN total_clicked INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'total_bounced') THEN
    ALTER TABLE campaigns ADD COLUMN total_bounced INT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'total_unsubscribed') THEN
    ALTER TABLE campaigns ADD COLUMN total_unsubscribed INT DEFAULT 0;
  END IF;
END $$;
