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
  { params }: { params: Promise<{ id: string; seqId: string }> }
) {
  const { id, seqId } = await params;
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
      .eq("id", seqId)
      .eq("org_id", orgId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Sequence not found" },
        { status: 404 }
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; seqId: string }> }
) {
  const { id, seqId } = await params;
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { name, steps, trigger_event, trigger_condition, trigger_priority, status, persona } = body;

    // Build update object, ignore sequence_type if sent
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (steps !== undefined) updateData.steps = steps;
    if (trigger_event !== undefined) updateData.trigger_event = trigger_event;
    if (trigger_condition !== undefined) updateData.trigger_condition = trigger_condition;
    if (trigger_priority !== undefined) updateData.trigger_priority = trigger_priority;
    if (status !== undefined) updateData.status = status;
    if (persona !== undefined) updateData.persona = persona;
    updateData.updated_at = new Date().toISOString();

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("campaign_sequences")
      .update(updateData)
      .eq("id", seqId)
      .eq("org_id", orgId)
      .select();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Sequence not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data[0]);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; seqId: string }> }
) {
  const { id, seqId } = await params;
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await createAdminClient();

    // Check for active leads in this sequence
    const { data: activeLeads, error: checkError } = await supabase
      .from("lead_sequence_state")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", seqId)
      .eq("status", "active");

    if (activeLeads && (activeLeads as any).count > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete sequence with active leads",
          count: (activeLeads as any).count,
        },
        { status: 400 }
      );
    }

    // Delete the sequence
    const { error } = await supabase
      .from("campaign_sequences")
      .delete()
      .eq("id", seqId)
      .eq("org_id", orgId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
