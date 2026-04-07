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
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const { id, recipientId } = await params;
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("lead_sequence_state")
      .select("*")
      .eq("recipient_id", recipientId)
      .eq("campaign_id", id)
      .eq("org_id", orgId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
