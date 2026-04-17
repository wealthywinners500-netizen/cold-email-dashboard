-- Migration 015: Campaigns v2 additions (Phase 0 of CAMPAIGNS_UNIBOX_2026-04-17)
--
-- Adds only what the Campaigns + Follow-Ups + Unibox + Autosender phases need
-- on top of existing 005_unified_inbox.sql and 006_tracking.sql. Does NOT alter
-- or rename existing columns on inbox_messages / inbox_threads / suppression_list
-- / tracking_events — Phase 7+ prompts will be updated to match existing names.
--
-- New surface:
--   email_accounts.tags          — Snov.io warmup tag-based exclusion (Q7)
--   thread_tags                   — manual Interested / Hot Lead tagging (Q8)
--   autosender_training           — trainable autosender few-shot data (Q5)
--
-- All org_id columns are TEXT to match organizations.id (Clerk org IDs are not UUIDs).
-- Fully idempotent: safe to re-run.

-- 1) email_accounts.tags for warmup tag-based exclusion
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_email_accounts_tags
  ON email_accounts USING GIN(tags);

-- 2) thread_tags: manual user tags (Interested, Hot Lead, custom)
CREATE TABLE IF NOT EXISTS thread_tags (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id BIGINT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  applied_by_user_id TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (thread_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_thread_tags_org_tag
  ON thread_tags(org_id, tag);
CREATE INDEX IF NOT EXISTS idx_thread_tags_thread
  ON thread_tags(thread_id);

ALTER TABLE thread_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON thread_tags;
CREATE POLICY "org_isolation" ON thread_tags
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- 3) autosender_training: rolling training examples for the trainable autosender.
-- Populated in Phase 8 whenever Dean replies to a classified inbound.
-- inbound_message_id FKs to inbox_messages(id) so training can JOIN through to
-- campaign/recipient/account context without denormalizing.
CREATE TABLE IF NOT EXISTS autosender_training (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  classification TEXT NOT NULL,
  inbound_body TEXT NOT NULL,
  dean_reply_body TEXT NOT NULL,
  inbound_message_id BIGINT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autosender_training_lookup
  ON autosender_training(org_id, classification, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autosender_training_inbound
  ON autosender_training(inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

ALTER TABLE autosender_training ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON autosender_training;
CREATE POLICY "org_isolation" ON autosender_training
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- 4) Realtime publications (idempotent — swallow duplicate_object on re-run)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE thread_tags;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE autosender_training;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
