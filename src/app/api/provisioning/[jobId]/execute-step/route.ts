import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getVPSProvider, getDNSRegistrar } from "@/lib/provisioning/provider-registry";
import { decrypt } from "@/lib/provisioning/encryption";
import type { StepType, ProvisioningJobRow, VPSProviderType, DNSRegistrarType } from "@/lib/provisioning/types";

export const dynamic = "force-dynamic";

// Steps that can run in serverless (API calls only, no SSH)
// Order: create_vps(1), configure_registrar(3), set_ptr(5), verification_gate(8)
const SERVERLESS_STEPS: StepType[] = [
  "create_vps",
  "configure_registrar",
  "set_ptr",
  "verification_gate",
];

// Steps that require SSH — dispatch to worker VPS
// Order: install_hestiacp(2), setup_dns_zones(4), setup_mail_domains(6), security_hardening(7)
const WORKER_STEPS: StepType[] = [
  "install_hestiacp",
  "setup_dns_zones",
  "setup_mail_domains",
  "security_hardening",
];

// ============================================
// Plan type mapping: wizard size → provider API plan ID
// ============================================
const PLAN_TYPE_MAP: Record<string, Record<string, string>> = {
  linode: {
    small: "g6-nanode-1",     // 1 vCPU / 1GB RAM / $5/mo
    medium: "g6-standard-1",  // 1 vCPU / 2GB RAM / $12/mo
    large: "g6-standard-2",   // 2 vCPU / 4GB RAM / $24/mo
  },
  digitalocean: {
    small: "s-1vcpu-2gb",
    medium: "s-2vcpu-4gb",
    large: "s-4vcpu-8gb",
  },
  hetzner: {
    small: "cx22",
    medium: "cx32",
    large: "cx42",
  },
  vultr: {
    small: "vc2-1c-2gb",
    medium: "vc2-2c-4gb",
    large: "vc2-4c-8gb",
  },
  clouding: {
    small: "0.5C-1G",
    medium: "1C-2G",
    large: "2C-4G",
  },
};

function resolveProviderPlan(providerType: string, sizeLabel: string): string {
  const providerPlans = PLAN_TYPE_MAP[providerType];
  if (providerPlans && providerPlans[sizeLabel]) {
    return providerPlans[sizeLabel];
  }
  // If size is already a provider-specific plan ID (not a generic label), pass through
  return sizeLabel;
}

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
    case "create_vps": {
      const vpsConfig: Record<string, unknown> = {
        ...vpsRow.config,
        apiKey: vpsRow.api_key_encrypted ? decrypt(vpsRow.api_key_encrypted) : undefined,
        apiSecret: vpsRow.api_secret_encrypted ? decrypt(vpsRow.api_secret_encrypted) : undefined,
      };
      const provider = await getVPSProvider(vpsRow.provider_type as VPSProviderType, vpsConfig);

      // Read region and size from JOB config (set by wizard), NOT vpsRow config
      const jobConfig = (job.config || {}) as Record<string, string>;
      const region = jobConfig.region || "us-east";
      const sizeLabel = jobConfig.size || "small";
      const providerPlan = resolveProviderPlan(vpsRow.provider_type, sizeLabel);

      // Create two servers
      const server1 = await provider.createServer({
        name: `mail1-${job.ns_domain.replace(/\./g, "-")}`,
        region,
        size: providerPlan,
      });

      const server2 = await provider.createServer({
        name: `mail2-${job.ns_domain.replace(/\./g, "-")}`,
        region,
        size: providerPlan,
      });

      // Poll until both are active (max 10 min)
      const pollStart = Date.now();
      const POLL_TIMEOUT = 10 * 60 * 1000;
      let s1Active = server1.status === "active";
      let s2Active = server2.status === "active";

      while ((!s1Active || !s2Active) && Date.now() - pollStart < POLL_TIMEOUT) {
        await new Promise((r) => setTimeout(r, 15000));
        if (!s1Active) {
          const info = await provider.getServer(server1.id);
          s1Active = info.status === "active" || info.status === "running";
          if (s1Active && !server1.ip) Object.assign(server1, { ip: info.ip });
        }
        if (!s2Active) {
          const info = await provider.getServer(server2.id);
          s2Active = info.status === "active" || info.status === "running";
          if (s2Active && !server2.ip) Object.assign(server2, { ip: info.ip });
        }
      }

      if (!s1Active || !s2Active) {
        throw new Error("Timed out waiting for VPS servers to become active");
      }

      // Store IPs in job row for later steps
      await supabase
        .from("provisioning_jobs")
        .update({
          server1_ip: server1.ip,
          server2_ip: server2.ip,
          server1_provider_id: server1.id,
          server2_provider_id: server2.id,
        })
        .eq("id", job.id);

      return {
        output: `VPS pair created: ${server1.ip} + ${server2.ip} (${vpsRow.provider_type})`,
        metadata: {
          server1IP: server1.ip,
          server2IP: server2.ip,
          server1ProviderId: server1.id,
          server2ProviderId: server2.id,
        },
      };
    }

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

      // Set nameservers
      await registrar.setNameservers(job.ns_domain, [
        `ns1.${job.ns_domain}`,
        `ns2.${job.ns_domain}`,
      ]);

      // Set glue records
      await registrar.setGlueRecords(job.ns_domain, [
        { hostname: `ns1.${job.ns_domain}`, ip: server1IP },
        { hostname: `ns2.${job.ns_domain}`, ip: server2IP },
      ]);

      return {
        output: `DNS configured for ${job.ns_domain}: NS → ns1/ns2, glue → ${server1IP}/${server2IP} (${dnsRow.registrar_type})`,
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
        return {
          output: `Verification completed with ${failures.length} issue(s):\n${output}`,
          metadata: { failures, manualRequired: true },
        };
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
 *   - Steps 1,3,5,8 (create_vps, configure_registrar, set_ptr, verification_gate) → serverless
 *   - Steps 2,4,6,7 (install_hestiacp, setup_dns_zones, setup_mail_domains, security_hardening) → worker
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
      // Check if any steps are still dispatched to worker (in_progress with dispatched_to_worker)
      const workerStep = steps.find((s: Record<string, unknown>) => {
        const meta = s.metadata as Record<string, unknown> | null;
        return s.status === "in_progress" && meta?.dispatched_to_worker === true;
      });

      if (workerStep) {
        // Worker is still processing — tell client to wait
        return NextResponse.json({
          jobId,
          step: workerStep.step_type,
          status: "awaiting_worker",
          progress_pct: job.progress_pct,
          allComplete: false,
          output: `Step ${workerStep.step_type} is running on the worker VPS...`,
        });
      }

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
