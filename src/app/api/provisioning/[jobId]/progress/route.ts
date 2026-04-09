import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/provisioning/[jobId]/progress — SSE endpoint for real-time progress
 *
 * Streams events:
 *   {type: 'progress', pct: 45, step: 'setup_dns_zones', message: '...'}
 *   {type: 'step_complete', step: 'set_ptr', duration_ms: 2340}
 *   {type: 'output', step: 'install_hestiacp', line: '[ 42% ] Installing PHP...'}
 *   {type: 'complete', server_pair_id: '...'}
 *   {type: 'error', step: 'verification_gate', message: '...'}
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { orgId: clerkOrgId } = await auth();
  if (!clerkOrgId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = await createAdminClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", clerkOrgId)
    .single();

  if (!org) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { jobId } = await params;

  // Verify job belongs to org
  const { data: job } = await supabase
    .from("provisioning_jobs")
    .select("id, org_id, status")
    .eq("id", jobId)
    .eq("org_id", org.id)
    .single();

  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      }

      // Send initial state
      const { data: currentJob } = await supabase
        .from("provisioning_jobs")
        .select("*")
        .eq("id", jobId)
        .single();

      const { data: currentSteps } = await supabase
        .from("provisioning_steps")
        .select("*")
        .eq("job_id", jobId)
        .order("step_order", { ascending: true });

      if (currentJob) {
        send({
          type: "init",
          job: {
            id: currentJob.id,
            status: currentJob.status,
            progress_pct: currentJob.progress_pct,
            current_step: currentJob.current_step,
          },
          steps: (currentSteps || []).map((s: Record<string, unknown>) => ({
            step_type: s.step_type,
            status: s.status,
            duration_ms: s.duration_ms,
          })),
        });
      }

      // If job is already terminal, send final event and close
      if (
        currentJob &&
        ["completed", "failed", "rolled_back", "cancelled"].includes(
          currentJob.status
        )
      ) {
        if (currentJob.status === "completed") {
          send({
            type: "complete",
            server_pair_id: currentJob.server_pair_id,
          });
        } else {
          send({
            type: "error",
            step: currentJob.current_step,
            message: currentJob.error_message || currentJob.status,
          });
        }
        controller.close();
        return;
      }

      // Poll for updates every 2 seconds
      const pollInterval = setInterval(async () => {
        if (closed) {
          clearInterval(pollInterval);
          return;
        }

        try {
          const { data: latestJob } = await supabase
            .from("provisioning_jobs")
            .select("*")
            .eq("id", jobId)
            .single();

          if (!latestJob) {
            clearInterval(pollInterval);
            controller.close();
            return;
          }

          const { data: latestSteps } = await supabase
            .from("provisioning_steps")
            .select("*")
            .eq("job_id", jobId)
            .order("step_order", { ascending: true });

          // Send progress update
          send({
            type: "progress",
            pct: latestJob.progress_pct,
            step: latestJob.current_step,
            message: `Progress: ${latestJob.progress_pct}%`,
          });

          // Send step completion events and worker dispatch status
          for (const step of latestSteps || []) {
            if (step.status === "completed" && step.duration_ms) {
              send({
                type: "step_complete",
                step: step.step_type,
                duration_ms: step.duration_ms,
              });
            }

            // Notify client that a step is running on the worker VPS
            const stepMeta = step.metadata as Record<string, unknown> | null;
            if (step.status === "in_progress" && stepMeta?.dispatched_to_worker) {
              send({
                type: "worker_step",
                step: step.step_type,
                message: `Step ${step.step_type} is running on the worker VPS...`,
              });
            }
          }

          // Check for terminal states
          if (latestJob.status === "completed") {
            send({
              type: "complete",
              server_pair_id: latestJob.server_pair_id,
            });
            clearInterval(pollInterval);
            if (!closed) controller.close();
          } else if (
            latestJob.status === "failed" ||
            latestJob.status === "rolled_back" ||
            latestJob.status === "cancelled"
          ) {
            send({
              type: "error",
              step: latestJob.current_step,
              message: latestJob.error_message || latestJob.status,
            });
            clearInterval(pollInterval);
            if (!closed) controller.close();
          }
        } catch {
          // Non-fatal polling error
        }
      }, 2000);

      // Cleanup after 45 minutes (max provisioning time)
      setTimeout(() => {
        clearInterval(pollInterval);
        if (!closed) {
          send({ type: "timeout", message: "SSE stream timed out after 45 minutes" });
          controller.close();
        }
      }, 45 * 60 * 1000);
    },

    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
