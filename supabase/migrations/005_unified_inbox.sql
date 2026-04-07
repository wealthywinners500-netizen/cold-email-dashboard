-- B9: Unified Inbox — IMAP sync, email threading, reply classification
-- Migration 005: inbox_messages, inbox_threads, suppression_list

-- Table: inbox_messages
CREATE TABLE inbox_messages (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id VARCHAR(512),
  in_reply_to VARCHAR(512),
  references_header TEXT,
  thread_id BIGINT,
  parent_id BIGINT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  direction VARCHAR(10) NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  to_emails TEXT[] DEFAULT '{}',
  cc_emails TEXT[] DEFAULT '{}',
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  body_preview VARCHAR(280),
  reply_only_text TEXT,
  classification VARCHAR(50),
  classification_confidence DECIMAL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  sequence_step INT,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  imap_uid INT,
  imap_modseq BIGINT,
  mailbox VARCHAR(100) DEFAULT 'INBOX',
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  has_attachments BOOLEAN DEFAULT FALSE,
  attachment_count INT DEFAULT 0,
  search_vector TSVECTOR,
  received_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: inbox_threads
CREATE TABLE inbox_threads (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject TEXT,
  snippet TEXT,
  message_count INT DEFAULT 1,
  participants TEXT[] DEFAULT '{}',
  account_emails TEXT[] DEFAULT '{}',
  has_unread BOOLEAN DEFAULT TRUE,
  is_starred BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  latest_classification VARCHAR(50),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_name VARCHAR(255),
  latest_message_date TIMESTAMPTZ NOT NULL,
  earliest_message_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: suppression_list
CREATE TABLE suppression_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  reason VARCHAR(50) NOT NULL,
  source VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Indexes for inbox_messages
CREATE UNIQUE INDEX idx_inbox_messages_message_id ON inbox_messages(message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX idx_inbox_messages_thread ON inbox_messages(thread_id, received_date ASC);
CREATE INDEX idx_inbox_messages_account ON inbox_messages(account_id, received_date DESC);
CREATE INDEX idx_inbox_messages_campaign ON inbox_messages(campaign_id, recipient_id);
CREATE INDEX idx_inbox_messages_classification ON inbox_messages(org_id, classification);
CREATE INDEX idx_inbox_messages_date ON inbox_messages(org_id, received_date DESC);
CREATE INDEX idx_inbox_messages_imap ON inbox_messages(account_id, imap_uid);
CREATE INDEX idx_inbox_messages_search ON inbox_messages USING GIN(search_vector);

-- Indexes for inbox_threads
CREATE INDEX idx_inbox_threads_org_date ON inbox_threads(org_id, latest_message_date DESC);
CREATE INDEX idx_inbox_threads_unread ON inbox_threads(org_id, has_unread)
  WHERE has_unread = TRUE;
CREATE INDEX idx_inbox_threads_classification ON inbox_threads(org_id, latest_classification);
CREATE INDEX idx_inbox_threads_campaign ON inbox_threads(campaign_id);

-- Indexes for suppression_list
CREATE INDEX idx_suppression_email ON suppression_list(org_id, email);

-- Full-text search trigger
CREATE TRIGGER inbox_messages_search_update
  BEFORE INSERT OR UPDATE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(search_vector, 'pg_catalog.english', subject, body_text);

-- RLS
ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON inbox_messages
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
CREATE POLICY "org_isolation" ON inbox_threads
  USING (org_id = (SELECT auth.jwt()->>'org_id'));
CREATE POLICY "org_isolation" ON suppression_list
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE inbox_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox_threads;
