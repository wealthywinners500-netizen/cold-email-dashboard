import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../lib/email/smtp-manager";
import { renderTemplate } from "../../lib/email/template-renderer";
import { prepareEmail } from "../../lib/email/email-preparer";
import { advanceStep } from "../../lib/email/sequence-engine";
import { randomUUID } from "crypto";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

interface ProcessSequenceStepPayload {
  stateId: string;
  recipientId: string;
  sequenceId: string;
  stepNumber: number;
  campaignId: string;
  orgId: string;
}

export async function handleProcessSequenceStep(
  payload: ProcessSequenceStepPayload
): Promise<void> {
  const supabase = getSupabase();
  const { stateId, recipientId, sequenceId, stepNumber, campaignId, orgId } = payload;

  // 1. Fetch lead_sequence_state by stateId
  const { data: state, error: stateErr } = await supabase
    .from("lead_sequence_state")
    .select("*")
    .eq("id", stateId)
    .single();

  if (stateErr || !state) {
    throw new Error(`Sequence state not found: ${stateId}`);
  }

  // Skip if not active
  if (state.status !== "active") {
    console.log(`[Sequence] Skipping state ${stateId} - status is ${state.status}`);
    return;
  }

  // 2. Fetch campaign_sequences by sequenceId
  const { data: sequence, error: sequenceErr } = await supabase
    .from("campaign_sequences")
    .select("*")
    .eq("id", sequenceId)
    .single();

  if (sequenceErr || !sequence) {
    throw new Error(`Campaign sequence not found: ${sequenceId}`);
  }

  // 3. Get step from steps array (JSONB)
  const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
  const step = steps[stepNumber];

  if (!step) {
    throw new Error(`Step ${stepNumber} not found in sequence ${sequenceId}`);
  }

  // 4. Fetch campaign_recipients by recipientId
  const { data: recipient, error: recipientErr } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("id", recipientId)
    .single();

  if (recipientErr || !recipient) {
    throw new Error(`Recipient not found: ${recipientId}`);
  }

  // 5. Fetch email_accounts by state.assigned_account_id
  const { data: account, error: accountErr } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", state.assigned_account_id)
    .single();

  if (accountErr || !account) {
    throw new Error(`Email account not found: ${state.assigned_account_id}`);
  }

  if (account.status !== "active") {
    throw new Error(`Email account ${account.email} is not active`);
  }

  // Check daily limit
  if (account.sends_today >= account.daily_send_limit) {
    throw new Error(`Daily send limit reached for ${account.email}`);
  }

  // 6. Pick variant content
  let subject = step.subject || "";
  let bodyHtml = step.body_html || "";
  let bodyText = step.body_text || "";

  if (
    step.ab_variants &&
    Array.isArray(step.ab_variants) &&
    state.assigned_variant
  ) {
    const variant = step.ab_variants.find(
      (v: any) => v.variant === state.assigned_variant
    );
    if (variant) {
      subject = variant.subject || subject;
      bodyHtml = variant.body_html || bodyHtml;
      bodyText = variant.body_text || bodyText;
    }
  }

  // 7. Render template
  const templateData = {
    first_name: recipient.first_name || "",
    last_name: recipient.last_name || "",
    company_name: recipient.company_name || "",
    email: recipient.email,
    custom_fields: recipient.custom_fields || {},
  };

  const renderedSubject = renderTemplate(subject, templateData);
  const renderedHtml = renderTemplate(bodyHtml, templateData);
  const renderedText = bodyText ? renderTemplate(bodyText, templateData) : undefined;

  // 8. Handle same-thread
  let finalSubject = renderedSubject;
  const threadingHeaders: Record<string, string> = {};

  if (step.send_in_same_thread && state.last_message_id) {
    // Prefix subject with "Re: " if not already prefixed
    if (!finalSubject.toLowerCase().startsWith("re:")) {
      finalSubject = `Re: ${finalSubject}`;
    }
    threadingHeaders["In-Reply-To"] = state.last_message_id;
    threadingHeaders["References"] = state.last_message_id;
  }

  // 9. Generate tracking ID
  const trackingId = randomUUID();

  // 9b. Prepare email with tracking (pixel, click rewrite, unsub link + headers)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cold-email-dashboard.vercel.app";
  const prepared = prepareEmail(renderedHtml, trackingId, baseUrl);
  const trackedHtml = prepared.html;
  const extraHeaders: Record<string, string> = {
    "List-Unsubscribe": prepared.listUnsubscribe,
    "List-Unsubscribe-Post": prepared.listUnsubscribePost,
  };

  // Add threading headers on top
  if (Object.keys(threadingHeaders).length > 0) {
    Object.assign(extraHeaders, threadingHeaders);
  }

  // 10. Send email
  try {
    const result = await sendEmail(
      account,
      recipient.email,
      finalSubject,
      trackedHtml,
      renderedText,
      trackingId,
      extraHeaders
    );

    // 11. Log to email_send_log table
    await supabase.from("email_send_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      account_id: account.id,
      from_email: account.email,
      from_name: account.display_name,
      to_email: recipient.email,
      subject: finalSubject,
      body_html: trackedHtml,
      body_text: renderedText || null,
      message_id: result.messageId,
      smtp_response: result.response,
      status: "sent",
      tracking_id: trackingId,
      sent_at: new Date().toISOString(),
    });

    // 12. Update last_message_id on state
    await supabase
      .from("lead_sequence_state")
      .update({ last_message_id: result.messageId })
      .eq("id", stateId);

    // 13. Call advanceStep
    await advanceStep(stateId);

    // 14. Increment sends_today on account
    await supabase
      .from("email_accounts")
      .update({
        sends_today: account.sends_today + 1,
        last_sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", account.id);

    console.log(
      `[Sequence] Step ${stepNumber} sent for state ${stateId}, recipient ${recipientId}`
    );
  } catch (sendErr) {
    const errorMessage = sendErr instanceof Error ? sendErr.message : "Unknown send error";

    // Log failure
    await supabase.from("email_send_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      account_id: account.id,
      from_email: account.email,
      from_name: account.display_name,
      to_email: recipient.email,
      subject: finalSubject,
      body_html: trackedHtml,
      body_text: renderedText || null,
      status: "failed",
      error_message: errorMessage,
      tracking_id: trackingId,
    });

    // Update account last_error
    await supabase
      .from("email_accounts")
      .update({ last_error: errorMessage })
      .eq("id", account.id);

    throw sendErr; // Re-throw for pg-boss retry
  }
}
