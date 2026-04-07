import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface ThreadingInput {
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  subject: string | null;
  from_email: string;
  to_emails: string[];
}

interface ThreadResult {
  thread_id: number | null;
  parent_id: number | null;
}

/**
 * Normalize subject line by removing Re:/Fwd:/[tags]
 */
function normalizeSubject(subject: string | null): string {
  if (!subject) return '';
  return subject
    .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
    .replace(/\[.*?\]\s*/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Assign a thread to a parsed email message
 * Priority: In-Reply-To > References > Subject matching
 */
export async function assignThread(
  parsed: ThreadingInput,
  accountId: string,
  orgId: string
): Promise<ThreadResult> {
  const supabase = getSupabase();

  // 1. Try In-Reply-To header
  if (parsed.in_reply_to) {
    const { data: parent } = await supabase
      .from('inbox_messages')
      .select('id, thread_id')
      .eq('message_id', parsed.in_reply_to)
      .single();

    if (parent && parent.thread_id) {
      return { thread_id: parent.thread_id, parent_id: parent.id };
    }
  }

  // 2. Try References header
  if (parsed.references_header) {
    const refs = parsed.references_header.split(/\s+/).filter(Boolean);
    for (const ref of refs.reverse()) { // Check most recent first
      const { data: refMsg } = await supabase
        .from('inbox_messages')
        .select('id, thread_id')
        .eq('message_id', ref.trim())
        .single();

      if (refMsg && refMsg.thread_id) {
        return { thread_id: refMsg.thread_id, parent_id: refMsg.id };
      }
    }
  }

  // 3. Subject-based matching (within 7 days, overlapping participants)
  const normalizedSubject = normalizeSubject(parsed.subject);
  if (normalizedSubject.length > 3) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const allParticipants = [parsed.from_email, ...parsed.to_emails];

    const { data: candidates } = await supabase
      .from('inbox_messages')
      .select('id, thread_id, subject, from_email, to_emails')
      .eq('org_id', orgId)
      .eq('account_id', accountId)
      .gte('received_date', sevenDaysAgo)
      .not('thread_id', 'is', null)
      .order('received_date', { ascending: false })
      .limit(100);

    if (candidates) {
      for (const candidate of candidates) {
        const candidateNormSubject = normalizeSubject(candidate.subject);
        if (candidateNormSubject !== normalizedSubject) continue;

        // Check participant overlap
        const candidateParticipants = [
          candidate.from_email,
          ...(candidate.to_emails || []),
        ];
        const hasOverlap = allParticipants.some((p) =>
          candidateParticipants.includes(p)
        );

        if (hasOverlap && candidate.thread_id) {
          return { thread_id: candidate.thread_id, parent_id: candidate.id };
        }
      }
    }
  }

  // No thread found
  return { thread_id: null, parent_id: null };
}

interface ThreadUpsertData {
  subject: string | null;
  snippet: string | null;
  from_email: string;
  to_emails: string[];
  account_email: string;
  received_date: string;
  is_read: boolean;
  campaign_id: string | null;
}

/**
 * Create or update an inbox_threads row
 * Returns the thread ID
 */
export async function upsertThread(
  data: ThreadUpsertData,
  threadId: number | null,
  orgId: string
): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const allParticipants = Array.from(
    new Set([data.from_email, ...data.to_emails])
  );

  if (threadId) {
    // Update existing thread
    const { data: existing } = await supabase
      .from('inbox_threads')
      .select('message_count, participants, account_emails')
      .eq('id', threadId)
      .single();

    const existingParticipants = existing?.participants || [];
    const existingAccounts = existing?.account_emails || [];

    const mergedParticipants = Array.from(
      new Set([...existingParticipants, ...allParticipants])
    );
    const mergedAccounts = Array.from(
      new Set([...existingAccounts, data.account_email])
    );

    // Get campaign name if campaign_id provided
    let campaignName: string | null = null;
    if (data.campaign_id) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('name')
        .eq('id', data.campaign_id)
        .single();
      campaignName = campaign?.name || null;
    }

    await supabase
      .from('inbox_threads')
      .update({
        snippet: data.snippet,
        message_count: (existing?.message_count || 0) + 1,
        participants: mergedParticipants,
        account_emails: mergedAccounts,
        has_unread: !data.is_read,
        latest_message_date: data.received_date,
        ...(data.campaign_id ? { campaign_id: data.campaign_id, campaign_name: campaignName } : {}),
        updated_at: now,
      })
      .eq('id', threadId);

    return threadId;
  } else {
    // Create new thread
    let campaignName: string | null = null;
    if (data.campaign_id) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('name')
        .eq('id', data.campaign_id)
        .single();
      campaignName = campaign?.name || null;
    }

    const { data: newThread, error: insertError } = await supabase
      .from('inbox_threads')
      .insert({
        org_id: orgId,
        subject: data.subject,
        snippet: data.snippet,
        message_count: 1,
        participants: allParticipants,
        account_emails: [data.account_email],
        has_unread: !data.is_read,
        is_starred: false,
        is_archived: false,
        campaign_id: data.campaign_id,
        campaign_name: campaignName,
        latest_message_date: data.received_date,
        earliest_message_date: data.received_date,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (insertError || !newThread) {
      throw new Error(`Failed to create thread: ${insertError?.message}`);
    }

    return newThread.id;
  }
}
