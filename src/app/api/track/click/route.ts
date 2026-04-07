/**
 * B10: Click tracking redirect endpoint
 * Called when recipient clicks a link — NO AUTH required.
 * Logs the click event and 302 redirects to original URL.
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/rate-limit";

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

export async function GET(request: NextRequest) {
  const trackingId = request.nextUrl.searchParams.get("id");
  const encodedUrl = request.nextUrl.searchParams.get("url");

  if (!trackingId || !encodedUrl) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Rate limit: 100 requests per IP per minute
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`track:click:${ip}`, 100)) {
    return new Response("Too many requests", { status: 429 });
  }

  const decodedUrl = decodeURIComponent(encodedUrl);

  // Security: only allow http/https redirects
  const lowerUrl = decodedUrl.toLowerCase().trim();
  if (!lowerUrl.startsWith("http://") && !lowerUrl.startsWith("https://")) {
    return new Response("Invalid URL scheme", { status: 400 });
  }

  try {
    const supabase = getSupabase();

    // Look up send log
    const { data: sendLog } = await supabase
      .from("email_send_log")
      .select("id, org_id, campaign_id, recipient_id")
      .eq("tracking_id", trackingId)
      .single();

    if (sendLog) {
      const userAgent = request.headers.get("user-agent") || null;

      // Insert tracking event
      await supabase.from("tracking_events").insert({
        org_id: sendLog.org_id,
        campaign_id: sendLog.campaign_id,
        recipient_id: sendLog.recipient_id,
        send_log_id: sendLog.id,
        tracking_id: trackingId,
        event_type: "click",
        clicked_url: decodedUrl,
        ip_address: ip,
        user_agent: userAgent,
      });

      // Update campaign_recipients.clicked_at (first click only)
      if (sendLog.recipient_id) {
        await supabase
          .from("campaign_recipients")
          .update({ clicked_at: new Date().toISOString() })
          .eq("id", sendLog.recipient_id)
          .is("clicked_at", null);
      }

      // Atomically increment campaigns.total_clicked (no race condition)
      if (sendLog.campaign_id) {
        await supabase.rpc('increment_campaign_counter', {
          p_campaign_id: sendLog.campaign_id,
          p_counter_name: 'total_clicked',
        });
      }
    }
  } catch (err) {
    // Don't block the redirect on tracking failure
    console.error("[TrackClick] Error:", err);
  }

  // Always redirect, even if tracking failed
  return Response.redirect(decodedUrl, 302);
}
