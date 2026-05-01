-- 2026-04-30: V7 punch #24 (audit §6c) — formalize verification_result persistence.
-- The column was already added in 012_hands_free_automation.sql; this migration is
-- intentionally idempotent (IF NOT EXISTS) so it's safe on prod (which has the
-- column) and on any fresh DB that skips 012's optional-clause path. The genuine
-- new work is the partial GIN index, which makes future "show me the risky rows
-- whose Reoon raw response had X" queries cheap. The verify-new-leads worker
-- handler relies on this column existing — keeping the explicit migration here
-- documents that dependency for any future reader auditing the worker path.
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS verification_result JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_verification_result_keys
  ON lead_contacts USING gin (verification_result jsonb_path_ops)
  WHERE verification_result != '{}'::jsonb;
