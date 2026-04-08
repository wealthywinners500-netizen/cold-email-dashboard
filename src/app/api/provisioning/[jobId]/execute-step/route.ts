import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { StepType } from "@/lib/provisioning/types";

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

// Simulated step execution for DryRun mode
// Each step simulates realistic delays without needing SSH or real APIs
async function executeDryRunStep(
  stepType: StepType,
  context: { nsDomain: string; sendingDomains: string[]; mailAccountsPerDomain: number }
): Promise<{ output: string; metadata?: Record<string, unknown> }> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  switch (stepType) {
    case "create_vps": {
      await delay(2000);
      const ip1 = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const ip2 = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      return {
        output: `[DryRun] VPS pair created: ${ip1} + ${ip2}`,
        metadata: { server1IP: ip1, server2IP: ip2, server1ProviderId: `dry-${Date.now()}-s1`, server2ProviderId: `dry-${Date.now()}-s2` },
      };
    }
    case "set_ptr": {
      await delay(1000);
      return { output: `[DryRun] PTR records set for mail1/mail2.${context.nsDomain}` };
    }
    case "configure_registrar": {
      await delay(1500);
      return { output: `[DryRun] DNS NS/glue records configured for ${context.nsDomain}` };
    }
    case "install_hestiacp": {
      await delay(3000);
      return { output: `[DryRun] HestiaCP installed on both servers` };
    }
    case "setup_dns_zones": {
      await delay(1500);
      return { output: `[DryRun] DNS zones created: ${context.nsDomain} + ${context.sendingDomains.length} sending domains` };
    }
    case "setup_mail_domains": {
      await delay(2000);
      const totalAccounts = context.sendingDomains.length * context.mailAccountsPerDomain;
      return {
        output: `[DryRun] ${context.sendingDomains.length} mail domains configured with ${totalAccounts} total accounts`,
        metadata: { totalAccountsCreated: totalAccounts },
      };
    }
    case "security_hardening": {
      await delay(1500);
      return { output: `[DryRun] Security hardening + SSL certs issued on both servers` };
    }
    case "verification_gate": {
      await delay(1000);
      return { output: `[DryRun] All verification checks passed. SPF/DKIM/DMARC/PTR/blacklist clean.` };
    }
    default:
      return { output: `[DryRun] Step ${stepType} completed` };
  }
}

/**
 * POST /api/provisioning/[jobId]/execute-step
 * Executes the next pending step in a DryRun provisioning job.
 * Called by the client-side execution loop on the progress page.
 */
export async function POST(
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

    // Load job and verify ownership
    const { data: job, error: jobError } = await supabase
      .from("provisioning_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("org_id", orgId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Don't execute if job is in a terminal state
    if (["completed", "failed", "rolled_back", "cancelled"].includes(job.status)) {
      return NextResponse.json({
        jobId,
        allComplete: job.status === "completed",
        status: job.status,
        progress_pct: job.progress_pct,
      });
    }

    // Load all steps ordered by step_order
    const { data: steps, error: stepsError } = await supabase
      .from("provisioning_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order", { ascending: true });

    if (stepsError || !steps) {
      return NextResponse.json({ error: "Failed to load steps" }, { status: 500 });
    }

    // Find first pending step
    const pendingStep = steps.find((s: Record<string, unknown>) => s.status === "pending");
    if (!pendingStep) {
      // All steps done
      return NextResponse.json({
        jobId,
        allComplete: true,
        progress_pct: 100,
        status: "completed",
      });
    }

    const stepType = pendingStep.step_type as StepType;
    const startTime = Date.now();

    // Mark step and job as in_progress
    await supabase
      .from("provisioning_steps")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", pendingStep.id);

    if (job.status === "pending") {
      await supabase
        .from("provisioning_jobs")
        .update({
          status: "in_progress",
          started_at: new Date().toISOString(),
          current_step: stepType,
        })
        .eq("id", jobId);
    } else {
      await supabase
        .from("provisioning_jobs")
        .update({ current_step: stepType })
        .eq("id", jobId);
    }

    try {
      // Execute the dry-run step
      const result = await executeDryRunStep(stepType, {
        nsDomain: job.ns_domain,
        sendingDomains: job.sending_domains || [],
        mailAccountsPerDomain: job.mail_accounts_per_domain || 3,
      });

      const durationMs = Date.now() - startTime;

      // Mark step as completed
      await supabase
        .from("provisioning_steps")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          output: result.output,
          metadata: result.metadata || {},
        })
        .eq("id", pendingStep.id);

      // Calculate progress
      const completedCount = steps.filter(
        (s: Record<string, unknown>) => s.status === "completed" || s.id === pendingStep.id
      ).length;
      const progressPct = Math.round((completedCount / steps.length) * 100);

      // Update job progress
      await supabase
        .from("provisioning_jobs")
        .update({ progress_pct: progressPct })
        .eq("id", jobId);

      // Check if this was the last step
      const isLastStep = completedCount === steps.length;

      if (isLastStep) {
        // Get server IPs from step metadata (stored during create_vps step)
        const { data: createVpsStep } = await supabase
          .from("provisioning_steps")
          .select("metadata")
          .eq("job_id", jobId)
          .eq("step_type", "create_vps")
          .single();

        const server1IP = (createVpsStep?.metadata as Record<string, unknown>)?.server1IP as string || "10.0.0.1";
        const server2IP = (createVpsStep?.metadata as Record<string, unknown>)?.server2IP as string || "10.0.0.2";

        // Create server_pair record
        const { data: serverPair } = await supabase
          .from("server_pairs")
          .insert({
            org_id: orgId,
            ns_domain: job.ns_domain,
            server1_ip: server1IP,
            server2_ip: server2IP,
            server1_hostname: `mail1.${job.ns_domain}`,
            server2_hostname: `mail2.${job.ns_domain}`,
            status: "active",
            health_status: "healthy",
          })
          .select()
          .single();

        // Mark job as completed
        await supabase
          .from("provisioning_jobs")
          .update({
            status: "completed",
            progress_pct: 100,
            completed_at: new Date().toISOString(),
            server_pair_id: serverPair?.id || null,
            server1_ip: server1IP,
            server2_ip: server2IP,
          })
          .eq("id", jobId);

        return NextResponse.json({
          jobId,
          step: stepType,
          status: "completed",
          duration_ms: durationMs,
          progress_pct: 100,
          allComplete: true,
          output: result.output,
        });
      }

      return NextResponse.json({
        jobId,
        step: stepType,
        status: "completed",
        duration_ms: durationMs,
        progress_pct: progressPct,
        allComplete: false,
        output: result.output,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      // Mark step as failed
      await supabase
        .from("provisioning_steps")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          error_message: errorMessage,
        })
        .eq("id", pendingStep.id);

      // Mark job as failed
      await supabase
        .from("provisioning_jobs")
        .update({
          status: "failed",
          error_message: `Step "${stepType}" failed: ${errorMessage}`,
        })
        .eq("id", jobId);

      return NextResponse.json({
        jobId,
        step: stepType,
        status: "failed",
        error: errorMessage,
        progress_pct: job.progress_pct,
        allComplete: false,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
