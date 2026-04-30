// V1a: Outscraper task status — UI polls this every 5s while a scrape runs.
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getOutscraperTaskById, getLeadList } from "@/lib/supabase/queries";

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
  { params }: { params: Promise<{ outscraperTaskId: string }> }
) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { outscraperTaskId } = await params;
  const task = await getOutscraperTaskById(orgId, outscraperTaskId);
  if (!task) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Refresh list total from list row (already kept in sync by complete handler)
  let listTotal: number | null = null;
  if (task.lead_list_id) {
    const list = await getLeadList(orgId, task.lead_list_id);
    listTotal = list?.total_leads ?? null;
  }

  return NextResponse.json(
    { task, list_total_leads: listTotal },
    { headers: { "Cache-Control": "no-store" } }
  );
}
