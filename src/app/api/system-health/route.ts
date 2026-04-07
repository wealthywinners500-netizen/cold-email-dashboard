/**
 * B14: System Health API — admin-only endpoint.
 * Returns basic health checks for Supabase connectivity and table counts.
 */
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const { orgId, orgRole } = await auth();

  if (orgRole !== "org:admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!orgId) {
    return NextResponse.json(
      { error: "No organization selected" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const supabase = await createAdminClient();

    // Lookup internal org ID
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("clerk_org_id", orgId)
      .single();

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Basic connectivity check + row counts
    const [serverPairs, campaigns, emailAccounts] = await Promise.all([
      supabase
        .from("server_pairs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org.id),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org.id),
      supabase
        .from("email_accounts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org.id),
    ]);

    return NextResponse.json(
      {
        status: "healthy",
        supabase: "connected",
        counts: {
          server_pairs: serverPairs.count ?? 0,
          campaigns: campaigns.count ?? 0,
          email_accounts: emailAccounts.count ?? 0,
        },
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[SystemHealth] Error:", error);
    return NextResponse.json(
      { status: "unhealthy", error: "Health check failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
