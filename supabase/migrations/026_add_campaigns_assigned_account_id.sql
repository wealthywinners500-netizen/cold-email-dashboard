-- Add assigned_account_id FK for per-campaign sender selection (CC #UI-3-rev, 2026-05-02)
-- Future-use: migration is additive; UI/engine consumer arrives in CC #UI-4 when
-- sequence-engine is refactored to honor a per-campaign sender override.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS assigned_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_assigned_account ON campaigns(assigned_account_id) WHERE assigned_account_id IS NOT NULL;
COMMENT ON COLUMN campaigns.assigned_account_id IS 'Optional per-campaign sender account override; null = round-robin via sequence-engine';
