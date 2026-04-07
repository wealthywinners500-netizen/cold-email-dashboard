/**
 * B10: Unsubscribe endpoint
 * GET: Show confirmation page
 * POST: Process unsubscribe — add to suppression, stop sequences, log event
 * Returns HTML (user-facing browser page) — NO AUTH required.
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

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const PAGE_STYLE = `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           display: flex; justify-content: center; align-items: center; min-height: 100vh;
           margin: 0; background: #0f172a; color: #e2e8f0; }
    .card { background: #1e293b; border-radius: 12px; padding: 40px; max-width: 500px;
            text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    h1 { margin: 0 0 16px; font-size: 24px; color: #f8fafc; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
    button { background: #dc2626; color: white; border: none; border-radius: 8px;
             padding: 12px 32px; font-size: 16px; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #b91c1c; }
    .success { color: #22c55e; }
  </style>
`;

export async function GET(request: NextRequest) {
  const trackingId = request.nextUrl.searchParams.get("id");

  if (!trackingId) {
    return htmlResponse(`<!DOCTYPE html><html><head><title>Unsubscribe</title>${PAGE_STYLE}</head>
      <body><div class="card"><h1>Invalid Link</h1><p>This unsubscribe link is not valid.</p></div></body></html>`, 400);
  }

  return htmlResponse(`<!DOCTYPE html><html><head><title>Unsubscribe</title>${PAGE_STYLE}</head>
    <body><div class="card">
      <h1>Unsubscribe</h1>
      <p>Are you sure you want to unsubscribe? You will no longer receive emails from us.</p>
      <form method="POST" action="/api/track/unsubscribe?id=${trackingId}">
        <button type="submit">Confirm Unsubscribe</button>
      </form>
    </div></body></html>`);
}

export async function POST(request: NextRequest) {
  const trackingId = request.nextUrl.searchParams.get("id");

  // Rate limit: 20 requests per IP per minute (stricter for unsubscribe)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`track:unsub:${ip}`, 20)) {
    return htmlResponse(`<!DOCTYPE html><html><head><title>Error</title>${PAGE_STYLE}</head>
      <body><div class="card"><h1>Too Many Requests</h1><p>Please wait a moment and try again.</p></div></body></html>`, 429);
  }

  if (!trackingId) {
    return htmlResponse(`<!DOCTYPE html><html><head><title>Error</title>${PAGE_STYLE}</head>
      <body><div class="card"><h1>Invalid Link</h1><p>This unsubscribe link is not valid.</p></div></body></html>`, 400);
  }

  try {
    const supabase = getSupabase();

    // Look up send log to get recipient info
    const { data: sendLog } = await supabase
      .from("email_send_log")
      .select("id, org_id, campaign_id, recipient_id, to_email")
      .eq("tracking_id", trackingId)
      .single();

    if (!sendLog) {
      return htmlResponse(`<!DOCTYPE html><html><head><title>Error</title>${PAGE_STYLE}</head>
        <body><div class="card"><h1>Link Expired</h1><p>This unsubscribe link could not be found.</p></div></body></html>`, 404);
    }

    // 1. Add to suppression list
    await supabase
      .from("suppression_list")
      .upsert(
        {
          org_id: sendLog.org_id,
          email: sendLog.to_email,
          reason: "opt_out",
          source: "unsubscribe_link",
        },
        { onConflict: "org_id,email" }
      );

    // 2. Stop active sequences via sequence engine
    if (sendLog.recipient_id) {
      // Import dynamically to avoid module-scope init issues
      const { handleOptOut } = await import("../../../../lib/email/sequence-engine");
      await handleOptOut(sendLog.recipient_id, sendLog.org_id);

      // Update campaign_recipients status
      await supabase
        .from("campaign_recipients")
        .update({ status: "unsubscribed" })
        .eq("id", sendLog.recipient_id);
    }

    // 3. Insert tracking event
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const userAgent = request.headers.get("user-agent") || null;

    await supabase.from("tracking_events").insert({
      org_id: sendLog.org_id,
      campaign_id: sendLog.campaign_id,
      recipient_id: sendLog.recipient_id,
      send_log_id: sendLog.id,
      tracking_id: trackingId,
      event_type: "unsubscribe",
      ip_address: ip,
      user_agent: userAgent,
    });

    // 4. Atomically increment campaigns.total_unsubscribed (no race condition)
    if (sendLog.campaign_id) {
      await supabase.rpc('increment_campaign_counter', {
        p_campaign_id: sendLog.campaign_id,
        p_counter_name: 'total_unsubscribed',
      });
    }

    return htmlResponse(`<!DOCTYPE html><html><head><title>Unsubscribed</title>${PAGE_STYLE}</head>
      <body><div class="card">
        <h1 class="success">Unsubscribed</h1>
        <p>You have been successfully unsubscribed. You will no longer receive emails from us.</p>
      </div></body></html>`);
  } catch (err) {
    console.error("[Unsubscribe] Error:", err);
    return htmlResponse(`<!DOCTYPE html><html><head><title>Error</title>${PAGE_STYLE}</head>
      <body><div class="card"><h1>Something went wrong</h1><p>Please try again later.</p></div></body></html>`, 500);
  }
}
