// V1a: single list — GET (detail + latest task) + PATCH (rename / re-tag)
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getLeadList, getLatestOutscraperTaskForList } from "@/lib/supabase/queries";

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { id } = await params;

  const list = await getLeadList(orgId, id);
  if (!list) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  const latestTask = await getLatestOutscraperTaskForList(orgId, id);

  return NextResponse.json(
    { list, latest_task: latestTask },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const ALLOWED = new Set([
    "name",
    "description",
    "region",
    "vertical",
    "sub_vertical",
    "suggested_filters",
  ]);
  const update: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED.has(k)) update[k] = body[k];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No allowed fields in body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("lead_lists")
    .update(update)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: `A list with that name already exists` },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: "Failed to update list" },
      { status: error ? 500 : 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { list: data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
