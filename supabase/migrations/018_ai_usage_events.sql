-- Migration 018: ai_usage_events (Phase 3 of CAMPAIGNS_UNIBOX_2026-04-17)
--
-- Records every Anthropic API call made on behalf of an org so Dean can
-- monitor token spend and debug rate-limit issues. Grammar-check calls
-- (LanguageTool) do NOT write here — no Anthropic tokens consumed.
--
-- org_id is TEXT to match organizations.id (Clerk org IDs, not UUIDs).
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT,
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_cents INT NOT NULL DEFAULT 0,
  latency_ms INT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','rate_limited')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_time
  ON ai_usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_endpoint
  ON ai_usage_events(endpoint, created_at DESC);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON ai_usage_events;
CREATE POLICY "org_isolation" ON ai_usage_events
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
