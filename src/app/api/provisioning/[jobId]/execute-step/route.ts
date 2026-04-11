import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getVPSProvider, getDNSRegistrar } from "@/lib/provisioning/provider-registry";
import { decrypt } from "@/lib/provisioning/encryption";
import { persistPairCredentials } from "@/lib/provisioning/persist-credentials";
import type { StepType, ProvisioningJobRow, VPSProviderType, DNSRegistrarType } from "@/lib/provisioning/types";
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
// Budget: worker create_vps + HestiaCP install can legitimately take
// 15-20 min in the worst case. 25 min gives comfortable headroom while
// still catching genuinely wedged steps before a human would notice.
const STRANDED_STEP_TIMEOUT_MS = 25 * 60 * 1000;

// Steps that can run in serverless (API calls only, <60s each)
// Order: configure_registrar(3), set_ptr(5), verification_gate(8)
const SERVERLESS_STEPS: StepType[] = [
  "configure_registrar",
  "set_ptr",
  "verification_gate",
];

// Steps that run on the worker VPS (SSH OR long-running provider polls)
// Order: create_vps(1), install_hestiacp(2), setup_dns_zones(4),
//        setup_mail_domains(6), security_hardening(7)
//
// Hard Lesson #59 (Test #14, 2026-04-10): `create_vps` was previously
// here on the serverless side, but Linode boot polling routinely blows
// past Vercel's 60s function cap → step stranded `in_progress` with
// orphan VPS + lost credentials. Moved to the worker, which has no
// time cap.
const WORKER_STEPS: StepType[] = [
  "create_vps",
  "install_hestiacp",
  "setup_dns_zones",
  "setup_mail_domains",
  "security_hardening",
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
// Real serverless step execution (steps 1-3, 8)
// ============================================
async function executeServerlessStep(
  stepType: StepType,
  job: ProvisioningJobRow,
  allSteps: Array<{ id: string; step_type: string; status: string; metadata: Record<string, unknown> }>
): Promise<{ output: string; metadata?: Record<string, unknown> }> {
  // Lazy-init Supabase for provider lookups (Hard Lesson #34)
  const supabase = await createAdminClient();

  // Load provider configs
  const { data: vpsRow } = await supabase
    .from("vps_providers")
    .select("*")
    .eq("id", job.vps_provider_id)
    .single();

  const { data: dnsRow } = await supabase
    .from("dns_registrars")
    .select("*")
    .eq("id", job.dns_registrar_id)
    .single();

  if (!vpsRow || !dnsRow) {
    throw new Error("VPS provider or DNS registrar config not found");
  }

  switch (stepType) {
    // NOTE: `create_vps` is deliberately NOT handled here. Hard Lesson #59
    // (Test #14, 2026-04-10): Linode boot polling regularly exceeds Vercel
    // Hobby's 60s maxDuration, leaving the step stranded `in_progress`
    // with orphan VPS instances. Moved to WORKER_STEPS — handled inline
    // by the worker's provision-step handler (no time cap).
    case "set_ptr": {
      // CRITICAL: Linode/Hetzner/Vultr validate forward A record resolves BEFORE accepting rDNS.
      // This step MUST come AFTER setup_dns_zones (Step 4) so A records exist.
      // Implements exponential backoff retry for DNS propagation delay.
      const vpsConfig: Record<string, unknown> = {
        ...vpsRow.config,
        apiKey: vpsRow.api_key_encrypted ? decrypt(vpsRow.api_key_encrypted) : undefined,
        apiSecret: vpsRow.api_secret_encrypted ? decrypt(vpsRow.api_secret_encrypted) : undefined,
      };
      const provider = await getVPSProvider(vpsRow.provider_type as VPSProviderType, vpsConfig);

      // Get IPs from create_vps step metadata or job row
      const createVpsStep = allSteps.find((s) => s.step_type === "create_vps");
      const meta = createVpsStep?.metadata || {};
      const server1IP = (meta.server1IP as string) || job.server1_ip || "";
      const server2IP = (meta.server2IP as string) || job.server2_ip || "";

      if (!server1IP || !server2IP) {
        throw new Error("Server IPs not available — create_vps step must complete first");
      }

      // Retry with exponential backoff (DNS propagation may not be instant)
      const retryDelays = [0, 60_000, 180_000, 300_000]; // 0s, 1min, 3min, 5min
      let lastError = "";

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, retryDelays[attempt]));
        }

        try {
          await provider.setPTR({ ip: server1IP, hostname: `mail1.${job.ns_domain}` });
          await provider.setPTR({ ip: server2IP, hostname: `mail2.${job.ns_domain}` });
          return { output: `PTR records set: mail1.${job.ns_domain} → ${server1IP}, mail2.${job.ns_domain} → ${server2IP}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lastError = msg;

          // Provider doesn't support PTR via API (e.g., Clouding) — no retry
          if (msg.includes("not supported") || msg.includes("not implemented")) {
            return {
              output: `PTR via API not supported by ${vpsRow.provider_type} — manual PTR required`,
              metadata: { manualRequired: true },
            };
          }

          // DNS lookup failure — retry (forward DNS not yet propagated)
          if (msg.includes("unable to perform a lookup") || msg.includes("Unable to look up") || msg.includes("400")) {
            continue;
          }

          // Unknown error — don't retry
          throw err;
        }
      }

      // All retries exhausted — mark as manual required
      return {
        output: `PTR could not be set automatically after ${retryDelays.length} attempts (DNS propagation pending). Last error: ${lastError}. Manual setup: ${server1IP} → mail1.${job.ns_domain}, ${server2IP} → mail2.${job.ns_domain}`,
        metadata: { manualRequired: true },
      };
    }

    case "configure_registrar": {
      const dnsConfig: Record<string, unknown> = {
        ...dnsRow.config,
        apiKey: dnsRow.api_key_encrypted ? decrypt(dnsRow.api_key_encrypted) : undefined,
        apiSecret: dnsRow.api_secret_encrypted ? decrypt(dnsRow.api_secret_encrypted) : undefined,
      };
      const registrar = await getDNSRegistrar(dnsRow.registrar_type as DNSRegistrarType, dnsConfig);

      // Get IPs from create_vps step metadata or job row
      const createVpsStep = allSteps.find((s) => s.step_type === "create_vps");
      const meta = createVpsStep?.metadata || {};
      const server1IP = (meta.server1IP as string) || job.server1_ip || "";
      const server2IP = (meta.server2IP as string) || job.server2_ip || "";

      if (!server1IP || !server2IP) {
        throw new Error("Server IPs not available — create_vps step must complete first");
      }

      // Set nameservers on the ns_domain itself (with glue, since the
      // nameserver hostnames live INSIDE the same domain).
      await registrar.setNameservers(job.ns_domain, [
        `ns1.${job.ns_domain}`,
        `ns2.${job.ns_domain}`,
      ]);

      // Set glue records
      await registrar.setGlueRecords(job.ns_domain, [
        { hostname: `ns1.${job.ns_domain}`, ip: server1IP },
        { hostname: `ns2.${job.ns_domain}`, ip: server2IP },
      ]);

      // Hard Lesson #62 (2026-04-11): Test #14 left pair 10's two sending
      // domains delegated to whatever NS they had before — the wizard's
      // canonical execute-step driver only updated the ns_domain itself.
      // The legacy monolithic saga (pair-provisioning-saga.ts:434-451) had a
      // sendingDomains delegation loop using updateNameserversOnly() but
      // this serverless handler skipped it, so all mail from new pairs would
      // fail SPF/reverse-DNS alignment until manually fixed at Ionos. Mirror
      // the saga loop verbatim. Use updateNameserversOnly (NOT setNameservers)
      // because Ionos's setNameservers is a stash that only fires inside
      // setGlueRecords, and sending domains don't take glue (Hard Lesson #54).
      const ns1Host = `ns1.${job.ns_domain}`;
      const ns2Host = `ns2.${job.ns_domain}`;
      const sendingDelegation: Array<{ domain: string; ok: boolean; error?: string }> = [];
      for (const sendingDomain of (job.sending_domains as string[] | null) || []) {
        try {
          await registrar.updateNameserversOnly(sendingDomain, [ns1Host, ns2Host]);
          sendingDelegation.push({ domain: sendingDomain, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendingDelegation.push({ domain: sendingDomain, ok: false, error: msg });
        }
      }
      const failedDelegations = sendingDelegation.filter((d) => !d.ok);
      if (failedDelegations.length > 0) {
        throw new Error(
          `Sending domain NS delegation failed for: ${failedDelegations
            .map((d) => `${d.domain} (${d.error})`)
            .join("; ")}`
        );
      }

      const okList = sendingDelegation.map((d) => d.domain).join(", ") || "(none)";
      return {
        output: `DNS configured for ${job.ns_domain}: NS → ns1/ns2, glue → ${server1IP}/${server2IP} (${dnsRow.registrar_type}). Sending domains delegated to ${ns1Host}/${ns2Host}: ${okList}`,
      };
    }

    case "verification_gate": {
      // DNS-only verification checks — no SSH required
      // Check A records, PTR, SPF/DKIM/DMARC via dig
      const { execSync } = await import("child_process");
      const results: string[] = [];
      const failures: string[] = [];

      const createVpsStep = allSteps.find((s) => s.step_type === "create_vps");
      const meta = createVpsStep?.metadata || {};
      const server1IP = (meta.server1IP as string) || job.server1_ip || "";
      const server2IP = (meta.server2IP as string) || job.server2_ip || "";

      // Check A records for ns domain
      for (const [hostname, expectedIP] of [
        [`mail1.${job.ns_domain}`, server1IP],
        [`mail2.${job.ns_domain}`, server2IP],
      ]) {
        try {
          const result = execSync(`dig +short A ${hostname} @8.8.8.8`, { timeout: 10000 }).toString().trim();
          if (result.includes(expectedIP)) {
            results.push(`✓ A record ${hostname} → ${expectedIP}`);
          } else {
            failures.push(`✗ A record ${hostname}: expected ${expectedIP}, got ${result || "NXDOMAIN"}`);
          }
        } catch {
          failures.push(`✗ A record lookup failed for ${hostname}`);
        }
      }

      // Check SPF on sending domains
      for (const domain of job.sending_domains || []) {
        try {
          const result = execSync(`dig +short TXT ${domain} @8.8.8.8`, { timeout: 10000 }).toString().trim();
          if (result.includes("v=spf1")) {
            results.push(`✓ SPF found for ${domain}`);
          } else {
            failures.push(`✗ No SPF record for ${domain}`);
          }
        } catch {
          failures.push(`✗ SPF lookup failed for ${domain}`);
        }
      }

      const output = [...results, ...failures].join("\n");
      if (failures.length > 0) {
        // Hard Lesson #62 (2026-04-11): Test #14 finished with 4 DNS failures
        // here, but the previous handler RETURNED success metadata instead
        // of throwing — so the step row + job row both transitioned to
        // 'completed' and the wizard reported a successful provision while
        // the pair was deliverability-broken. The verification gate is the
        // only thing standing between a half-provisioned pair and the
        // resale customer's first send. Throw on any failure so the catch
        // block at the bottom of POST() marks step + job as 'failed'.
        const err = new Error(
          `Verification gate failed (${failures.length} issue(s)):\n${output}`
        );
        // Attach the structured failures for the caller to log/diagnose.
        (err as Error & { failures?: string[] }).failures = failures;
        throw err;
      }

      return { output: `All verification checks passed:\n${output}` };
    }

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
        // API-only steps → execute inline with real providers
        result = await executeServerlessStep(
          stepType,
          job as unknown as ProvisioningJobRow,
          steps as Array<{ id: string; step_type: string; status: string; metadata: Record<string, unknown> }>
        );
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
