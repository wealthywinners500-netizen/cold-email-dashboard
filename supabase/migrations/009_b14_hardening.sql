-- B14: Atomic campaign counter increment function
-- Prevents race conditions on concurrent open/click/bounce/unsubscribe events
CREATE OR REPLACE FUNCTION increment_campaign_counter(
  p_campaign_id UUID,
  p_counter_name TEXT
) RETURNS void AS $$
BEGIN
  -- Validate counter name to prevent SQL injection
  IF p_counter_name NOT IN (
    'total_opened', 'total_clicked', 'total_bounced',
    'total_unsubscribed', 'total_replied', 'total_sent'
  ) THEN
    RAISE EXCEPTION 'Invalid counter name: %', p_counter_name;
  END IF;

  EXECUTE format(
    'UPDATE campaigns SET %I = COALESCE(%I, 0) + 1 WHERE id = $1',
    p_counter_name, p_counter_name
  ) USING p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- B14: Add sync_state JSONB column to email_accounts for IMAP sync persistence
ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS sync_state JSONB DEFAULT '{}'::jsonb;
