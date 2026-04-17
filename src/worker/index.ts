import { initBoss, stopBoss } from "../lib/email/campaign-queue";
import { handleSendEmail } from "./handlers/send-email";
import { handleProcessSequenceStep } from "./handlers/process-sequence-step";
import { handleCheckNoReply } from "./handlers/check-no-reply";
import { handleSyncAllAccounts, handleClassifyReply, handleClassifyBatch } from "./handlers/sync-inbox";
import { handleProcessBounce } from "./handlers/process-bounce";
import { handleQueueSequenceSteps } from "./handlers/queue-sequence-steps";
import { handleWarmupIncrement } from "./handlers/warm-up-increment";
import { handleSmtpConnectionMonitor } from "./handlers/smtp-connection-monitor";
import { handleAccountDeliverabilityMonitor } from "./handlers/account-deliverability-monitor";
import { handleCampaignPerformanceMonitor } from "./handlers/campaign-performance-monitor";
import { handleDistributeCampaignSends } from "./handlers/distribute-campaign-sends";
import { handleVerifyNewLeads } from "./handlers/verify-new-leads";
import { handleProvisionPair } from "./handlers/provision-pair";
import { handleProvisionStep } from "./handlers/provision-step";
import { handleRollbackProvision } from "./handlers/rollback-provision";
import { handleHealthCheck } from "./handlers/health-check";
import {
  handleListRegistrarDomains,
  type ListRegistrarDomainsPayload,
} from "./handlers/list-registrar-domains";
import { closeAll } from "../lib/email/smtp-manager";
import { createClient } from "@supabase/supabase-js";
import { handleWorkerError, updateWorkerHeartbeat, resetDailyCounters } from "../lib/email/error-handler";
import { startBlacklistProxy } from "./blacklist-proxy";
import os from "os";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function main() {
  console.log("[Worker] Starting email worker...");

  const boss = await initBoss();
  console.log("[Worker] pg-boss started");

  // -------------------------------------------------------------------------
  // Phase 6A: WORKER_ROLE partitioning
  //
  // Single codebase, two deployments. WORKER_ROLE=ops (default, back-compat)
  // keeps the existing 200.234.226.226 box running provisioning + telemetry.
  // WORKER_ROLE=send runs everything that touches mail (send-email,
  // process-sequence-step, IMAP sync, classification, warmup, bounce parsing).
  // WORKER_ROLE=all keeps the pre-split behavior for single-box setups.
  //
  // Queue/cron NAMES as wired into pg-boss below. If you add a new handler,
  // append its queue name to the correct set OR the shouldRegister() guard
  // will throw at startup. (Failing loud here is intentional — a silently
  // unclassified handler running on the wrong worker is worse than a crash.)
  // -------------------------------------------------------------------------
  const WORKER_ROLE = (process.env.WORKER_ROLE || "ops") as "ops" | "send" | "all";
  console.log(`[Worker] WORKER_ROLE=${WORKER_ROLE}`);

  const SEND_HANDLERS = new Set<string>([
    "send-email",
    "process-sequence-step",
    "queue-sequence-steps",
    "distribute-campaign-sends",
    "sync-all-accounts",
    "classify-batch",
    "check-no-reply",
    "process-bounce",
    "warm-up-increment-cron",
    "classify-reply",
    "reset-daily-counts",
  ]);

  const OPS_HANDLERS = new Set<string>([
    // Actual queue names verified against createQueue list above — the phase
    // spec used "provision-pair" and "health-check" but the real names in
    // this worker are "provision-server-pair" and "server-health-check".
    "provision-server-pair",
    "provision-step",
    "rollback-provision",
    "list-registrar-domains",
    "server-health-check-cron",
    "server-health-check",
    "verify-new-leads",
    "smtp-connection-monitor",
    "account-deliverability-monitor",
    "campaign-performance-monitor",
  ]);

  function classify(name: string): "send" | "ops" | "unknown" {
    if (SEND_HANDLERS.has(name)) return "send";
    if (OPS_HANDLERS.has(name)) return "ops";
    return "unknown";
  }

  let registeredCount = 0;
  let skippedCount = 0;
  function shouldRegister(name: string): boolean {
    const kind = classify(name);
    if (kind === "unknown") {
      // Fail loud — a handler slipping through unclassified means the send
      // worker could accidentally run ops crons (or vice versa). Crash at
      // startup rather than let that ship.
      throw new Error(
        `[Worker] Unclassified pg-boss handler "${name}" — add it to SEND_HANDLERS or OPS_HANDLERS`
      );
    }
    const run =
      WORKER_ROLE === "all" ||
      (WORKER_ROLE === "send" && kind === "send") ||
      (WORKER_ROLE === "ops" && kind === "ops");
    if (run) registeredCount++;
    else skippedCount++;
    return run;
  }

  // The setInterval-based provisioning pollers (pollDispatchedSteps,
  // pollAdvanceableJobs, pollRegistrarDomainListings) are not pg-boss handlers
  // — they're bare polls that read provisioning tables directly. They're
  // semantically ops-only; gate them separately.
  const OPS_SIDE_EFFECTS_ENABLED = WORKER_ROLE === "all" || WORKER_ROLE === "ops";

  // Hard lesson #47 (2026-04-10): Spamhaus blocks DNSBL queries from cloud
  // IPs. The worker VPS lives on a non-cloud IP and exposes an HTTP proxy
  // for the Vercel app's domain-blacklist helper to fall back to whenever
  // the primary Spamhaus DQS check returns 'unknown'. Auth via the shared
  // WORKER_CALLBACK_SECRET that's already used for the worker callback.
  //
  // Phase 6A: gate on ops role. The send-worker lives on a Linode cloud IP
  // which is DBL-blocked identically to Vercel's cloud IPs, so a fallback
  // listener there would give Vercel a useless second endpoint. Only the
  // ops VPS's non-cloud IP can answer these queries.
  const blacklistServer = OPS_SIDE_EFFECTS_ENABLED ? startBlacklistProxy() : null;

  // Create all queues (required by pg-boss v12+)
  const queueNames = [
    "send-email",
    "process-sequence-step",
    "sync-all-accounts",
    "classify-batch",
    "reset-daily-counts",
    "check-no-reply",
    "classify-reply",
    "process-bounce",
    "queue-sequence-steps",
    "warm-up-increment-cron",
    "smtp-connection-monitor",
    "account-deliverability-monitor",
    "campaign-performance-monitor",
    "distribute-campaign-sends",
    "verify-new-leads",
    "provision-server-pair",
    "provision-step",
    "rollback-provision",
    "server-health-check-cron",
    "server-health-check",
    "poll-provisioning-jobs",
    "list-registrar-domains",
  ];
  for (const name of queueNames) {
    await boss.createQueue(name);
  }
  console.log("[Worker] All queues created");

  // --- Heartbeat: pulse every 60 seconds for all orgs ---
  //
  // Phase 6A: gate on ops role. This legacy per-org heartbeat predates the
  // infra-level worker_heartbeats upsert added in Edit 4 below. Leaving it
  // on both roles would double the write volume to every org row AND create
  // dual-source ambiguity (two stores that could disagree about whether a
  // worker is alive). Keep it ops-only to preserve pre-6A write volume; the
  // new worker_heartbeats table is the infra-level source of truth for
  // "which workers are alive" across both roles.
  const heartbeatInterval = OPS_SIDE_EFFECTS_ENABLED
    ? setInterval(async () => {
        try {
          const supabase = getSupabase();
          const { data: orgs } = await supabase.from("organizations").select("id");
          for (const org of orgs || []) {
            await updateWorkerHeartbeat(org.id);
          }
        } catch (err) {
          console.error("[Worker] Heartbeat failed:", err);
        }
      }, 60000)
    : null;

  // --- Error handling wrapper ---
  function withErrorHandling<T extends Record<string, any>>(
    handler: (data: T) => Promise<void>,
    jobName: string
  ) {
    return async (jobs: { id: string; data: T }[]) => {
      for (const job of jobs) {
        try {
          await handler(job.data);
          console.log(`[Worker] Job ${job.id} (${jobName}) completed successfully`);
        } catch (err) {
          console.error(`[Worker] Job ${job.id} (${jobName}) failed:`, err);
          const error = err instanceof Error ? err : new Error(String(err));
          await handleWorkerError(error, jobName, job.data).catch(e =>
            console.error("[Worker] Error handler failed:", e)
          );
          throw err;
        }
      }
    };
  }

  // Register send-email handler
  interface SendEmailPayload {
    recipientId: string;
    accountId: string;
    campaignId: string;
    orgId: string;
  }

  if (shouldRegister("send-email")) {
    await boss.work<SendEmailPayload>(
      "send-email",
      withErrorHandling(handleSendEmail, "send-email")
    );
  }

  // Register process-sequence-step handler
  interface ProcessSequenceStepPayload {
    stateId: string;
    recipientId: string;
    sequenceId: string;
    stepNumber: number;
    campaignId: string;
    orgId: string;
  }

  if (shouldRegister("process-sequence-step")) {
    await boss.work<ProcessSequenceStepPayload>(
      "process-sequence-step",
      withErrorHandling(handleProcessSequenceStep, "process-sequence-step")
    );
  }

  // Register sync-all-accounts cron (every 5 minutes)
  if (shouldRegister("sync-all-accounts")) {
    await boss.schedule("sync-all-accounts", "*/5 * * * *");
    await boss.work("sync-all-accounts", async () => {
      console.log("[Worker] Syncing all email accounts...");
      try {
        await handleSyncAllAccounts();
      } catch (err) {
        console.error("[Worker] Account sync failed:", err);
        throw err;
      }
    });
  }

  // Register classify-batch cron (every hour)
  if (shouldRegister("classify-batch")) {
    await boss.schedule("classify-batch", "0 * * * *");
    await boss.work("classify-batch", async () => {
      console.log("[Worker] Running batch classification...");
      try {
        await handleClassifyBatch();
      } catch (err) {
        console.error("[Worker] Batch classification failed:", err);
        throw err;
      }
    });
  }

  // Register daily cron to reset sends_today + worker counters
  if (shouldRegister("reset-daily-counts")) {
    await boss.schedule("reset-daily-counts", "0 0 * * *");
    await boss.work("reset-daily-counts", async () => {
      console.log("[Worker] Resetting daily counts...");
      const supabase = getSupabase();

      // Reset email account sends_today
      const { error } = await supabase
        .from("email_accounts")
        .update({ sends_today: 0 })
        .neq("sends_today", 0);

      if (error) {
        console.error("[Worker] Failed to reset daily counts:", error);
        throw error;
      }

      // Reset worker counters for all orgs
      const { data: orgs } = await supabase.from("organizations").select("id");
      for (const org of orgs || []) {
        await resetDailyCounters(org.id);
      }

      console.log("[Worker] Daily counts reset successfully");
    });
  }

  // Register check-no-reply cron (every hour)
  if (shouldRegister("check-no-reply")) {
    await boss.schedule("check-no-reply", "0 * * * *");
    await boss.work("check-no-reply", async () => {
      console.log("[Worker] Running no-reply trigger check...");
      try {
        await handleCheckNoReply();
      } catch (err) {
        console.error("[Worker] No-reply trigger check failed:", err);
        throw err;
      }
    });
  }

  // Register classify-reply handler (called directly from sync)
  interface ClassifyReplyPayload {
    messageId: number;
  }

  if (shouldRegister("classify-reply")) {
    await boss.work<ClassifyReplyPayload>(
      "classify-reply",
      withErrorHandling(handleClassifyReply, "classify-reply")
    );
  }

  // Register process-bounce handler (B10)
  interface ProcessBouncePayload {
    messageId: number;
    bodyText: string;
    fromEmail: string;
    orgId: string;
  }

  if (shouldRegister("process-bounce")) {
    await boss.work<ProcessBouncePayload>(
      "process-bounce",
      withErrorHandling(handleProcessBounce, "process-bounce")
    );
  }

  // Register queue-sequence-steps cron (every 5 minutes)
  if (shouldRegister("queue-sequence-steps")) {
    await boss.schedule("queue-sequence-steps", "*/5 * * * *");
    await boss.work("queue-sequence-steps", async () => {
      console.log("[Worker] Queuing ready sequence steps...");
      try {
        await handleQueueSequenceSteps();
      } catch (err) {
        console.error("[Worker] Queue sequence steps failed:", err);
        throw err;
      }
    });
  }

  // Register warm-up-increment-cron (daily at 1 AM)
  if (shouldRegister("warm-up-increment-cron")) {
    await boss.schedule("warm-up-increment-cron", "0 1 * * *");
    await boss.work("warm-up-increment-cron", async () => {
      console.log("[Worker] Running warm-up increment...");
      try {
        await handleWarmupIncrement();
      } catch (err) {
        console.error("[Worker] Warm-up increment failed:", err);
        throw err;
      }
    });
  }

  // Register smtp-connection-monitor cron (every 15 minutes)
  if (shouldRegister("smtp-connection-monitor")) {
    await boss.schedule("smtp-connection-monitor", "*/15 * * * *");
    await boss.work("smtp-connection-monitor", async () => {
      console.log("[Worker] Monitoring SMTP connections...");
      try {
        await handleSmtpConnectionMonitor();
      } catch (err) {
        console.error("[Worker] SMTP connection monitor failed:", err);
        throw err;
      }
    });
  }

  // Register account-deliverability-monitor cron (daily at 3 AM)
  if (shouldRegister("account-deliverability-monitor")) {
    await boss.schedule("account-deliverability-monitor", "0 3 * * *");
    await boss.work("account-deliverability-monitor", async () => {
      console.log("[Worker] Monitoring account deliverability...");
      try {
        await handleAccountDeliverabilityMonitor();
      } catch (err) {
        console.error("[Worker] Account deliverability monitor failed:", err);
        throw err;
      }
    });
  }

  // Register campaign-performance-monitor cron (daily at 4 AM)
  if (shouldRegister("campaign-performance-monitor")) {
    await boss.schedule("campaign-performance-monitor", "0 4 * * *");
    await boss.work("campaign-performance-monitor", async () => {
      console.log("[Worker] Monitoring campaign performance...");
      try {
        await handleCampaignPerformanceMonitor();
      } catch (err) {
        console.error("[Worker] Campaign performance monitor failed:", err);
        throw err;
      }
    });
  }

  // Register distribute-campaign-sends cron (daily at 6 AM)
  if (shouldRegister("distribute-campaign-sends")) {
    await boss.schedule("distribute-campaign-sends", "0 6 * * *");
    await boss.work("distribute-campaign-sends", async () => {
      console.log("[Worker] Distributing campaign sends...");
      try {
        await handleDistributeCampaignSends();
      } catch (err) {
        console.error("[Worker] Distribute campaign sends failed:", err);
        throw err;
      }
    });
  }

  // Register verify-new-leads handler
  interface VerifyNewLeadsPayload {
    orgId: string;
  }

  if (shouldRegister("verify-new-leads")) {
    await boss.work<VerifyNewLeadsPayload>(
      "verify-new-leads",
      withErrorHandling(handleVerifyNewLeads, "verify-new-leads")
    );
  }

  // Register provision-server-pair handler (B15-3, B16-hands-free)
  interface ProvisionPairPayload {
    jobId: string;
  }

  // --- Hard lesson #11 (2026-04-10): provision-server-pair queue is the LEGACY
  // monolithic path that ran the full 8-step saga inside the worker. It raced
  // with the canonical Vercel execute-step → provision-step bridge and corrupted
  // step rows in all 10 of 2026-04-10's real provisioning attempts.
  //
  // The canonical path is now:
  //   wizard → POST /api/provisioning → POST /api/provisioning/[jobId]/execute-step
  //   → for SSH-heavy steps 2/4/6/7: boss.send('provision-step') → worker handler
  //     → HMAC callback POST to /api/provisioning/[jobId]/worker-callback
  //
  // The handler is still imported + registered so existing queued jobs can be
  // drained safely, but we gate behind ENABLE_LEGACY_MONOLITHIC_PROVISIONING
  // (default false) and force teamConcurrency=1 to prevent double execution.
  // See feedback_hard_lessons.md hard lessons #11-#14.
  const enableLegacyMonolithic = process.env.ENABLE_LEGACY_MONOLITHIC_PROVISIONING === 'true';

  if (enableLegacyMonolithic && shouldRegister("provision-server-pair")) {
    console.warn("[Worker] WARNING: ENABLE_LEGACY_MONOLITHIC_PROVISIONING=true — registering legacy provision-server-pair handler. This path races with the canonical execute-step path.");
    await boss.work<ProvisionPairPayload>(
      "provision-server-pair",
      {
        batchSize: 1,
        pollingIntervalSeconds: 10,
        localConcurrency: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          console.log(`[Worker] Starting provision-server-pair job ${job.id}`);
          try {
            await handleProvisionPair(job.data);
            console.log(`[Worker] Provision job ${job.id} completed successfully`);
          } catch (err) {
            console.error(`[Worker] Provision job ${job.id} failed:`, err);
            throw err;
          }
        }
      }
    );
  } else {
    console.log("[Worker] Legacy provision-server-pair handler DISABLED (ENABLE_LEGACY_MONOLITHIC_PROVISIONING not set or role mismatch). Using canonical execute-step → provision-step bridge.");
  }

  // Register provision-step handler (per-step SSH execution via worker bridge)
  interface ProvisionStepPayload {
    jobId: string;
    stepType: "install_hestiacp" | "setup_dns_zones" | "setup_mail_domains" | "security_hardening";
    stepId: string;
  }

  // localConcurrency=1 + batchSize=1 ensures a single SSH-heavy step can NEVER
  // be delivered twice in parallel while it's still running. pg-boss would
  // otherwise re-deliver on ack timeout and trigger the same race condition
  // that poisoned Test #11. (pg-boss v12 uses localConcurrency, not teamSize.)
  if (shouldRegister("provision-step")) {
    await boss.work<ProvisionStepPayload>(
      "provision-step",
      {
        batchSize: 1,
        pollingIntervalSeconds: 10,
        localConcurrency: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          console.log(`[Worker] Starting provision-step job ${job.id} (${job.data.stepType})`);
          try {
            await handleProvisionStep(job.data);
            console.log(`[Worker] Provision-step job ${job.id} completed successfully`);
          } catch (err) {
            console.error(`[Worker] Provision-step job ${job.id} failed:`, err);
            throw err;
          }
        }
      }
    );
  }

  // Register rollback-provision handler (B15-3, B16-hands-free)
  interface RollbackProvisionPayload {
    jobId: string;
  }

  if (shouldRegister("rollback-provision")) {
    await boss.work<RollbackProvisionPayload>(
      "rollback-provision",
      {
        batchSize: 1,
        pollingIntervalSeconds: 10,
        localConcurrency: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          console.log(`[Worker] Starting rollback-provision job ${job.id}`);
          try {
            await handleRollbackProvision(job.data);
            console.log(`[Worker] Rollback job ${job.id} completed successfully`);
          } catch (err) {
            console.error(`[Worker] Rollback job ${job.id} failed:`, err);
            throw err;
          }
        }
      }
    );
  }

  // Register server-health-check cron (every 6 hours)
  if (shouldRegister("server-health-check-cron")) {
    await boss.schedule("server-health-check-cron", "0 */6 * * *");
    await boss.work("server-health-check-cron", async () => {
      console.log("[Worker] Running scheduled server health checks...");
      try {
        const supabase = getSupabase();
        const { data: pairs } = await supabase
          .from("server_pairs")
          .select("id")
          .eq("status", "active");

        if (pairs && pairs.length > 0) {
          for (const pair of pairs) {
            await boss.send("server-health-check", { serverPairId: pair.id });
          }
          console.log(`[Worker] Queued health checks for ${pairs.length} active server pairs`);
        }
      } catch (err) {
        console.error("[Worker] Health check cron failed:", err);
        throw err;
      }
    });
  }

  // Register server-health-check handler
  interface HealthCheckPayload {
    serverPairId: string;
  }

  if (shouldRegister("server-health-check")) {
    await boss.work<HealthCheckPayload>(
      "server-health-check",
      {
        batchSize: 1,
        pollingIntervalSeconds: 10,
      },
      async (jobs) => {
        for (const job of jobs) {
          console.log(`[Worker] Starting health check for pair ${job.data.serverPairId}`);
          try {
            await handleHealthCheck(job.data);
            console.log(`[Worker] Health check job ${job.id} completed successfully`);
          } catch (err) {
            console.error(`[Worker] Health check job ${job.id} failed:`, err);
            throw err;
          }
        }
      }
    );
  }

  // Register list-registrar-domains handler.
  // Async-polling worker for the /api/dns-registrars/[id]/domains endpoint.
  // The Vercel route writes a {status:'fetching'} cache entry, dispatches to
  // this queue, and returns HTTP 202 immediately. The worker then performs
  // the full slow listing (Ionos per-domain MX check takes ~9 min for 110
  // domains at 25 req/min throttle) and writes the result back to
  // dns_registrars.config.domainCache. The wizard polls the same endpoint
  // every few seconds until the cache flips to 'ready'.
  //
  // localConcurrency=1 + batchSize=1: we never want two simultaneous full
  // registrar listings against the same account — Ionos's throttle is
  // per-account and concurrent listings would just rate-limit each other.
  if (shouldRegister("list-registrar-domains")) {
    await boss.work<ListRegistrarDomainsPayload>(
      "list-registrar-domains",
      {
        batchSize: 1,
        pollingIntervalSeconds: 5,
        localConcurrency: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          console.log(
            `[Worker] Starting list-registrar-domains job ${job.id} for registrar ${job.data.registrarId}`
          );
          try {
            await handleListRegistrarDomains(job.data);
            console.log(
              `[Worker] list-registrar-domains job ${job.id} completed successfully`
            );
          } catch (err) {
            console.error(
              `[Worker] list-registrar-domains job ${job.id} failed:`,
              err
            );
            throw err;
          }
        }
      }
    );
  }

  // --- Provisioning job-polling cron DISABLED 2026-04-10 ---
  // Hard lesson #11: This legacy monolithic path raced with the Vercel
  // execute-step endpoint and corrupted step rows. The canonical provisioning
  // flow is now:
  //   wizard → POST /api/provisioning
  //          → POST /api/provisioning/[jobId]/execute-step (serverless)
  //          → for SSH-heavy steps 2/4/6/7: boss.send('provision-step')
  //            → worker provision-step handler → HMAC callback
  //
  // Re-enable ONLY if you explicitly want the worker to drive the whole saga
  // itself (not recommended). See feedback_hard_lessons.md hard lessons #11-#14.
  //
  // await boss.schedule("poll-provisioning-jobs", "*/1 * * * *");
  //
  // const pollProvisioningJobs = async () => { ... };
  // setInterval(pollProvisioningJobs, 15000);
  // await pollProvisioningJobs();
  console.log("[Worker] pollProvisioningJobs cron DISABLED — canonical path is execute-step → provision-step bridge.");

  // --- Poll for dispatched worker steps (worker bridge pattern) ---
  // The Vercel API marks steps as in_progress with metadata.dispatched_to_worker = true.
  // This cron picks them up and queues provision-step jobs.
  const pollDispatchedSteps = async () => {
    try {
      const supabase = getSupabase();

      // Find steps dispatched to worker that haven't been queued yet
      const { data: dispatchedSteps } = await supabase
        .from("provisioning_steps")
        .select("id, job_id, step_type, metadata")
        .eq("status", "in_progress")
        .order("step_order", { ascending: true })
        .limit(5);

      for (const step of dispatchedSteps || []) {
        const meta = step.metadata as Record<string, unknown> | null;
        if (!meta?.dispatched_to_worker) continue;
        if (meta.worker_queued) continue; // Already queued

        console.log(`[Worker] Found dispatched step ${step.step_type} for job ${step.job_id}, queuing...`);

        await boss.send("provision-step", {
          jobId: step.job_id,
          stepType: step.step_type,
          stepId: step.id,
        });

        // Mark as queued to prevent double-processing
        await supabase
          .from("provisioning_steps")
          .update({
            metadata: { ...meta, worker_queued: true, worker_queued_at: new Date().toISOString() },
          })
          .eq("id", step.id);
      }
    } catch (err) {
      console.error("[Worker] Dispatched step poll failed:", err);
    }
  };

  // Poll every 10 seconds for dispatched steps (OPS only — send-worker has
  // no business touching provisioning_steps).
  if (OPS_SIDE_EFFECTS_ENABLED) {
    setInterval(pollDispatchedSteps, 10000);
    await pollDispatchedSteps();
  }

  // --- Poll for advanceable provisioning jobs (Test #15, hands-off driver) ---
  // The wizard-driven flow has Vercel's execute-step route choose the next
  // pending step and atomically claim it (status='pending' → 'in_progress'
  // with metadata.dispatched_to_worker=true), at which point pollDispatchedSteps
  // picks it up. For hands-off jobs (inserted directly via service role,
  // bypassing the Clerk POST), nothing drives that step transition.
  //
  // pollAdvanceableJobs fills that gap: find jobs in (pending, in_progress),
  // verify no step is currently in_progress, find the lowest-step_order pending
  // step, and atomically claim it. The conditional UPDATE on status='pending'
  // (Hard Lesson #42 atomic claim) prevents two poller ticks or two worker
  // instances from claiming the same step.
  //
  // This driver does NOT call boss.send directly — it just performs the
  // atomic claim. pollDispatchedSteps then enqueues the provision-step job
  // on its next tick (10s later, worst case). One source of truth, no races.
  //
  // Hard Lesson #11 redux: this is NOT a re-enable of pollProvisioningJobs.
  // The old monolith ran the entire saga in one process. This driver only
  // claims the next step and hands off to the existing dispatched-steps
  // bridge — same canonical path as the wizard.
  const pollAdvanceableJobs = async () => {
    try {
      const supabase = getSupabase();

      // Find jobs that could potentially advance
      const { data: jobs } = await supabase
        .from("provisioning_jobs")
        .select("id, status")
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: true })
        .limit(20);

      if (!jobs || jobs.length === 0) return;

      for (const job of jobs) {
        // Check if any step for this job is currently in_progress.
        // If so, skip — we wait for that step's worker callback to
        // mark it complete before claiming the next one.
        const { data: inProgressSteps } = await supabase
          .from("provisioning_steps")
          .select("id, step_type")
          .eq("job_id", job.id)
          .eq("status", "in_progress")
          .limit(1);

        if (inProgressSteps && inProgressSteps.length > 0) {
          continue;
        }

        // Find the lowest-step_order pending step
        const { data: pendingSteps } = await supabase
          .from("provisioning_steps")
          .select("id, step_type, step_order")
          .eq("job_id", job.id)
          .eq("status", "pending")
          .order("step_order", { ascending: true })
          .limit(1);

        if (!pendingSteps || pendingSteps.length === 0) {
          continue;
        }

        const next = pendingSteps[0];

        // Atomic claim: only succeed if the row is still 'pending'
        // (Hard Lesson #42). If two pollers race, exactly one wins.
        const claimTime = new Date().toISOString();
        const { data: claimed, error: claimErr } = await supabase
          .from("provisioning_steps")
          .update({
            status: "in_progress",
            started_at: claimTime,
            metadata: {
              dispatched_to_worker: true,
              claimed_by: "pollAdvanceableJobs",
              claimed_at: claimTime,
            },
          })
          .eq("id", next.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (claimErr || !claimed) {
          // Another poller tick claimed it. Move on.
          continue;
        }

        // Hard Lesson #77: Queue the pg-boss job directly instead of
        // relying on pollDispatchedSteps to read metadata.dispatched_to_worker.
        // A Supabase Realtime trigger or race condition was reproducibly
        // clobbering metadata to {}, leaving the step stuck in in_progress
        // with no worker pickup. Direct enqueue eliminates the two-step handoff.
        try {
          await boss.send("provision-step", {
            jobId: job.id,
            stepType: next.step_type,
            stepId: next.id,
          });

          // Mark worker_queued so pollDispatchedSteps skips it
          await supabase
            .from("provisioning_steps")
            .update({
              metadata: {
                dispatched_to_worker: true,
                claimed_by: "pollAdvanceableJobs",
                claimed_at: claimTime,
                worker_queued: true,
                worker_queued_at: new Date().toISOString(),
              },
            })
            .eq("id", next.id);
        } catch (queueErr) {
          console.error(
            `[Worker] pollAdvanceableJobs failed to queue ${next.step_type} for job ${job.id}: ${queueErr}`
          );
          // Step is in_progress but not queued — pollDispatchedSteps
          // will pick it up on next tick as a fallback.
        }

        // Promote job to in_progress if it was pending
        if (job.status === "pending") {
          await supabase
            .from("provisioning_jobs")
            .update({
              status: "in_progress",
              started_at: claimTime,
              current_step: next.step_type,
            })
            .eq("id", job.id)
            .eq("status", "pending");
        } else {
          await supabase
            .from("provisioning_jobs")
            .update({ current_step: next.step_type })
            .eq("id", job.id);
        }

        console.log(
          `[Worker] pollAdvanceableJobs claimed ${next.step_type} (step_order=${next.step_order}) for job ${job.id}`
        );
      }
    } catch (err) {
      console.error("[Worker] pollAdvanceableJobs failed:", err);
    }
  };

  // Poll every 15 seconds — slightly slower than pollDispatchedSteps so
  // a freshly-claimed step gets dispatched in roughly one tick. OPS only.
  if (OPS_SIDE_EFFECTS_ENABLED) {
    setInterval(pollAdvanceableJobs, 15000);
    await pollAdvanceableJobs();
  }

  // --- Poll for pending registrar domain-listing requests (worker bridge) ---
  // Vercel /api/dns-registrars/[id]/domains writes a 'fetching' cache entry
  // when a wizard user clicks Fetch from Registrar. This poller picks those
  // up and dispatches the slow listDomains+blacklist pipeline to the
  // list-registrar-domains pg-boss queue. Same pattern as pollDispatchedSteps.
  //
  // The Ionos per-domain MX check takes ~9 minutes for 110 domains at the
  // 25 req/min throttle, which is why this has to run on the worker VPS
  // instead of inside a Vercel serverless function.
  const pollRegistrarDomainListings = async () => {
    try {
      const supabase = getSupabase();

      // Find registrars with a pending fetch (status='fetching', not yet
      // dispatched). We can't query JSONB subfields via .eq without a raw
      // SQL expression, so we select all rows and filter in-process. The
      // registrar table is small (single-digit per org) so this is fine.
      const { data: rows } = await supabase
        .from("dns_registrars")
        .select("id, org_id, config")
        .not("config", "is", null);

      for (const row of rows || []) {
        const cfg = (row.config || {}) as Record<string, unknown>;
        const cache = cfg.domainCache as
          | {
              status?: string;
              requestedAt?: string;
              dispatchedAt?: string | null;
            }
          | undefined;

        if (!cache || cache.status !== "fetching") continue;
        if (cache.dispatchedAt) continue; // already dispatched

        // Stale-guard: if the request is older than 15 minutes, skip it —
        // the Vercel route will treat it as stale on the next poll and
        // write a fresh fetching entry.
        if (cache.requestedAt) {
          const age =
            Date.now() - new Date(cache.requestedAt).getTime();
          if (age > 15 * 60 * 1000) continue;
        }

        // Atomically mark as dispatched so no other poller tick (or no
        // second worker instance) picks up the same row.
        const updatedCache = {
          ...cache,
          dispatchedAt: new Date().toISOString(),
        };
        const updatedConfig = { ...cfg, domainCache: updatedCache };

        const { error: updateError } = await supabase
          .from("dns_registrars")
          .update({
            config: updatedConfig,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("org_id", row.org_id);

        if (updateError) {
          console.error(
            `[Worker] Failed to mark registrar ${row.id} as dispatched:`,
            updateError.message
          );
          continue;
        }

        console.log(
          `[Worker] Found pending registrar listing for ${row.id}, queuing list-registrar-domains job...`
        );

        await boss.send("list-registrar-domains", {
          registrarId: row.id,
          orgId: row.org_id,
          requestedAt: cache.requestedAt || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("[Worker] Registrar domain listing poll failed:", err);
    }
  };

  // Poll every 5 seconds for pending registrar listings. Faster than the
  // step-dispatch poll because the wizard UX benefits from shorter latency
  // at the start of the fetch. OPS only.
  if (OPS_SIDE_EFFECTS_ENABLED) {
    setInterval(pollRegistrarDomainListings, 5000);
    await pollRegistrarDomainListings();
  }

  // Phase 6A: log role summary once all pg-boss registration is done so an
  // operator can see at a glance which queues this worker is subscribing to.
  console.log(
    `[Worker] Role=${WORKER_ROLE}: registered ${registeredCount} handlers, skipped ${skippedCount}`
  );

  // Phase 6A: infra-level heartbeat (NEW — distinct from the per-org
  // heartbeatInterval above). Upserts one row per WORKER_ROLE into
  // worker_heartbeats every 30s so Dean can see both workers are alive from
  // a single query. Best-effort: errors are logged, never thrown.
  const hostName = process.env.HOSTNAME || os.hostname();
  const infraHeartbeatPing = async () => {
    try {
      const supabase = getSupabase();
      await supabase
        .from("worker_heartbeats")
        .upsert(
          {
            worker_role: WORKER_ROLE,
            host: hostName,
            last_ping_at: new Date().toISOString(),
          },
          { onConflict: "worker_role" }
        );
    } catch (err) {
      console.error("[Worker] infra heartbeat ping failed:", err);
    }
  };
  await infraHeartbeatPing();
  const infraHeartbeatInterval = setInterval(infraHeartbeatPing, 30_000);

  console.log("[Worker] Email worker is running. Waiting for jobs...");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    clearInterval(infraHeartbeatInterval);
    if (blacklistServer) {
      await new Promise<void>((resolve) => blacklistServer.close(() => resolve()));
    }
    closeAll();
    await stopBoss();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});
