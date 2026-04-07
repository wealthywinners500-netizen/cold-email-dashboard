import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../lib/email/smtp-manager";
import { renderTemplate, renderSubjectLine } from "../../lib/email/template-renderer";
import { randomUUID } from "crypto";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface SendEmailPayload {
  recipientId: string;
  accountId: string;
  campaignId: string;
  orgId: string;
}

export async function handleSendEmail(payload: SendEmailPayload): Promise<void> {
  const supabase = getSupabase();
  const { recipientId, accountId, campaignId, orgId } = payload;

  // 1. Fetch email account
  const { data: account, error: accountErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accountErr || !account) {
    throw new Error(`Email account not found: ${accountId}`);
  }

  if (account.status !== "active") {
    throw new Error(`Email account ${account.email} is not active`);
  }

  // Check daily limit
  if (account.sends_today >= account.daily_send_limit) {
    throw new Error(`Daily send limit reached for ${account.email}`);
  }

  // 2. Fetch recipient
  const { data: recipient, error: recipientErr } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("id", recipientId)
    .single();

  if (recipientErr || !recipient) {
    throw new Error(`Recipient not found: ${recipientId}`);
  }

  if (recipient.status === "sent") {
    return; // Already sent, skip
  }

  // 3. Fetch campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (campaignErr || !campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  // Check if campaign is still sending
  if (campaign.status !== "sending") {
    return; // Campaign was paused/stopped
  }

  // 4. Render template
  const templateData = {
    first_name: recipient.first_name,
    last_name: recipient.last_name,
    company_name: recipient.company_name,
    email: recipient.email,
    custom_fields: recipient.custom_fields || {},
  };

  const subjectLines = Array.isArray(campaign.subject_lines)
    ? campaign.subject_lines
    : [];
  const subject = renderSubjectLine(subjectLines, templateData);
  const html = renderTemplate(campaign.body_html || "", templateData);
  const text = campaign.body_text ? renderTemplate(campaign.body_text, templateData) : undefined;

  // 5. Generate tracking ID
  const trackingId = randomUUID();

  // 6. Send email
  try {
    const result = await sendEmail(account, recipient.email, subject, html, text, trackingId);

    // 7a. Success: update recipient
    await supabase
      .from("campaign_recipients")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: result.messageId,
      })
      .eq("id", recipientId);

    // Insert send log
    await supabase.from("email_send_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      account_id: accountId,
      from_email: account.email,
      from_name: account.display_name,
      to_email: recipient.email,
      subject,
      body_html: html,
      body_text: text || null,
      message_id: result.messageId,
      smtp_response: result.response,
      status: "sent",
      tracking_id: trackingId,
      sent_at: new Date().toISOString(),
    });

    // Increment campaign total_sent
    await supabase.rpc("increment_campaign_sent", { campaign_uuid: campaignId });

    // Increment account sends_today
    await supabase
      .from("email_accounts")
      .update({
        sends_today: account.sends_today + 1,
        last_sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", accountId);
  } catch (sendErr) {
    // 7b. Failure: log error
    const errorMessage = sendErr instanceof Error ? sendErr.message : "Unknown send error";

    await supabase.from("email_send_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      account_id: accountId,
      from_email: account.email,
      from_name: account.display_name,
      to_email: recipient.email,
      subject,
      body_html: html,
      body_text: text || null,
      status: "failed",
      error_message: errorMessage,
      tracking_id: trackingId,
    });

    // Update account last_error
    await supabase
      .from("email_accounts")
      .update({ last_error: errorMessage })
      .eq("id", accountId);

    throw sendErr; // Re-throw for pg-boss retry
  }
}
