import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getSystemAlerts, acknowledgeAlert } from "@/lib/supabase/queries";
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

export async function GET(req: Request) {
  try {
    const { orgRole } = await auth();
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const severity = url.searchParams.get("severity") || undefined;
    const acknowledged = url.searchParams.get("acknowledged");
    const page = parseInt(url.searchParams.get("page") || "1", 10);

    const result = await getSystemAlerts(orgId, {
      severity,
      acknowledged: acknowledged !== null ? acknowledged === "true" : undefined,
      page,
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { orgRole } = await auth();
    if (orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    if (!body.alert_id) {
      return NextResponse.json({ error: "alert_id required" }, { status: 400 });
    }

    await acknowledgeAlert(orgId, body.alert_id);
    return NextResponse.json({ success: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
