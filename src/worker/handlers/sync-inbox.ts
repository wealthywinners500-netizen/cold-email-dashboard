import { createClient } from '@supabase/supabase-js';
import { syncAllAccounts } from '../../lib/email/imap-sync';
import { classifyReply, classifyBatch, Classification } from '../../lib/email/reply-classifier';
import { handleReply, handleBounce, handleOptOut } from '../../lib/email/sequence-engine';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
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
        console.warn(`[SyncInbox] ${result.errors.length} errors for org ${org.id}`);
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

  // B10: Bounce detection BEFORE classification — Hard Lesson #11
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

  const textToClassify = message.reply_only_text || message.body_text;
  if (!textToClassify) {
    console.log(`[ClassifyReply] No text to classify for message ${data.messageId}`);
    return;
  }

  const result = await classifyReply(textToClassify, message.subject || undefined);

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
 * Batch classify all unclassified replies
 */
export async function handleClassifyBatch(): Promise<void> {
  const supabase = getSupabase();

  // Find unclassified received messages
  const { data: messages, error } = await supabase
    .from('inbox_messages')
    .select('id, reply_only_text, body_text, subject, campaign_id, recipient_id, org_id')
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

  console.log(`[ClassifyBatch] Classifying ${messages.length} messages...`);

  const replies = messages.map((m) => ({
    id: m.id,
    text: m.reply_only_text || m.body_text || '',
    subject: m.subject || undefined,
  }));

  const results = await classifyBatch(replies);

  // Update each message and wire to sequence engine
  for (const [messageId, result] of results) {
    await supabase
      .from('inbox_messages')
      .update({
        classification: result.classification,
        classification_confidence: result.confidence,
      })
      .eq('id', messageId);

    // Update thread classification
    const { data: msg } = await supabase
      .from('inbox_messages')
      .select('thread_id')
      .eq('id', messageId)
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

    // Wire to sequence engine
    const originalMessage = messages.find((m) => m.id === messageId);
    if (originalMessage?.campaign_id && originalMessage?.recipient_id) {
      await wireClassificationToSequenceEngine(
        result.classification as Classification,
        originalMessage.recipient_id,
        originalMessage.campaign_id,
        originalMessage.org_id,
        originalMessage.reply_only_text || originalMessage.body_text || ''
      );
    }
  }

  console.log(`[ClassifyBatch] Classified ${results.size} messages`);
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
