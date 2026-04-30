// V1a: paginated leads in a single list
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getLeadsInList } from "@/lib/supabase/queries";

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
  const { id: listId } = await params;
  const sp = request.nextUrl.searchParams;
  const page = parseInt(sp.get("page") || "1", 10);
  const perPage = parseInt(sp.get("per_page") || "50", 10);
  const email_status = sp.get("email_status") || undefined;
  const search = sp.get("search") || undefined;

  try {
    const result = await getLeadsInList(orgId, listId, {
      page,
      perPage,
      email_status,
      search,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/leads/lists/[id]/leads] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
