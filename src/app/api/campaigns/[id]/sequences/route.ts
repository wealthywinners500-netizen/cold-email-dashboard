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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
      .from("campaign_sequences")
      .select("*")
      .eq("campaign_id", id)
      .eq("org_id", orgId)
      .order("sort_order", { ascending: true });

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      name,
      sequence_type,
      trigger_event,
      trigger_condition,
      trigger_priority,
      persona,
      steps,
    } = body;

    // Validate persona is required
    if (!persona) {
      return NextResponse.json(
        { error: "persona is required" },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();

    // Validate: if sequence_type='primary', check no existing primary sequence
    if (sequence_type === "primary") {
      const { data: existingPrimary, error: checkError } = await supabase
        .from("campaign_sequences")
        .select("id")
        .eq("campaign_id", id)
        .eq("org_id", orgId)
        .eq("sequence_type", "primary")
        .single();

      if (existingPrimary) {
        return NextResponse.json(
          { error: "Primary sequence already exists for this campaign" },
          { status: 400 }
        );
      }
    }

    // Validate: if sequence_type='subsequence', require trigger_event and trigger_condition
    if (sequence_type === "subsequence") {
      if (!trigger_event || !trigger_condition) {
        return NextResponse.json(
          {
            error:
              "trigger_event and trigger_condition are required for subsequences",
          },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("campaign_sequences")
      .insert([
        {
          campaign_id: id,
          name,
          sequence_type,
          trigger_event: trigger_event || null,
          trigger_condition: trigger_condition || null,
          trigger_priority: trigger_priority || null,
          persona,
          steps: steps || [],
          org_id: orgId,
        },
      ])
      .select();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data[0], { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
