import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { userId, orgId } = await auth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: "Not authenticated with org" }, { status: 401 });
    }

    const supabase = await createAdminClient();

    // Find the org row with the wrong clerk_org_id
    const { data: wrongOrg } = await supabase
      .from("organizations")
      .select("id, clerk_org_id, name")
      .eq("name", "StealthMail")
      .single();

    if (!wrongOrg) {
      return NextResponse.json({ error: "No StealthMail org found" }, { status: 404 });
    }

    // Update clerk_org_id to match the real Clerk org ID
    const { data, error } = await supabase
      .from("organizations")
      .update({ clerk_org_id: orgId })
      .eq("id", wrongOrg.id)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Fixed!",
      oldClerkOrgId: wrongOrg.clerk_org_id,
      newClerkOrgId: orgId,
      updated: data,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
