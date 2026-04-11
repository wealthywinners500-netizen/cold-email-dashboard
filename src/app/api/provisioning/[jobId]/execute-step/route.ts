import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { persistPairCredentials } from "@/lib/provisioning/persist-credentials";
import {
  runConfigureRegistrar,
  runSetPtr,
} from "@/lib/provisioning/serverless-steps";
import type { StepType } from "@/lib/provisioning/types";
import crypto from "crypto";

export const dynamic = "force-dynamic";
// Vercel Hobby plan caps serverless functions at 60s. Everything in
// SERVERLESS_STEPS must be bounded by that budget — no multi-minute
// provider polling loops (Hard Lesson #59, Test #14). `create_vps` is
// now a WORKER step because Linode boot routinely takes 60-120s.
export const maxDuration = 60;

// How long a step can sit in `in_progress` before the driver treats it
// as stranded (stale) and fails the job. Keeps the stranded-step class
// of bug from silently advancing to the next pending step — which was
// the Test #14 failure mode (Hard Lesson #59).
//
// Budget: the longest legitimate step is `await_dns_propagation` at 75
// minutes (Ionos NS can take 30-60 min on a cold cache), followed by
// `verification_gate` at 30 minutes (60s × 30 retries while LE issues).
// 90 min gives comfortable headroom on those two while still catching
// genuinely wedged steps before a human would notice. (Test #15 bumped
// from 25 → 90 min after Test #14's 25-min cap proved too aggressive.)
const STRANDED_STEP_TIMEOUT_MS = 90 * 60 * 1000;

// Steps that can run in serverless (API calls only, <60s each).
// configure_registrar (3) + set_ptr (6) hit Ionos / Linode APIs and
// finish in seconds. Everything else exceeds the 60s cap.
const SERVERLESS_STEPS: StepType[] = [
  "configure_registrar",
  "set_ptr",
];

// Steps that run on the worker VPS (SSH, long-running provider polls,
// long-running DNS propagation polls, port 25 reachability checks).
//
// Hard Lesson #59 (Test #14, 2026-04-10): `create_vps` was previously
// on the serverless side, but Linode boot polling routinely blows
// past Vercel's 60s function cap → step stranded `in_progress` with
// orphan VPS + lost credentials. Moved to the worker, which has no
// time cap.
//
// Test #15 (2026-04-11): `verification_gate` and `await_dns_propagation`
// also moved here. The verification gate now runs port 25 banner checks
// (Vercel egress is blocked on 25) and a 30-min retry loop for LE
// issuance settling. await_dns_propagation polls public resolvers for
// up to 75 min waiting for NS delegation to converge.
const WORKER_STEPS: StepType[] = [
  "create_vps",
  "install_hestiacp",
  "await_dns_propagation",
  "setup_dns_zones",
  "setup_mail_domains",
  "security_hardening",
  "verification_gate",
];

// Plan type mapping lives in the worker's provision-step handler now
// that create_vps runs on the worker side. See
// src/worker/handlers/provision-step.ts (Hard Lesson #59).

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

// ============================================
// DryRun simulation (unchanged — for test/demo)
// ============================================
async function executeDryRunStep(
  stepType: StepType,
  context: {
    jobId: string;
    orgId: string;
    nsDomain: string;
    sendingDomains: string[];
    mailAccountsPerDomain: number;
  }
): Promise<{ output: string; metadata?: Record<string, unknown> }> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  switch (stepType) {
    case "create_vps": {
      await delay(2000);
      const ip1 = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const ip2 = `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      // Hard Lesson #58 — even in dry-run, exercise the credential
      // persistence path so the wizard's Step 1 regression-tests SSH
      // credential write end-to-end without spending real VPS dollars.
      const rootPassword = crypto.randomBytes(16).toString("base64url");
      await persistPairCredentials({
        orgId: context.orgId,
        jobId: context.jobId,
        nsDomain: context.nsDomain,
        server1IP: ip1,
        server2IP: ip2,
        rootPassword,
      });

      return {
        output: `[DryRun] VPS pair created: ${ip1} + ${ip2} (credentials persisted)`,
        metadata: {
          server1IP: ip1,
          server2IP: ip2,
          server1ProviderId: `dry-${Date.now()}-s1`,
          server2ProviderId: `dry-${Date.now()}-s2`,
        },
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

// ============================================
// Real serverless step execution (configure_registrar, set_ptr).
// Bodies live in src/lib/provisioning/serverless-steps.ts so the worker
// can call them too via pollAdvanceableJobs (Test #15 hands-off path).
// ============================================
async function executeServerlessStep(
  stepType: StepType,
  jobId: string
): Promise<{ output: string; metadata?: Record<string, unknown> }> {
  switch (stepType) {
    case "configure_registrar":
      return runConfigureRegistrar(jobId);
    case "set_ptr":
      return runSetPtr(jobId);
    default:
      throw new Error(`Step ${stepType} is not a serverless step`);
  }
}

// ============================================
// Dispatch SSH steps (2,4,6,7) to worker via pg-boss
// install_hestiacp(2), setup_dns_zones(4), setup_mail_domains(6), security_hardening(7)
// ============================================
async function dispatchToWorker(
  stepType: StepType,
  jobId: string,
  stepId: string
): Promise<{ output: string; metadata?: Record<string, unknown> }> {
  // Lazy-init Supabase (Hard Lesson #34)
  const supabase = await createAdminClient();

  // Enqueue a per-step job to pg-boss via the provision-step queue
  // The worker polls provisioning_steps WHERE status = 'dispatched_to_worker'
  await supabase
    .from("provisioning_steps")
    .update({
      status: "in_progress",
      metadata: { dispatched_to_worker: true, dispatched_at: new Date().toISOString() },
    })
    .eq("id", stepId);

  // Insert a worker task record that the worker's poll-provisioning-steps cron picks up
  // We use the provisioning_steps table itself — the worker checks for steps with
  // status 'in_progress' and metadata.dispatched_to_worker = true
  return {
    output: `Step ${stepType} dispatched to worker VPS for SSH execution`,
    metadata: { dispatched_to_worker: true, dispatched_at: new Date().toISOString() },
  };
}

/**
 * POST /api/provisioning/[jobId]/execute-step
 *
 * Hybrid execution:
 * - DryRun provider_type → simulate all steps inline (test/demo)
 * - Real providers:
 *   - Steps 3,5,8 (configure_registrar, set_ptr, verification_gate) → serverless
 *   - Steps 1,2,4,6,7 (create_vps, install_hestiacp, setup_dns_zones,
 *                      setup_mail_domains, security_hardening) → worker
 *     (create_vps was moved off serverless per Hard Lesson #59 —
 *     Linode boot polling exceeds Vercel's 60s cap.)
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

    // Hard Lesson #59 (Test #14, 2026-04-10): NEVER silently advance
    // past an in_progress step. The earlier bug was `steps.find(s =>
    // s.status === "pending")` alone, which skipped the stranded Step 1
    // (create_vps) after Vercel's 60s cap killed it, and dispatched
    // Step 2 to the worker with undefined server IPs.
    //
    // New order of operations:
    //   1. If ANY step is in_progress, that step owns the job — do not
    //      pick a pending step past it. Either it's legitimately still
    //      running (worker has it, or another Vercel invocation is
    //      mid-flight) and we return "awaiting_worker"/"busy", OR it's
    //      stale and we mark it failed and fail the whole job.
    //   2. Only when there are ZERO in_progress steps do we look for a
    //      new pending step.
    //
    // Staleness check: compare updated_at (or started_at) to
    // STRANDED_STEP_TIMEOUT_MS. If older, the step is stranded — mark
    // it failed, mark the job failed, and return 500 so the wizard
    // shows the real error instead of silently moving on.

    // --- Pass 1: detect any in_progress step ---------------------------
    type DBStep = {
      id: string;
      step_type: string;
      status: string;
      metadata: Record<string, unknown> | null;
      started_at: string | null;
      updated_at: string | null;
    };
    const dbSteps = steps as DBStep[];

    const inProgressStep = dbSteps.find((s) => s.status === "in_progress");
    if (inProgressStep) {
      const meta = inProgressStep.metadata as Record<string, unknown> | null;
      const dispatchedAt = meta?.dispatched_at as string | undefined;
      const lastTouchIso =
        dispatchedAt ||
        inProgressStep.updated_at ||
        inProgressStep.started_at ||
        null;
      const lastTouchMs = lastTouchIso ? Date.parse(lastTouchIso) : NaN;
      const ageMs = Number.isFinite(lastTouchMs)
        ? Date.now() - lastTouchMs
        : Number.POSITIVE_INFINITY;

      if (ageMs > STRANDED_STEP_TIMEOUT_MS) {
        // Stranded. Fail the step and the job. This is the ONLY branch
        // that makes it past an in_progress step, and it does so by
        // terminating the job, not by silently advancing.
        const errorMsg = `Step "${inProgressStep.step_type}" stranded in_progress for ${Math.round(
          ageMs / 1000
        )}s (> ${Math.round(STRANDED_STEP_TIMEOUT_MS / 1000)}s limit). Likely Vercel function timeout or worker crash. Aborting job so it is not silently advanced past an incomplete step (Hard Lesson #59).`;

        await supabase
          .from("provisioning_steps")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: errorMsg,
          })
          .eq("id", inProgressStep.id);

        await supabase
          .from("provisioning_jobs")
          .update({
            status: "failed",
            error_message: errorMsg,
          })
          .eq("id", jobId);

        return NextResponse.json(
          {
            jobId,
            step: inProgressStep.step_type,
            status: "failed",
            error: errorMsg,
            progress_pct: job.progress_pct,
            allComplete: false,
          },
          { status: 500 }
        );
      }

      // Fresh in_progress step — still running. Report back so the
      // wizard keeps polling without dispatching anything new.
      const statusLabel =
        meta?.dispatched_to_worker === true ? "awaiting_worker" : "in_progress";

      return NextResponse.json({
        jobId,
        step: inProgressStep.step_type,
        status: statusLabel,
        progress_pct: job.progress_pct,
        allComplete: false,
        output:
          statusLabel === "awaiting_worker"
            ? `Step ${inProgressStep.step_type} is running on the worker VPS...`
            : `Step ${inProgressStep.step_type} is still running...`,
      });
    }

    // --- Pass 2: no in_progress step — find the next pending ----------
    const pendingStep = dbSteps.find((s) => s.status === "pending");
    if (!pendingStep) {
      // Nothing pending AND nothing in_progress → all done.
      return NextResponse.json({
        jobId,
        allComplete: true,
        progress_pct: 100,
        status: "completed",
      });
    }

    const stepType = pendingStep.step_type as StepType;
    const startTime = Date.now();

    // Determine if this is a DryRun job
    const providerType = (job.config as Record<string, unknown>)?.provider_type;
    const isDryRun = providerType === "dry_run";

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
      let result: { output: string; metadata?: Record<string, unknown> };

      if (isDryRun) {
        // DryRun path — simulate all steps inline
        result = await executeDryRunStep(stepType, {
          jobId,
          orgId,
          nsDomain: job.ns_domain,
          sendingDomains: job.sending_domains || [],
          mailAccountsPerDomain: job.mail_accounts_per_domain || 3,
        });
      } else if (WORKER_STEPS.includes(stepType)) {
        // SSH steps → dispatch to worker
        result = await dispatchToWorker(stepType, jobId, pendingStep.id);

        // Return immediately — worker will call back when done
        const completedCount = steps.filter(
          (s: Record<string, unknown>) => s.status === "completed"
        ).length;
        const progressPct = Math.round((completedCount / steps.length) * 100);

        return NextResponse.json({
          jobId,
          step: stepType,
          status: "dispatched_to_worker",
          progress_pct: progressPct,
          allComplete: false,
          output: result.output,
        });
      } else if (SERVERLESS_STEPS.includes(stepType)) {
        // API-only steps → execute inline (delegates to serverless-steps.ts)
        result = await executeServerlessStep(stepType, jobId);
      } else {
        throw new Error(`Unknown step type: ${stepType}`);
      }

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

        // Hard Lesson #50 (2026-04-10): this insert was using the LEGACY
        // server1_ip/server2_ip/server1_hostname/server2_hostname column
        // names that don't exist on the server_pairs table (actual schema
        // uses s1_ip, s2_ip, s1_hostname, s2_hostname). The legacy monolithic
        // handler got patched but THIS per-step path was missed, so every
        // completed wizard job silently left server_pair_id=NULL on
        // provisioning_jobs. Also: pair_number is NOT NULL on the table and
        // must be computed per-org (UNIQUE (org_id, pair_number)). Never
        // swallow the insert error — throw to fail the saga.
        const { data: maxPairRow } = await supabase
          .from("server_pairs")
          .select("pair_number")
          .eq("org_id", orgId)
          .order("pair_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextPairNumber = ((maxPairRow?.pair_number as number) || 0) + 1;

        // Hard Lesson #62 (2026-04-11): include provisioning_job_id on the
        // server_pairs INSERT so future readers can hop server_pairs →
        // provisioning_jobs → provisioning_steps without going through the
        // ssh_credentials side door. Pair 10 (Test #14) was created without
        // this FK and had to be backfilled by hand.
        const { data: serverPair, error: serverPairError } = await supabase
          .from("server_pairs")
          .insert({
            org_id: orgId,
            pair_number: nextPairNumber,
            ns_domain: job.ns_domain,
            s1_ip: server1IP,
            s1_hostname: `mail1.${job.ns_domain}`,
            s2_ip: server2IP,
            s2_hostname: `mail2.${job.ns_domain}`,
            status: "complete",
            provisioning_job_id: jobId,
          })
          .select()
          .single();

        if (serverPairError || !serverPair) {
          throw new Error(
            `Failed to insert server_pairs row: ${serverPairError?.message || "unknown"}`
          );
        }

        // Mark job as completed
        await supabase
          .from("provisioning_jobs")
          .update({
            status: "completed",
            progress_pct: 100,
            completed_at: new Date().toISOString(),
            server_pair_id: serverPair.id,
            server1_ip: server1IP,
            server2_ip: server2IP,
          })
          .eq("id", jobId);

        // NOTE: ssh_credentials rows were already inserted in Step 1
        // (create_vps) and linked to the job via provisioning_job_id. The
        // job row now has server_pair_id, so any reader can hop:
        //   ssh_credentials.provisioning_job_id → provisioning_jobs.id
        //   → provisioning_jobs.server_pair_id → server_pairs.id
        // Migration 010 deliberately did not add server_pair_id to
        // ssh_credentials — leave it that way to keep the schema tight.

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
