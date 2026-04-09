import { createClient } from '@supabase/supabase-js';

// Lazy Supabase initialization
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
  );
}

export interface PreSendCheckResult {
  canSend: boolean;
  reason?: string;
}

/**
 * Pre-send validation for a single email before sending.
 * Checks suppression list, account status, daily limits, paused state,
 * campaign status, and recipient history.
 */
export async function preSendCheck(
  recipientEmail: string,
  accountId: string,
  campaignId: string,
  orgId: string
): Promise<PreSendCheckResult> {
  const supabase = getSupabase();

  // 1. Check suppression list
  const { data: suppressionEntry, error: suppressionError } = await supabase
    .from('suppression_list')
    .select('id')
    .eq('org_id', orgId)
    .eq('email', recipientEmail.toLowerCase())
    .single();

  if (!suppressionError && suppressionEntry) {
    return { canSend: false, reason: 'suppressed' };
  }

  // 2. Check account status and daily send limit
  const { data: account, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, daily_send_limit, sends_today, paused_until')
    .eq('id', accountId)
    .eq('org_id', orgId)
    .single();

  if (accountError || !account) {
    return { canSend: false, reason: 'account_not_found' };
  }

  // 3. Check if account is paused
  if (account.paused_until) {
    const pausedUntil = new Date(account.paused_until);
    if (pausedUntil > new Date()) {
      return { canSend: false, reason: 'account_paused' };
    }
  }

  // 4. Check daily send limit
  if (
    account.sends_today >= account.daily_send_limit
  ) {
    return { canSend: false, reason: 'daily_limit_reached' };
  }

  // 5. Check campaign status
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('org_id', orgId)
    .single();

  if (campaignError || !campaign) {
    return { canSend: false, reason: 'campaign_not_found' };
  }

  if (campaign.status !== 'sending') {
    return { canSend: false, reason: 'campaign_not_sending' };
  }

  // 6. Check campaign_recipients table for recipient history
  const { data: recipient, error: recipientError } = await supabase
    .from('campaign_recipients')
    .select('id, status')
    .eq('campaign_id', campaignId)
    .eq('email', recipientEmail.toLowerCase())
    .single();

  if (!recipientError && recipient) {
    const invalidStatuses = ['sent', 'bounced', 'unsubscribed', 'completed'];
    if (invalidStatuses.includes(recipient.status)) {
      return { canSend: false, reason: `already_${recipient.status}` };
    }
  }

  // All checks passed
  return { canSend: true };
}

/**
 * Batch pre-send validation for multiple emails.
 * Fast suppression list check without hitting account/campaign limits.
 * Returns map of email -> PreSendCheckResult.
 */
export async function batchPreSendCheck(
  emails: string[],
  orgId: string
): Promise<Map<string, PreSendCheckResult>> {
  const supabase = getSupabase();
  const result = new Map<string, PreSendCheckResult>();

  // Normalize emails to lowercase for consistent comparison
  const normalizedEmails = emails.map(e => e.toLowerCase());

  // Fetch suppressed emails for this org
  const { data: suppressedEntries, error } = await supabase
    .from('suppression_list')
    .select('email')
    .eq('org_id', orgId)
    .in('email', normalizedEmails);

  if (error) {
    // On error, default to allowing all (fail open)
    normalizedEmails.forEach(email => {
      result.set(email, { canSend: true });
    });
    return result;
  }

  const suppressedSet = new Set(
    suppressedEntries?.map(e => e.email.toLowerCase()) || []
  );

  // Build result map
  normalizedEmails.forEach(email => {
    if (suppressedSet.has(email)) {
      result.set(email, { canSend: false, reason: 'suppressed' });
    } else {
      result.set(email, { canSend: true });
    }
  });

  return result;
}
