/**
 * B10: Open tracking pixel endpoint
 * Called by email clients loading the 1x1 GIF — NO AUTH required.
 * tracking_id acts as the authentication token.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Hard Lesson #34: Lazy init for all clients
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

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(request: NextRequest) {
  const trackingId = request.nextUrl.searchParams.get("id");

  // Always return the pixel, even if tracking fails
  const pixelResponse = () =>
    new Response(PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });

  if (!trackingId) {
    return pixelResponse();
  }

  try {
    const supabase = getSupabase();

    // Look up send log by tracking_id
    const { data: sendLog } = await supabase
      .from("email_send_log")
      .select("id, org_id, campaign_id, recipient_id")
      .eq("tracking_id", trackingId)
      .single();

    if (!sendLog) {
      return pixelResponse();
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = request.headers.get("user-agent") || null;

    // Insert tracking event
    await supabase.from("tracking_events").insert({
      org_id: sendLog.org_id,
      campaign_id: sendLog.campaign_id,
      recipient_id: sendLog.recipient_id,
      send_log_id: sendLog.id,
      tracking_id: trackingId,
      event_type: "open",
      ip_address: ip,
      user_agent: userAgent,
    });

    // Update campaign_recipients.opened_at (first open only)
    if (sendLog.recipient_id) {
      await supabase
        .from("campaign_recipients")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", sendLog.recipient_id)
        .is("opened_at", null);
    }

    // Increment campaigns.total_opened
    if (sendLog.campaign_id) {
      const { data: campaign } = await supabase
        .from("campaigns")
        .select("total_opened")
        .eq("id", sendLog.campaign_id)
        .single();

      if (campaign) {
        await supabase
          .from("campaigns")
          .update({ total_opened: (campaign.total_opened ?? 0) + 1 })
          .eq("id", sendLog.campaign_id);
      }
    }
  } catch (err) {
    // Never fail the pixel response — tracking is best-effort
    console.error("[TrackOpen] Error:", err);
  }

  return pixelResponse();
}
