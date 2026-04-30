import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { syncAllAccounts } from '../../lib/email/imap-sync';
import {
  classifyReply,
  Classification,
  ClassificationResult,
} from '../../lib/email/reply-classifier';
import { handleReply, handleBounce, handleOptOut } from '../../lib/email/sequence-engine';
import { handleImapError } from '../../lib/email/error-handler';
import { resolveLeadContactForEmail } from '../../lib/email/contact-lookup';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// V1+a rate-limit pacing — module-scope timestamp keeps consecutive LLM calls
// ≥2000ms apart so the worker stays under Anthropic's 50 req/min cap on
// claude-haiku-4-5-20251001 (target ~30 msg/min sustained).
let lastClassifierCallAt = 0;
const CLASSIFIER_PACING_MS = 2000;
const CLASSIFIER_PACING_JITTER_MS = 200;

export async function _waitForClassifierSlot(now: number = Date.now()): Promise<number> {
  const elapsed = now - lastClassifierCallAt;
  if (elapsed < CLASSIFIER_PACING_MS) {
    const wait = CLASSIFIER_PACING_MS - elapsed + Math.random() * CLASSIFIER_PACING_JITTER_MS;
    await new Promise((r) => setTimeout(r, wait));
  }
  lastClassifierCallAt = Date.now();
  return lastClassifierCallAt;
}

// Empty-text short-circuit: ~36% of inbox_messages on 2026-04-29 were empty
// Snov warm-up pings (no reply_only_text, no body_text). Calling Claude on
// those is pure waste — they're deterministically AUTO_REPLY. Confidence 0.95
// signals "deterministic skip" vs the 0.3/0.1 LLM-uncertainty fallbacks.
export function isEmptyMessage(
  replyOnlyText: string | null | undefined,
  bodyText: string | null | undefined
): boolean {
  return (
    (!replyOnlyText || replyOnlyText.trim() === '') &&
    (!bodyText || bodyText.trim() === '')
  );
}

// V1+b auto-unsubscribe on STOP. Idempotent — short-circuits if classification
// is not STOP, contact is missing, or contact is already unsubscribed.
// Surfaces a system_alerts row of kind=auto_unsubscribe so the dashboard can
// show a feed of recent auto-unsubs without a separate audit table.
export async function applyAutoUnsubscribe(
  supabase: SupabaseClient,
  orgId: string,
  fromEmail: string | null | undefined,
  classification: Classification,
  messageId: number
): Promise<{ applied: boolean; contactId: string | null }> {
  if (classification !== 'STOP') return { applied: false, contactId: null };

  const contact = await resolveLeadContactForEmail(supabase, orgId, fromEmail);
  if (!contact) return { applied: false, contactId: null };
  if (contact.unsubscribed_at) return { applied: false, contactId: contact.id };

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('lead_contacts')
    .update({ unsubscribed_at: now, updated_at: now })
    .eq('id', contact.id)
    .eq('org_id', orgId)
    .is('unsubscribed_at', null);

  if (updateErr) {
    console.error(`[AutoUnsub] Update failed for contact ${contact.id}:`, updateErr.message);
    await supabase.from('system_alerts').insert({
      org_id: orgId,
      alert_type: 'auto_unsubscribe_error',
      severity: 'warning',
      title: 'Auto-unsubscribe failed',
      details: {
        contact_id: contact.id,
        message_id: messageId,
        error: updateErr.message?.substring(0, 500),
      },
    });
    return { applied: false, contactId: contact.id };
  }

  await supabase.from('system_alerts').insert({
    org_id: orgId,
    alert_type: 'auto_unsubscribe',
    severity: 'info',
    title: `Auto-unsubscribed contact (STOP reply)`,
    details: {
      contact_id: contact.id,
      message_id: messageId,
      classification,
      from_email: (fromEmail || '').toLowerCase(),
      unsubscribed_at: now,
    },
  });
  console.log(
    `[AutoUnsub] STOP reply from ${(fromEmail || '').toLowerCase()} → contact ${contact.id} unsubscribed`
  );
  return { applied: true, contactId: contact.id };
}

async function pacedClassifyReply(
  text: string,
  subject: string | undefined,
  orgId: string,
  supabase: SupabaseClient
): Promise<ClassificationResult> {
  await _waitForClassifierSlot();

  try {
    return await classifyReply(text, subject);
  } catch (err) {
    const msg = (err as Error).message || '';
    const is429 = msg.includes('429') || msg.toLowerCase().includes('rate');
    if (is429) {
      // Sleep a hard 5s, then retry once. lastClassifierCallAt resets so the
      // next paced call has a clean cadence.
      await new Promise((r) => setTimeout(r, 5000));
      lastClassifierCallAt = Date.now();
      try {
        return await classifyReply(text, subject);
      } catch (err2) {
        await supabase.from('system_alerts').insert({
          org_id: orgId,
          alert_type: 'classifier_error',
          severity: 'warning',
          title: 'Classifier rate-limited after retry',
          details: { error: (err2 as Error).message?.substring(0, 500) },
        });
        return { classification: 'AUTO_REPLY', confidence: 0.1 };
      }
    }
    console.error('[Classifier] Error:', err);
    return { classification: 'AUTO_REPLY', confidence: 0.1 };
  }
}

/**
 * Sync all accounts across all orgs
 */
export async function handleSyncAllAccounts(): Promise<void> {
  const supabase = getSupabase();

  // Get all orgs with active email accounts
  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id');

  if (error) {
    throw new Error(`Failed to fetch organizations: ${error.message}`);
  }

  for (const org of orgs || []) {
    try {
      const result = await syncAllAccounts(org.id);
      if (result.synced > 0) {
        console.log(`[SyncInbox] Synced ${result.synced} messages for org ${org.id}`);
      }
      if (result.errors.length > 0) {
        console.warn(`[SyncInbox] ${result.errors.length} errors for org ${org.id}:`, result.errors);
      }
    } catch (err) {
      console.error(`[SyncInbox] Error syncing org ${org.id}:`, err);
    }
  }
}

/**
 * Check if a message is a bounce (before classification).
 * Bounces come from mailer-daemon/postmaster or have delivery-status content type.
 */
function isBounceMessage(fromEmail: string, bodyText: string | null): boolean {
  const lowerFrom = (fromEmail || '').toLowerCase();
  if (lowerFrom.includes('mailer-daemon') || lowerFrom.includes('postmaster')) {
    return true;
  }
  // Check for common bounce indicators in body
  const lowerBody = (bodyText || '').toLowerCase();
  if (
    lowerBody.includes('delivery status notification') ||
    lowerBody.includes('undeliverable') ||
    lowerBody.includes('delivery failure') ||
    lowerBody.includes('returned mail')
  ) {
    return true;
  }
  return false;
}

/**
 * Classify a single reply immediately after sync
 */
export async function handleClassifyReply(data: { messageId: number }): Promise<void> {
  const supabase = getSupabase();

  const { data: message, error } = await supabase
    .from('inbox_messages')
    .select('id, reply_only_text, body_text, subject, campaign_id, recipient_id, org_id, from_email')
    .eq('id', data.messageId)
    .single();

  if (error || !message) {
    console.error(`[ClassifyReply] Message ${data.messageId} not found`);
    return;
  }

  // B10: Bounce detection BEFORE classification — HL #113
  if (isBounceMessage(message.from_email, message.body_text)) {
    console.log(`[ClassifyReply] Bounce detected for message ${data.messageId}, routing to bounce handler`);
    const { handleProcessBounce } = await import('./process-bounce');
    await handleProcessBounce({
      messageId: data.messageId,
      bodyText: message.body_text || message.reply_only_text || '',
      fromEmail: message.from_email,
      orgId: message.org_id,
    });
    return;
  }

  let result: ClassificationResult;
  if (isEmptyMessage(message.reply_only_text, message.body_text)) {
    // V1+a short-circuit: deterministic AUTO_REPLY for empty Snov warm-up pings.
    result = { classification: 'AUTO_REPLY', confidence: 0.95 };
  } else {
    const textToClassify = message.reply_only_text || message.body_text || '';
    result = await pacedClassifyReply(
      textToClassify,
      message.subject || undefined,
      message.org_id,
      supabase
    );
  }

  // Update message with classification
  await supabase
    .from('inbox_messages')
    .update({
      classification: result.classification,
      classification_confidence: result.confidence,
    })
    .eq('id', data.messageId);

  // Update thread's latest classification
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('thread_id')
    .eq('id', data.messageId)
    .single();

  if (msg?.thread_id) {
    await supabase
      .from('inbox_threads')
      .update({
        latest_classification: result.classification,
        updated_at: new Date().toISOString(),
      })
      .eq('id', msg.thread_id);
  }

  // V1+b: auto-unsub on STOP — fires regardless of campaign attachment so
  // pure-IMAP STOP replies (replies to non-tracked sends, manual outreach,
  // etc.) still mark the contact as unsubscribed.
  await applyAutoUnsubscribe(
    supabase,
    message.org_id,
    message.from_email,
    result.classification as Classification,
    data.messageId
  );

  // Wire into B8 sequence engine
  if (message.campaign_id && message.recipient_id) {
    await wireClassificationToSequenceEngine(
      result.classification as Classification,
      message.recipient_id,
      message.campaign_id,
      message.org_id,
      message.reply_only_text || message.body_text || ''
    );
  }

  console.log(`[ClassifyReply] Message ${data.messageId}: ${result.classification} (${result.confidence})`);
}

/**
 * Batch classify all unclassified replies.
 *
 * V1+a: sequential paced loop, not parallel-batch-of-10.
 *  - Empty-text rows short-circuit to AUTO_REPLY/0.95 with no LLM call.
 *  - Real-text rows hit pacedClassifyReply (≥2000ms between calls + 429 retry).
 */
export async function handleClassifyBatch(): Promise<void> {
  const supabase = getSupabase();

  // Find unclassified received messages
  const { data: messages, error } = await supabase
    .from('inbox_messages')
    .select('id, thread_id, reply_only_text, body_text, subject, campaign_id, recipient_id, org_id, from_email')
    .eq('direction', 'received')
    .is('classification', null)
    .order('received_date', { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(`Failed to fetch unclassified messages: ${error.message}`);
  }

  if (!messages || messages.length === 0) {
    console.log('[ClassifyBatch] No unclassified messages found');
    return;
  }

  console.log(`[ClassifyBatch] Classifying ${messages.length} messages (paced)...`);

  let llmCalls = 0;
  let shortCircuited = 0;

  for (const message of messages) {
    let result: ClassificationResult;

    if (isEmptyMessage(message.reply_only_text, message.body_text)) {
      result = { classification: 'AUTO_REPLY', confidence: 0.95 };
      shortCircuited++;
    } else {
      const text = message.reply_only_text || message.body_text || '';
      result = await pacedClassifyReply(
        text,
        message.subject || undefined,
        message.org_id,
        supabase
      );
      llmCalls++;
    }

    await supabase
      .from('inbox_messages')
      .update({
        classification: result.classification,
        classification_confidence: result.confidence,
      })
      .eq('id', message.id);

    if (message.thread_id) {
      await supabase
        .from('inbox_threads')
        .update({
          latest_classification: result.classification,
          updated_at: new Date().toISOString(),
        })
        .eq('id', message.thread_id);
    }

    // V1+b: auto-unsub on STOP — same idempotent flow as handleClassifyReply.
    await applyAutoUnsubscribe(
      supabase,
      message.org_id,
      message.from_email,
      result.classification as Classification,
      message.id
    );

    if (message.campaign_id && message.recipient_id) {
      await wireClassificationToSequenceEngine(
        result.classification as Classification,
        message.recipient_id,
        message.campaign_id,
        message.org_id,
        message.reply_only_text || message.body_text || ''
      );
    }
  }

  console.log(
    `[ClassifyBatch] Done. Classified ${messages.length} messages ` +
      `(${shortCircuited} short-circuit, ${llmCalls} via LLM).`
  );
}

/**
 * Wire classification result into B8 sequence engine
 */
async function wireClassificationToSequenceEngine(
  classification: Classification,
  recipientId: string,
  campaignId: string,
  orgId: string,
  emailText: string
): Promise<void> {
  const supabase = getSupabase();

  try {
    switch (classification) {
      case 'INTERESTED':
      case 'HOT_LEAD':
      case 'OBJECTION':
        await handleReply(recipientId, campaignId, classification);
        break;

      case 'STOP':
        // Add to suppression list
        const { data: recipient } = await supabase
          .from('campaign_recipients')
          .select('email')
          .eq('id', recipientId)
          .single();

        if (recipient) {
          await supabase
            .from('suppression_list')
            .upsert({
              org_id: orgId,
              email: recipient.email,
              reason: 'opt_out',
              source: `campaign:${campaignId}`,
            }, { onConflict: 'org_id,email' });
        }

        await handleOptOut(recipientId, orgId);
        break;

      case 'BOUNCE':
        await handleBounce(recipientId);
        break;

      // AUTO_REPLY, NOT_INTERESTED, SPAM — no sequence action needed
      default:
        break;
    }
  } catch (err) {
    console.error(`[SequenceWire] Error wiring ${classification} for recipient ${recipientId}:`, err);
  }
}
