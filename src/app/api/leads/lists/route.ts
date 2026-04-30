// V1a: list-management — GET (list) + POST (create)
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getLeadLists } from "@/lib/supabase/queries";

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

export async function GET() {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const lists = await getLeadLists(orgId);
    return NextResponse.json(
      { lists },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/leads/lists] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch lead lists" },
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

  let body: {
    name?: string;
    description?: string;
    region?: string;
    vertical?: string;
    sub_vertical?: string;
    suggested_filters?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const name = (body.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (name.length > 255) {
    return NextResponse.json(
      { error: "name must be 255 chars or fewer" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("lead_lists")
    .insert({
      org_id: orgId,
      name,
      description: body.description?.trim() || null,
      region: body.region?.trim() || null,
      vertical: body.vertical?.trim() || null,
      sub_vertical: body.sub_vertical?.trim() || null,
      suggested_filters: body.suggested_filters || {},
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `A list named "${name}" already exists` },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    console.error("[/api/leads/lists] POST failed:", error);
    return NextResponse.json(
      { error: "Failed to create lead list" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { list: data },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
