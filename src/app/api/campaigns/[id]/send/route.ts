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

export async function POST(
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

    // Fetch campaign
    const { data: campaign, error: campaignErr } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (campaignErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Validation checks
    const errors: string[] = [];

    // Check recipients
    const { count: recipientCount } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    if (!recipientCount || recipientCount === 0) {
      errors.push("No pending recipients found");
    }

    // Check subject lines
    const subjectLines = campaign.subject_lines;
    if (!subjectLines || !Array.isArray(subjectLines) || subjectLines.length === 0) {
      errors.push("No subject lines configured");
    }

    // Check body
    if (!campaign.body_html) {
      errors.push("No email body configured");
    }

    // Check active email accounts
    const { count: accountCount } = await supabase
      .from("email_accounts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "active");

    if (!accountCount || accountCount === 0) {
      errors.push("No active email accounts available");
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    // Get active accounts for round-robin assignment
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "active");

    // Get pending recipients
    const { data: pendingRecipients } = await supabase
      .from("campaign_recipients")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    if (accounts && pendingRecipients) {
      // Round-robin assign accounts to recipients
      for (let i = 0; i < pendingRecipients.length; i++) {
        const accountIndex = i % accounts.length;
        await supabase
          .from("campaign_recipients")
          .update({ assigned_account_id: accounts[accountIndex].id })
          .eq("id", pendingRecipients[i].id);
      }
    }

    // Update campaign status
    await supabase
      .from("campaigns")
      .update({
        status: "sending",
        started_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return NextResponse.json({
      success: true,
      recipients_queued: recipientCount,
      accounts_assigned: accountCount,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
