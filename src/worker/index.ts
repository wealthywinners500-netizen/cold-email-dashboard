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
import { closeAll } from "../lib/email/smtp-manager";
import { createClient } from "@supabase/supabase-js";
import { handleWorkerError, updateWorkerHeartbeat, resetDailyCounters } from "../lib/email/error-handler";

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
  ];
  for (const name of queueNames) {
    await boss.createQueue(name);
  }
  console.log("[Worker] All queues created");

  // --- Heartbeat: pulse every 60 seconds for all orgs ---
  const heartbeatInterval = setInterval(async () => {
    try {
      const supabase = getSupabase();
      const { data: orgs } = await supabase.from("organizations").select("id");
      for (const org of orgs || []) {
        await updateWorkerHeartbeat(org.id);
      }
    } catch (err) {
      console.error("[Worker] Heartbeat failed:", err);
    }
  }, 60000);

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

  await boss.work<SendEmailPayload>(
    "send-email",
    withErrorHandling(handleSendEmail, "send-email")
  );

  // Register process-sequence-step handler
  interface ProcessSequenceStepPayload {
    stateId: string;
    recipientId: string;
    sequenceId: string;
    stepNumber: number;
    campaignId: string;
    orgId: string;
  }

  await boss.work<ProcessSequenceStepPayload>(
    "process-sequence-step",
    withErrorHandling(handleProcessSequenceStep, "process-sequence-step")
  );

  // Register sync-all-accounts cron (every 5 minutes)
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

  // Register classify-batch cron (every hour)
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

  // Register daily cron to reset sends_today + worker counters
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

  // Register check-no-reply cron (every hour)
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

  // Register classify-reply handler (called directly from sync)
  interface ClassifyReplyPayload {
    messageId: number;
  }

  await boss.work<ClassifyReplyPayload>(
    "classify-reply",
    withErrorHandling(handleClassifyReply, "classify-reply")
  );

  // Register process-bounce handler (B10)
  interface ProcessBouncePayload {
    messageId: number;
    bodyText: string;
    fromEmail: string;
    orgId: string;
  }

  await boss.work<ProcessBouncePayload>(
    "process-bounce",
    withErrorHandling(handleProcessBounce, "process-bounce")
  );

  // Register queue-sequence-steps cron (every 5 minutes)
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

  // Register warm-up-increment-cron (daily at 1 AM)
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

  // Register smtp-connection-monitor cron (every 15 minutes)
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

  // Register account-deliverability-monitor cron (daily at 3 AM)
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

  // Register campaign-performance-monitor cron (daily at 4 AM)
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

  // Register distribute-campaign-sends cron (daily at 6 AM)
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

  // Register verify-new-leads handler
  interface VerifyNewLeadsPayload {
    orgId: string;
  }

  await boss.work<VerifyNewLeadsPayload>(
    "verify-new-leads",
    withErrorHandling(handleVerifyNewLeads, "verify-new-leads")
  );

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

  if (enableLegacyMonolithic) {
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
    console.log("[Worker] Legacy provision-server-pair handler DISABLED (ENABLE_LEGACY_MONOLITHIC_PROVISIONING not set). Using canonical execute-step → provision-step bridge.");
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

  // Register rollback-provision handler (B15-3, B16-hands-free)
  interface RollbackProvisionPayload {
    jobId: string;
  }

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

  // Register server-health-check cron (every 6 hours)
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

  // Register server-health-check handler
  interface HealthCheckPayload {
    serverPairId: string;
  }

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

  // Poll every 10 seconds for dispatched steps
  setInterval(pollDispatchedSteps, 10000);
  await pollDispatchedSteps();

  console.log("[Worker] Email worker is running. Waiting for jobs...");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down...`);
    clearInterval(heartbeatInterval);
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
