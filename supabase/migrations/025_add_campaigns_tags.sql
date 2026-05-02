-- Add tags column to campaigns for follow-up matching (CC #UI-3-rev, 2026-05-02)
-- Idempotent: ADD COLUMN IF NOT EXISTS
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_campaigns_tags ON campaigns USING GIN (tags);
COMMENT ON COLUMN campaigns.tags IS 'Tags for follow-up subsequence matching (CC #UI-4)';
