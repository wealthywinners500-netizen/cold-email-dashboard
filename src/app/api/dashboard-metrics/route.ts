/**
 * B14: Dashboard Metrics API — admin-only endpoint.
 * Returns aggregate metrics across all campaigns for the organization.
 */
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { orgId, orgRole } = await auth();

  if (orgRole !== "org:admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!orgId) {
    return NextResponse.json(
      { error: "No organization selected" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const supabase = await createAdminClient();

    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("clerk_org_id", orgId)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Aggregate campaign metrics
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select(
        "total_sent, total_opened, total_clicked, total_replied, total_bounced, total_unsubscribed, status"
      )
      .eq("org_id", org.id);

    let totalSent = 0;
    let totalOpened = 0;
    let totalClicked = 0;
    let totalReplied = 0;
    let totalBounced = 0;
    let totalUnsubscribed = 0;
    let activeCampaigns = 0;

    for (const c of campaigns || []) {
      totalSent += c.total_sent ?? 0;
      totalOpened += c.total_opened ?? 0;
      totalClicked += c.total_clicked ?? 0;
      totalReplied += c.total_replied ?? 0;
      totalBounced += c.total_bounced ?? 0;
      totalUnsubscribed += c.total_unsubscribed ?? 0;
      if (c.status === "active") activeCampaigns++;
    }

    const denominator = totalSent > 0 ? totalSent : 1;

    return NextResponse.json(
      {
        total_campaigns: campaigns?.length ?? 0,
        active_campaigns: activeCampaigns,
        total_sent: totalSent,
        total_opened: totalOpened,
        total_clicked: totalClicked,
        total_replied: totalReplied,
        total_bounced: totalBounced,
        total_unsubscribed: totalUnsubscribed,
        open_rate: (totalOpened / denominator) * 100,
        click_rate: (totalClicked / denominator) * 100,
        reply_rate: (totalReplied / denominator) * 100,
        bounce_rate: (totalBounced / denominator) * 100,
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[DashboardMetrics] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
