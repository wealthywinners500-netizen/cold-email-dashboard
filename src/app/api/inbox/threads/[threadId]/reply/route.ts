import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/smtp-manager';

export const dynamic = 'force-dynamic';

async function getInternalOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) throw new Error('No organization selected');

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();

  if (error || !data) throw new Error('Organization not found');
  return data.id;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    const supabase = await createAdminClient();
    const { threadId } = await params;
    const body = await request.json();

    const { account_id, body_html, body_text } = body;

    if (!account_id || !body_html) {
      return NextResponse.json(
        { error: 'account_id and body_html are required' },
        { status: 400 }
      );
    }

    // Get account
    const { data: account, error: accError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('org_id', orgId)
      .single();

    if (accError || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Get thread and latest message
    const { data: thread } = await supabase
      .from('inbox_threads')
      .select('*')
      .eq('id', parseInt(threadId))
      .eq('org_id', orgId)
      .single();

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Get all messages in thread for References header
    const { data: threadMessages } = await supabase
      .from('inbox_messages')
      .select('message_id, from_email, received_date')
      .eq('thread_id', parseInt(threadId))
      .order('received_date', { ascending: true });

    const latestMessage = threadMessages?.[threadMessages.length - 1];

    // Build subject with Re: prefix
    let subject = thread.subject || '';
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    // Determine recipient (the last person who sent us a message)
    const receivedMessages = (threadMessages || []).filter(
      (m: any) => m.from_email !== account.email
    );
    const replyTo = receivedMessages.length > 0
      ? receivedMessages[receivedMessages.length - 1].from_email
      : thread.participants?.find((p: string) => p !== account.email) || '';

    if (!replyTo) {
      return NextResponse.json({ error: 'No recipient found' }, { status: 400 });
    }

    // Build References header (all message IDs in thread)
    const references = (threadMessages || [])
      .map((m: any) => m.message_id)
      .filter(Boolean)
      .join(' ');

    // Send via SMTP
    const result = await sendEmail(
      {
        email: account.email,
        display_name: account.display_name,
        smtp_host: account.smtp_host,
        smtp_port: account.smtp_port,
        smtp_secure: account.smtp_secure,
        smtp_user: account.smtp_user,
        smtp_pass: account.smtp_pass,
      },
      replyTo,
      subject,
      body_html,
      body_text || undefined
    );

    // Insert into inbox_messages (direction='sent')
    const { data: sentMessage, error: insertError } = await supabase
      .from('inbox_messages')
      .insert({
        org_id: orgId,
        account_id: account_id,
        message_id: result.messageId,
        in_reply_to: latestMessage?.message_id || null,
        references_header: references || null,
        thread_id: parseInt(threadId),
        direction: 'sent',
        from_email: account.email,
        from_name: account.display_name,
        to_emails: [replyTo],
        cc_emails: [],
        subject,
        body_html,
        body_text: body_text || null,
        body_preview: (body_text || '').substring(0, 280),
        is_read: true,
        received_date: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Also log in email_send_log
    await supabase.from('email_send_log').insert({
      org_id: orgId,
      account_id: account_id,
      from_email: account.email,
      from_name: account.display_name,
      to_email: replyTo,
      subject,
      body_html,
      body_text: body_text || null,
      message_id: result.messageId,
      smtp_response: result.response,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    // Update thread
    await supabase
      .from('inbox_threads')
      .update({
        snippet: (body_text || '').substring(0, 280),
        message_count: (thread.message_count || 0) + 1,
        latest_message_date: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(threadId));

    return NextResponse.json(sentMessage, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
