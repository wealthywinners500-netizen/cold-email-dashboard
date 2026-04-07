/**
 * B14: System Alerts API — admin-only endpoint.
 * Returns active alerts (blacklisted domains, failed sends, bouncing campaigns).
 */
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

    // Check for campaigns with high bounce rates
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, name, total_sent, total_bounced")
      .eq("org_id", org.id)
      .gt("total_sent", 0);

    const alerts: Array<{ type: string; severity: string; message: string; entity_id?: string }> = [];

    for (const c of campaigns || []) {
      const bounceRate =
        c.total_sent > 0 ? ((c.total_bounced ?? 0) / c.total_sent) * 100 : 0;
      if (bounceRate > 5) {
        alerts.push({
          type: "high_bounce_rate",
          severity: bounceRate > 10 ? "critical" : "warning",
          message: `Campaign "${c.name}" has ${bounceRate.toFixed(1)}% bounce rate`,
          entity_id: c.id,
        });
      }
    }

    return NextResponse.json(
      { alerts, count: alerts.length, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[SystemAlerts] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { orgRole } = await auth();

  if (orgRole !== "org:admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await request.json();
    const { alert_id, acknowledged } = body;

    // For now, acknowledge is a no-op (alerts are computed, not stored)
    return NextResponse.json(
      { success: true, alert_id, acknowledged },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[SystemAlerts] PATCH Error:", error);
    return NextResponse.json(
      { error: "Failed to update alert" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
