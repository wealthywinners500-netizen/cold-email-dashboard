import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../../lib/email/smtp-manager";
import { renderTemplate } from "../../lib/email/template-renderer";
import { prepareEmail, type TrackingOptions } from "../../lib/email/email-preparer";
import { advanceStep } from "../../lib/email/sequence-engine";
import { assignVariant } from "../../lib/email/variants";
import {
  normalizeSchedule,
  isWithinWindow,
  nextWindowOpen,
  getEffectiveCap,
} from "../../lib/email/smart-sending";
import { selectFallbackAccount } from "../../lib/email/fallback-account";
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

  const steps = Array.isArray(sequence.steps) ? sequence.steps : [];
  const step = steps[stepNumber];

  if (!step) {
    throw new Error(`Step ${stepNumber} not found in sequence ${sequenceId}`);
  }

  // 3. Fetch campaign_recipients by recipientId
  const { data: recipient, error: recipientErr } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("id", recipientId)
    .single();

  if (recipientErr || !recipient) {
    throw new Error(`Recipient not found: ${recipientId}`);
  }

  // --- PRE-SEND GATE 1: Suppression check -----------------------------------
  // If the recipient's email is on the org's suppression list, mark the
  // recipient row and skip without queueing a retry.
  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("id")
    .eq("org_id", orgId)
    .eq("email", recipient.email)
    .maybeSingle();

  if (suppressed) {
    console.log(
      `[Sequence] Suppressed recipient ${recipient.email} — skipping state ${stateId}`
    );
    await supabase
      .from("campaign_recipients")
      .update({ status: "suppressed" })
      .eq("id", recipientId);
    return;
  }

  // 4. Fetch email_accounts by state.assigned_account_id
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

  // --- PRE-SEND GATE 2: Snov-warmup tag exclusion ---------------------------
  // Tag-based accounts reserved for warmup must NEVER be used to send campaign
  // mail. Phase 4's account picker will already avoid them; this is a
  // belt-and-suspenders check in case an older state row slipped through.
  const accountTags: string[] = Array.isArray(account.tags) ? account.tags : [];
  if (accountTags.includes("snov-warmup")) {
    console.log(
      `[Sequence] Skipping snov-warmup-tagged account ${account.email} — rescheduling state ${stateId}`
    );
    const rescheduleAt = new Date(Date.now() + 3600000).toISOString(); // +1h
    await supabase
      .from("lead_sequence_state")
      .update({ next_send_at: rescheduleAt })
      .eq("id", stateId);
    return;
  }

  // Load campaign for schedule, ramp-up, tracking, and exploration threshold.
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (campErr || !campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  // --- PRE-SEND GATE 3: Sending window --------------------------------------
  const schedule = normalizeSchedule(campaign.sending_schedule);
  if (!isWithinWindow(schedule)) {
    const openAt = nextWindowOpen(schedule).toISOString();
    console.log(
      `[Sequence] Outside window for state ${stateId} — rescheduling to ${openAt}`
    );
    await supabase
      .from("lead_sequence_state")
      .update({ next_send_at: openAt })
      .eq("id", stateId);
    return;
  }

  // --- PRE-SEND GATE 4: Effective daily cap ---------------------------------
  const cap = getEffectiveCap(
    { daily_send_limit: account.daily_send_limit, sends_today: account.sends_today },
    campaign
  );
  if (account.sends_today >= cap) {
    // Try a fallback account (Phase 2 stub returns null).
    const fallbackId = await selectFallbackAccount({
      orgId,
      recipientId,
      excludeAccountId: account.id,
    });
    if (fallbackId && fallbackId !== account.id) {
      await supabase
        .from("lead_sequence_state")
        .update({ assigned_account_id: fallbackId })
        .eq("id", stateId);
      console.log(
        `[Sequence] Account ${account.email} at cap (${account.sends_today}/${cap}) — reassigning to fallback ${fallbackId}`
      );
      return; // next poll of queue-sequence-steps will pick it back up
    }

    // No fallback available — leave next_send_at alone and let the midnight
    // reset (`reset-daily-counts` cron) pick it back up tomorrow.
    console.log(
      `[Sequence] Account ${account.email} at cap (${account.sends_today}/${cap}) — deferring state ${stateId}`
    );
    return;
  }

  // --- VARIANT ASSIGNMENT ---------------------------------------------------
  // Re-assign on every step >0 (per-step Thompson bandit) and also if the
  // state row has no variant yet (legacy rows from before Phase 1).
  let assignedVariant: string | null = state.assigned_variant;
  if (!assignedVariant || stepNumber > 0) {
    assignedVariant = await assignVariant(campaignId, sequenceId, stepNumber, recipientId, {
      supabase,
    });
    await supabase
      .from("lead_sequence_state")
      .update({ assigned_variant: assignedVariant })
      .eq("id", stateId);
  }

  // 6. Pick variant content
  let subject = step.subject || "";
  let bodyHtml = step.body_html || "";
  let bodyText = step.body_text || "";

  if (step.ab_variants && Array.isArray(step.ab_variants) && assignedVariant) {
    const variant = step.ab_variants.find(
      (v: Record<string, unknown>) => v.variant === assignedVariant
    );
    if (variant) {
      subject = (variant.subject as string) || subject;
      bodyHtml = (variant.body_html as string) || bodyHtml;
      bodyText = (variant.body_text as string) || bodyText;
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
    if (!finalSubject.toLowerCase().startsWith("re:")) {
      finalSubject = `Re: ${finalSubject}`;
    }
    threadingHeaders["In-Reply-To"] = state.last_message_id;
    threadingHeaders["References"] = state.last_message_id;
  }

  // 9. Tracking gate. If every toggle is false, send the raw rendered HTML
  // untouched AND skip the List-Unsubscribe header pair.
  const trackOpens = campaign.track_opens === true;
  const trackClicks = campaign.track_clicks === true;
  const includeUnsubscribe = campaign.include_unsubscribe === true;

  const trackingId = randomUUID();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cold-email-dashboard.vercel.app";

  let finalHtml = renderedHtml;
  const extraHeaders: Record<string, string> = {};

  if (trackOpens || trackClicks || includeUnsubscribe) {
    const opts: TrackingOptions = {
      injectOpenPixel: trackOpens,
      rewriteClickLinks: trackClicks,
      addUnsubscribeLink: includeUnsubscribe,
      addUnsubscribeHeader: includeUnsubscribe,
    };
    const prepared = prepareEmail(renderedHtml, trackingId, baseUrl, opts);
    finalHtml = prepared.html;
    if (prepared.listUnsubscribe) extraHeaders["List-Unsubscribe"] = prepared.listUnsubscribe;
    if (prepared.listUnsubscribePost)
      extraHeaders["List-Unsubscribe-Post"] = prepared.listUnsubscribePost;
  }

  if (Object.keys(threadingHeaders).length > 0) {
    Object.assign(extraHeaders, threadingHeaders);
  }

  // 10. Send email
  try {
    const result = await sendEmail(
      account,
      recipient.email,
      finalSubject,
      finalHtml,
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
      body_html: finalHtml,
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
      `[Sequence] Step ${stepNumber} sent for state ${stateId}, recipient ${recipientId}, variant=${assignedVariant}`
    );
  } catch (sendErr) {
    const errorMessage = sendErr instanceof Error ? sendErr.message : "Unknown send error";

    await supabase.from("email_send_log").insert({
      org_id: orgId,
      campaign_id: campaignId,
      recipient_id: recipientId,
      account_id: account.id,
      from_email: account.email,
      from_name: account.display_name,
      to_email: recipient.email,
      subject: finalSubject,
      body_html: finalHtml,
      body_text: renderedText || null,
      status: "failed",
      error_message: errorMessage,
      tracking_id: trackingId,
    });

    await supabase
      .from("email_accounts")
      .update({ last_error: errorMessage })
      .eq("id", account.id);

    throw sendErr;
  }
}
