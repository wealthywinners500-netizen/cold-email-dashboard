import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../lib/email/smtp-manager";
import { renderTemplate, renderSubjectLine } from "../../lib/email/template-renderer";
import { prepareEmail, type TrackingOptions } from "../../lib/email/email-preparer";
import {
  normalizeSchedule,
  isWithinWindow,
  getEffectiveCap,
} from "../../lib/email/smart-sending";
import { selectFallbackAccount } from "../../lib/email/fallback-account";
import { randomUUID } from "crypto";
import { handleSmtpError } from "../../lib/email/error-handler";

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

  if (account.status === "disabled") {
    console.log(`[SendEmail] Skipping disabled account ${account.email}`);
    return;
  }

  if (account.status !== "active") {
    throw new Error(`Email account ${account.email} is not active (status: ${account.status})`);
  }

  // --- PRE-SEND GATE: Snov-warmup tag exclusion -----------------------------
  const accountTags: string[] = Array.isArray(account.tags) ? account.tags : [];
  if (accountTags.includes("snov-warmup")) {
    console.log(
      `[SendEmail] Skipping snov-warmup-tagged account ${account.email}`
    );
    return;
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

  // --- PRE-SEND GATE: Suppression check -------------------------------------
  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", recipient.email)
    .maybeSingle();

  if (suppressed) {
    console.log(`[SendEmail] Suppressed recipient ${recipient.email} — skipping`);
    await supabase
      .from("campaign_recipients")
      .update({ status: "suppressed" })
      .eq("id", recipientId);
    return;
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

  if (campaign.status !== "sending") {
    return; // Campaign was paused/stopped
  }

  // --- PRE-SEND GATE: Sending window ----------------------------------------
  const schedule = normalizeSchedule(campaign.sending_schedule);
  if (!isWithinWindow(schedule)) {
    console.log(
      `[SendEmail] Outside window for recipient ${recipientId} — deferring (pg-boss will retry)`
    );
    throw new Error("outside_sending_window");
  }

  // --- PRE-SEND GATE: Effective daily cap -----------------------------------
  const cap = getEffectiveCap(
    { daily_send_limit: account.daily_send_limit, sends_today: account.sends_today },
    campaign
  );
  if (account.sends_today >= cap) {
    // Non-sequence sends don't auto-fallback — they're ad-hoc campaign
    // starts without a thread to preserve. We surface the candidate in the
    // log (useful for operator diagnostics) but still throw to let pg-boss
    // handle retries or the operator pick it up.
    const fallback = await selectFallbackAccount({
      orgId,
      recipientId,
      excludeAccountId: account.id,
      preferServerPairId: account.server_pair_id || undefined,
      supabase,
    });
    if (fallback) {
      console.log(
        `[SendEmail] Account ${account.email} at cap (${account.sends_today}/${cap}) — fallback candidate ${fallback.email} logged; non-sequence sends do not auto-fallback`
      );
    }
    throw new Error(`Daily send limit reached for ${account.email}`);
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

  // 6. Tracking gate (independent toggles). No opts = no mutation.
  const trackOpens = campaign.track_opens === true;
  const trackClicks = campaign.track_clicks === true;
  const includeUnsubscribe = campaign.include_unsubscribe === true;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cold-email-dashboard.vercel.app";
  let finalHtml = html;
  const extraHeaders: Record<string, string> = {};

  if (trackOpens || trackClicks || includeUnsubscribe) {
    const opts: TrackingOptions = {
      injectOpenPixel: trackOpens,
      rewriteClickLinks: trackClicks,
      addUnsubscribeLink: includeUnsubscribe,
      addUnsubscribeHeader: includeUnsubscribe,
    };
    const prepared = prepareEmail(html, trackingId, baseUrl, opts);
    finalHtml = prepared.html;
    if (prepared.listUnsubscribe) extraHeaders["List-Unsubscribe"] = prepared.listUnsubscribe;
    if (prepared.listUnsubscribePost)
      extraHeaders["List-Unsubscribe-Post"] = prepared.listUnsubscribePost;
  }

  // 7. Send email
  try {
    const result = await sendEmail(
      account,
      recipient.email,
      subject,
      finalHtml,
      text,
      trackingId,
      Object.keys(extraHeaders).length > 0 ? extraHeaders : undefined
    );

    // 8a. Success: update recipient
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
      body_html: finalHtml,
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

    // Log SMTP success
    await handleSmtpError(null, accountId, orgId);
  } catch (sendErr) {
    // 8b. Failure: log error
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
      body_html: finalHtml,
      body_text: text || null,
      status: "failed",
      error_message: errorMessage,
      tracking_id: trackingId,
    });

    await supabase
      .from("email_accounts")
      .update({ last_error: errorMessage })
      .eq("id", accountId);

    await handleSmtpError(sendErr instanceof Error ? sendErr : new Error(String(sendErr)), accountId, orgId);

    throw sendErr;
  }
}
