import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

/**
 * GET /api/provisioning/[jobId] — Job detail with all step statuses
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const supabase = await createAdminClient();

    const { data: job, error } = await supabase
      .from("provisioning_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("org_id", orgId)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: "Provisioning job not found" },
        { status: 404 }
      );
    }

    // Load steps
    const { data: steps } = await supabase
      .from("provisioning_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order", { ascending: true });

    return NextResponse.json({
      job,
      steps: (steps || []).map((s: Record<string, unknown>) => ({
        id: s.id,
        step_type: s.step_type,
        step_order: s.step_order,
        status: s.status,
        started_at: s.started_at,
        completed_at: s.completed_at,
        duration_ms: s.duration_ms,
        output: s.output,
        error_message: s.error_message,
      })),
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/provisioning/[jobId] — Cancel and trigger rollback
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const supabase = await createAdminClient();

    // Verify job belongs to org
    const { data: job, error } = await supabase
      .from("provisioning_jobs")
      .select("id, status")
      .eq("id", jobId)
      .eq("org_id", orgId)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: "Provisioning job not found" },
        { status: 404 }
      );
    }

    // Can only cancel pending or in_progress jobs
    if (job.status !== "pending" && job.status !== "in_progress") {
      return NextResponse.json(
        {
          error: `Cannot cancel job with status "${job.status}". Only pending or in_progress jobs can be cancelled.`,
        },
        { status: 400 }
      );
    }

    // Mark as cancelled
    await supabase
      .from("provisioning_jobs")
      .update({
        status: "cancelled",
        config: {
          rollback_requested_at: new Date().toISOString(),
        },
      })
      .eq("id", jobId);

    return NextResponse.json({
      jobId,
      status: "cancelled",
      message: "Job cancelled. Rollback will be processed by the worker.",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
