export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();
  return data?.id || null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createAdminClient();

    // Verify campaign belongs to org
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Get counts by status
    const statuses = ["pending", "sent", "failed", "opened", "clicked", "replied", "bounced"];
    const counts: Record<string, number> = {};

    const { count: total } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    counts.total_recipients = total || 0;

    for (const status of statuses) {
      if (status === "opened") {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .not("opened_at", "is", null);
        counts[status] = count || 0;
      } else if (status === "clicked") {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .not("clicked_at", "is", null);
        counts[status] = count || 0;
      } else if (status === "replied") {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .not("replied_at", "is", null);
        counts[status] = count || 0;
      } else if (status === "bounced") {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .not("bounced_at", "is", null);
        counts[status] = count || 0;
      } else {
        const { count } = await supabase
          .from("campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("status", status);
        counts[status] = count || 0;
      }
    }

    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
