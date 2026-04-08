import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authResult = await auth();
    const { userId, orgId, orgRole, orgSlug } = authResult;

    const supabase = await createAdminClient();

    // List ALL orgs in the table
    const { data: allOrgs, error: allOrgsError } = await supabase
      .from("organizations")
      .select("id, clerk_org_id, name, plan_tier")
      .limit(20);

    let orgLookup = null;
    if (orgId) {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, clerk_org_id, name, plan_tier")
        .eq("clerk_org_id", orgId)
        .single();
      orgLookup = { data, error: error?.message || null };
    }

    return NextResponse.json({
      userId,
      orgId,
      orgRole,
      orgSlug,
      orgLookup,
      allOrgs: allOrgs || [],
      allOrgsError: allOrgsError?.message || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
