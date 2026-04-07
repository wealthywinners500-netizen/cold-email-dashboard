import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getLeadContacts } from "@/lib/supabase/queries";

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

export async function GET(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const perPage = parseInt(searchParams.get("per_page") || "50", 10);
  const city = searchParams.get("city") || undefined;
  const state = searchParams.get("state") || undefined;
  const business_type = searchParams.get("business_type") || undefined;
  const email_status = searchParams.get("email_status") || undefined;
  const tags = searchParams.get("tags")?.split(",") || undefined;
  const search = searchParams.get("search") || undefined;
  const sortBy = searchParams.get("sort_by") || "created_at";
  const sortOrder = (searchParams.get("sort_order") || "desc") as "asc" | "desc";
  const suppressed = searchParams.get("suppressed") === "true" ? true : undefined;

  try {
    const result = await getLeadContacts(orgId, {
      page,
      perPage,
      city,
      state,
      business_type,
      email_status,
      tags,
      search,
      sortBy,
      sortOrder,
      suppressed,
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching lead contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch lead contacts" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await request.json();
    const supabase = await createAdminClient();

    const { data, error } = await supabase
      .from("lead_contacts")
      .insert({
        org_id: orgId,
        ...body,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating lead contact:", error);
      return NextResponse.json(
        { error: "Failed to create lead contact" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(data, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error creating lead contact:", error);
    return NextResponse.json(
      { error: "Failed to create lead contact" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
