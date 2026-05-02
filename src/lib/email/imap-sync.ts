import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ImapFlow } from 'imapflow';
import { parseEmail } from './email-parser';
import { assignThread, upsertThread } from './email-threader';
import { handleImapError } from './error-handler';

// Lazy init — never at module scope (Hard Lesson #34)
function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface SyncState {
  uidvalidity?: number;
  last_uid?: number;
}

interface ServerPairForServername {
  s1_ip: string | null;
  s1_hostname: string | null;
  s2_ip: string | null;
  s2_hostname: string | null;
}

interface EmailAccountRow {
  id: string;
  org_id: string;
  email: string;
  imap_host: string | null;
  imap_port: number;
  imap_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  status: string;
  sync_state?: SyncState;
  server_pairs?: ServerPairForServername | null;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Resolve the TLS SNI servername for an IMAP connection.
 *
 * email_accounts.imap_host is stored IP-form for every Linode-saga pair
 * (only the legacy P2 Clouding rows are hostname-form). The Let's Encrypt
 * cert at the IMAP endpoint has only DNS: SANs (no IP: SAN), so connecting
 * by IP without an explicit servername fails Node's checkServerIdentity.
 *
 * Derive the matching hostname from server_pairs.s{1,2}_hostname; if the
 * imap_host is already a hostname (P2 case), pass it through.
 */
export function resolveImapServername(
  imapHost: string | null,
  pair: ServerPairForServername | null | undefined
): string | undefined {
  if (!imapHost) return undefined;
  if (!IPV4.test(imapHost)) return imapHost;
  if (!pair) return undefined;
  if (pair.s1_ip === imapHost && pair.s1_hostname) return pair.s1_hostname;
  if (pair.s2_ip === imapHost && pair.s2_hostname) return pair.s2_hostname;
  return undefined;
}

/**
 * Sync a single email account's INBOX via IMAP
 */
export async function syncAccount(accountId: string): Promise<number> {
  const supabase = getSupabase();

  // Fetch account + the server_pair hostnames used for TLS SNI.
  const { data: account, error: accError } = await supabase
    .from('email_accounts')
    .select('*, server_pairs(s1_ip, s1_hostname, s2_ip, s2_hostname)')
    .eq('id', accountId)
    .single();

  if (accError || !account) {
    throw new Error(`Account ${accountId} not found: ${accError?.message}`);
  }

  const acc = account as EmailAccountRow;

  if (!acc.imap_host) {
    console.log(`[IMAP] Account ${acc.email} has no IMAP host configured, skipping`);
    return 0;
  }

  const syncState: SyncState = (acc as any).sync_state || {};

  const servername = resolveImapServername(acc.imap_host, acc.server_pairs);

  // Connect via ImapFlow. tls.servername is required when imap_host is an IP
  // because the LE cert at that IP carries DNS: SANs only.
  const client = new ImapFlow({
    host: acc.imap_host,
    port: acc.imap_port || 993,
    secure: acc.imap_secure !== false,
    auth: {
      user: acc.smtp_user,
      pass: acc.smtp_pass,
    },
    tls: servername ? { servername } : undefined,
    logger: false,
  });

  await client.connect();

  let synced = 0;
  let lock;

  try {
    // CRITICAL: Always use getMailboxLock before fetch operations
    lock = await client.getMailboxLock('INBOX');

    const mailbox = client.mailbox;
    if (!mailbox) {
      throw new Error('Failed to open INBOX');
    }

    const currentUidValidity = mailbox.uidValidity;

    // Determine fetch range
    let fetchRange = '1:*';
    if (syncState.uidvalidity === Number(currentUidValidity) && syncState.last_uid) {
      // Same UIDVALIDITY — fetch only new messages
      fetchRange = `${syncState.last_uid + 1}:*`;
    }
    // If UIDVALIDITY changed, re-sync everything (fetchRange stays 1:*)

    let maxUid = syncState.last_uid || 0;

    // Fetch messages
    for await (const msg of client.fetch(fetchRange, {
      envelope: true,
      source: true,
      uid: true,
      flags: true,
      bodyStructure: true,
    })) {
      try {
        if (!msg.source) continue;

        // Parse email
        const parsed = await parseEmail(msg.source);

        // Thread the message
        const threading = await assignThread(
          {
            message_id: parsed.message_id,
            in_reply_to: parsed.in_reply_to,
            references_header: parsed.references_header,
            subject: parsed.subject,
            from_email: parsed.from_email,
            to_emails: parsed.to_emails,
          },
          accountId,
          acc.org_id
        );

        // Check if this is a reply to a campaign email
        let campaignId: string | null = null;
        let recipientId: string | null = null;

        if (parsed.in_reply_to) {
          const { data: sendLog } = await supabase
            .from('email_send_log')
            .select('campaign_id, recipient_id')
            .eq('message_id', parsed.in_reply_to)
            .single();

          if (sendLog) {
            campaignId = sendLog.campaign_id;
            recipientId = sendLog.recipient_id;
          }
        }

        // Check for duplicate message_id (V1+b: also catches soft-deleted rows
        // — Dean deleted the message, IMAP sync must NOT recreate it).
        if (parsed.message_id) {
          const { data: existing } = await supabase
            .from('inbox_messages')
            .select('id, deleted_at')
            .eq('message_id', parsed.message_id)
            .maybeSingle();

          if (existing) {
            if (existing.deleted_at !== null) {
              console.log(
                `[Sync] Skipping deleted message_id ${parsed.message_id} ` +
                  `(account ${accountId}, uid ${msg.uid})`
              );
            }
            if (msg.uid > maxUid) maxUid = msg.uid;
            continue; // Skip duplicate (live OR soft-deleted)
          }
        }

        // Insert into inbox_messages
        const isRead = msg.flags?.has('\\Seen') || false;
        const receivedDate = msg.envelope?.date || new Date();

        const { data: inserted, error: insertError } = await supabase
          .from('inbox_messages')
          .insert({
            org_id: acc.org_id,
            account_id: accountId,
            message_id: parsed.message_id,
            in_reply_to: parsed.in_reply_to,
            references_header: parsed.references_header,
            thread_id: threading.thread_id,
            parent_id: threading.parent_id,
            direction: 'received',
            from_email: parsed.from_email,
            from_name: parsed.from_name,
            to_emails: parsed.to_emails,
            cc_emails: parsed.cc_emails,
            subject: parsed.subject,
            body_html: parsed.body_html,
            body_text: parsed.body_text,
            body_preview: parsed.body_preview,
            reply_only_text: parsed.reply_only_text,
            campaign_id: campaignId,
            recipient_id: recipientId,
            imap_uid: msg.uid,
            mailbox: 'INBOX',
            is_read: isRead,
            has_attachments: parsed.has_attachments,
            attachment_count: parsed.attachment_count,
            received_date: new Date(receivedDate).toISOString(),
          })
          .select('id, thread_id')
          .single();

        if (insertError) {
          console.error(`[IMAP] Insert error for ${parsed.message_id}:`, insertError.message);
          continue;
        }

        // If no thread_id was assigned, create a new thread
        if (!inserted.thread_id) {
          const threadId = await upsertThread(
            {
              subject: parsed.subject,
              snippet: parsed.body_preview,
              from_email: parsed.from_email,
              to_emails: parsed.to_emails,
              account_email: acc.email,
              received_date: new Date(receivedDate).toISOString(),
              is_read: isRead,
              campaign_id: campaignId,
            },
            null,
            acc.org_id
          );

          // Update message with thread_id
          await supabase
            .from('inbox_messages')
            .update({ thread_id: threadId })
            .eq('id', inserted.id);
        } else {
          // Update existing thread
          await upsertThread(
            {
              subject: parsed.subject,
              snippet: parsed.body_preview,
              from_email: parsed.from_email,
              to_emails: parsed.to_emails,
              account_email: acc.email,
              received_date: new Date(receivedDate).toISOString(),
              is_read: isRead,
              campaign_id: campaignId,
            },
            inserted.thread_id,
            acc.org_id
          );
        }

        if (msg.uid > maxUid) maxUid = msg.uid;
        synced++;
      } catch (msgErr) {
        console.error(`[IMAP] Error processing message UID ${msg.uid}:`, msgErr);
        continue;
      }
    }

    // Persist sync state for incremental IMAP syncs
    const newSyncState: SyncState = { uidvalidity: Number(currentUidValidity), last_uid: maxUid };
    await supabase
      .from('email_accounts')
      .update({
        updated_at: new Date().toISOString(),
        sync_state: newSyncState,
      })
      .eq('id', accountId);

    console.log(`[IMAP] Synced ${synced} messages for ${acc.email}`);

  } finally {
    if (lock) lock.release();
    await client.logout();
  }

  return synced;
}

/**
 * Sync all active accounts for an organization
 */
export async function syncAllAccounts(orgId: string): Promise<{ synced: number; errors: string[] }> {
  const supabase = getSupabase();

  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select('id, email, imap_host')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (error) {
    throw new Error(`Failed to fetch accounts: ${error.message}`);
  }

  let totalSynced = 0;
  const errors: string[] = [];

  for (const account of accounts || []) {
    if (!account.imap_host) continue;

    try {
      const count = await syncAccount(account.id);
      totalSynced += count;
    } catch (err) {
      const errObj = err instanceof Error ? err : new Error(String(err));
      const msg = `[IMAP] Error syncing ${account.email}: ${errObj.message}`;
      console.error(msg);
      errors.push(msg);
      // Surface to system_alerts + email_accounts.last_error_at so this
      // class of failure is visible from the dashboard instead of silent
      // (HL #155 candidate — invisible per-account TLS failures looked
      // like ops-worker-down for ~20 days, 2026-04-09 → 2026-04-29).
      // Capture imapflow's NO/BAD context fields (CC #5b1.5): pre-existing
      // alerts persisted only error.message="Command failed", losing
      // responseStatus/responseText/executedCommand/code — the actual
      // diagnostic data needed to root-cause cascading IMAP failures.
      const e = errObj as Error & {
        responseStatus?: string;
        responseText?: string;
        executedCommand?: string;
        code?: string | number;
        cause?: unknown;
      };
      try {
        await handleImapError(errObj, account.id, orgId, {
          responseStatus: e.responseStatus,
          responseText: typeof e.responseText === 'string' ? e.responseText.substring(0, 500) : undefined,
          executedCommand: typeof e.executedCommand === 'string' ? e.executedCommand.substring(0, 500) : undefined,
          code: e.code,
          cause: e.cause ? String(e.cause).substring(0, 500) : undefined,
        });
      } catch (alertErr) {
        console.error(`[IMAP] handleImapError failed for ${account.email}:`, alertErr);
      }
      // Don't let one failure stop all — continue to next account
    }
  }

  return { synced: totalSynced, errors };
}
