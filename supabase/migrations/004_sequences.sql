-- B8: Sequences + Subsequences
-- New tables: campaign_sequences, lead_sequence_state
-- Multi-step campaigns with conditional follow-ups

-- ============================================================
-- Table: campaign_sequences
-- ============================================================
CREATE TABLE campaign_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sequence_type VARCHAR(50) NOT NULL DEFAULT 'primary',
  sort_order INT DEFAULT 0,
  trigger_event VARCHAR(50),
  trigger_condition JSONB,
  trigger_priority INT DEFAULT 0,
  persona VARCHAR(100),
  steps JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Table: lead_sequence_state
-- ============================================================
CREATE TABLE lead_sequence_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES campaign_sequences(id) ON DELETE CASCADE,
  current_step INT DEFAULT 0,
  total_steps INT NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  next_send_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  assigned_variant VARCHAR(10),
  assigned_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  last_message_id VARCHAR(255),
  history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(recipient_id, campaign_id, sequence_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_campaign_sequences_campaign ON campaign_sequences(campaign_id, sequence_type);
CREATE INDEX idx_campaign_sequences_org ON campaign_sequences(org_id);
CREATE INDEX idx_lead_sequence_state_next_send ON lead_sequence_state(next_send_at, status) WHERE status = 'active';
CREATE INDEX idx_lead_sequence_state_recipient ON lead_sequence_state(recipient_id, campaign_id);
CREATE INDEX idx_lead_sequence_state_org ON lead_sequence_state(org_id);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE campaign_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sequence_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_sequences_select" ON campaign_sequences FOR SELECT USING (true);
CREATE POLICY "campaign_sequences_insert" ON campaign_sequences FOR INSERT WITH CHECK (true);
CREATE POLICY "campaign_sequences_update" ON campaign_sequences FOR UPDATE USING (true);
CREATE POLICY "campaign_sequences_delete" ON campaign_sequences FOR DELETE USING (true);

CREATE POLICY "lead_sequence_state_select" ON lead_sequence_state FOR SELECT USING (true);
CREATE POLICY "lead_sequence_state_insert" ON lead_sequence_state FOR INSERT WITH CHECK (true);
CREATE POLICY "lead_sequence_state_update" ON lead_sequence_state FOR UPDATE USING (true);
CREATE POLICY "lead_sequence_state_delete" ON lead_sequence_state FOR DELETE USING (true);

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE lead_sequence_state;
