/**
 * B10: Bounce Handler
 * Parses bounce emails, classifies hard/soft, updates suppression + sequence engine.
 */
import { createClient } from "@supabase/supabase-js";
import { handleBounce } from "../../lib/email/sequence-engine";

// Hard Lesson #34: Lazy init
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _supabase;
}

// Lazy init for bounce parser
let _bounceParser: any = null;
function getBounceParser() {
  if (!_bounceParser) {
    const EmailBounceParser = require("email-bounce-parser");
    _bounceParser = new EmailBounceParser();
  }
  return _bounceParser;
}

interface BouncePayload {
  messageId: number;
  bodyText: string;
  fromEmail: string;
  orgId: string;
}

export async function handleProcessBounce(payload: BouncePayload): Promise<void> {
  const supabase = getSupabase();
  const { messageId, bodyText, fromEmail, orgId } = payload;

  // Parse bounce
  const parser = getBounceParser();
  const result = parser.read(bodyText);

  if (!result.bounce) {
    console.log(`[Bounce] Message ${messageId} is not a bounce`);
    return;
  }

  const recipientEmail = result.data?.recipient || null;
  const errorCode = result.data?.error?.code || null;
  const errorMessage = result.data?.error?.label || result.email?.error || null;

  if (!recipientEmail) {
    console.warn(`[Bounce] Could not extract recipient email from bounce message ${messageId}`);
    return;
  }

  // Look up the recipient in campaign_recipients
  const { data: recipients } = await supabase
    .from("campaign_recipients")
    .select("id, campaign_id, org_id, email")
    .eq("email", recipientEmail)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1);

  const recipient = recipients?.[0];

  // Determine if hard or soft bounce
  const codeStr = String(errorCode || "");
  const isHard = codeStr.startsWith("5") || result.data?.action === "failed";
  const bounceType = isHard ? "hard" : "soft";
  const eventType = isHard ? "bounce_hard" : "bounce_soft";

  console.log(
    `[Bounce] ${bounceType} bounce for ${recipientEmail}: ${errorCode} - ${errorMessage}`
  );

  if (isHard) {
    // Hard bounce: suppress the email
    await supabase
      .from("suppression_list")
      .upsert(
        {
          org_id: orgId,
          email: recipientEmail,
          reason: "hard_bounce",
          source: `bounce:${messageId}`,
        },
        { onConflict: "org_id,email" }
      );

    if (recipient) {
      // Update campaign_recipients
      await supabase
        .from("campaign_recipients")
        .update({
          status: "bounced",
          bounced_at: new Date().toISOString(),
          bounce_type: "hard",
        })
        .eq("id", recipient.id);

      // Call sequence engine
      await handleBounce(recipient.id);

      // Increment campaigns.total_bounced
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("total_bounced")
        .eq("id", recipient.campaign_id)
        .single();

      if (campaign) {
        await supabase
          .from("campaigns")
          .update({ total_bounced: (campaign.total_bounced ?? 0) + 1 })
          .eq("id", recipient.campaign_id);
      }
    }
  } else {
    // Soft bounce: log but don't suppress
    if (recipient) {
      await supabase
        .from("campaign_recipients")
        .update({ bounce_type: "soft" })
        .eq("id", recipient.id);
    }
  }

  // Insert tracking event
  await supabase.from("tracking_events").insert({
    org_id: orgId,
    campaign_id: recipient?.campaign_id || null,
    recipient_id: recipient?.id || null,
    tracking_id: `bounce_${messageId}`,
    event_type: eventType,
    bounce_type: bounceType,
    bounce_code: codeStr || null,
    bounce_message: errorMessage,
  });

  // Update inbox_messages classification to BOUNCE
  await supabase
    .from("inbox_messages")
    .update({ classification: "BOUNCE", classification_confidence: 1.0 })
    .eq("id", messageId);
}
