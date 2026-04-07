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

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const perPage = parseInt(url.searchParams.get("per_page") || "50");
    const status = url.searchParams.get("status");

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

    let query = supabase
      .from("campaign_recipients")
      .select("*", { count: "exact" })
      .eq("campaign_id", campaignId)
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .range((page - 1) * perPage, page * perPage - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data,
      pagination: {
        page,
        per_page: perPage,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / perPage),
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
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

    const body = await req.json();
    const { recipients } = body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ error: "recipients array is required" }, { status: 400 });
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

    // Deduplicate by email
    const seen = new Set<string>();
    const uniqueRecipients = recipients.filter((r: { email: string }) => {
      const email = r.email?.toLowerCase().trim();
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    });

    const rows = uniqueRecipients.map((r: {
      email: string;
      first_name?: string;
      last_name?: string;
      company_name?: string;
      custom_fields?: Record<string, unknown>;
    }) => ({
      org_id: orgId,
      campaign_id: campaignId,
      email: r.email.toLowerCase().trim(),
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      company_name: r.company_name || null,
      custom_fields: r.custom_fields || {},
    }));

    // Upsert to handle duplicates
    const { data, error } = await supabase
      .from("campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,email", ignoreDuplicates: true })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update campaign recipients count
    const { count } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    await supabase
      .from("campaigns")
      .update({ recipients: count || 0 })
      .eq("id", campaignId);

    return NextResponse.json({
      added: data?.length || 0,
      total: count || 0,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
