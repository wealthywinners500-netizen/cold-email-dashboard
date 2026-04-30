-- Migration 022: Unibox V1+b — soft-delete columns + unsubscribe column
--
-- Locked decisions (V7 V1+b spec, 2026-04-30):
--   * Soft-delete only — no DELETE FROM rows. UI excludes deleted from all tabs.
--     IMAP sync respects deleted_at — already-deleted messages not recreated.
--   * Manual unsubscribe (per thread, per contact) + auto-unsub on STOP class.
--   * Send-path filter: distribute-campaign-sends + process-sequence-step
--     exclude recipients where lead_contacts.unsubscribed_at IS NOT NULL.
--
-- Indexes are partial to keep the indexed set small — the common case is the
-- bulk of rows have NULL on these columns.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE inbox_threads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_active
  ON inbox_messages (thread_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_threads_active
  ON inbox_threads (org_id, latest_message_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_unsubscribed
  ON lead_contacts (org_id, email)
  WHERE unsubscribed_at IS NOT NULL;
