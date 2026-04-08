import { initBoss, stopBoss } from "../lib/email/campaign-queue";
import { handleSendEmail } from "./handlers/send-email";
import { handleProcessSequenceStep } from "./handlers/process-sequence-step";
import { handleCheckNoReply } from "./handlers/check-no-reply";
import { handleSyncAllAccounts, handleClassifyReply, handleClassifyBatch } from "./handlers/sync-inbox";
import { handleProcessBounce } from "./handlers/process-bounce";
import { handleProvisionPair } from "./handlers/provision-pair";
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
    "provision-server-pair",
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

  // Register provision-server-pair handler (B15-3)
  interface ProvisionPairPayload {
    jobId: string;
  }

  await boss.work<ProvisionPairPayload>(
    "provision-server-pair",
    {
      batchSize: 1,
      pollingIntervalSeconds: 5,
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

  // Register rollback-provision handler (B15-3)
  interface RollbackProvisionPayload {
    jobId: string;
  }

  await boss.work<RollbackProvisionPayload>(
    "rollback-provision",
    {
      batchSize: 1,
      pollingIntervalSeconds: 5,
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

  // --- Provisioning job-polling cron (every 15 seconds) ---
  // Bridges Vercel (creates jobs) → worker (executes them)
  // DryRun jobs are excluded — those run via serverless execute-step
  await boss.schedule("poll-provisioning-jobs", "*/1 * * * *");

  const pollProvisioningJobs = async () => {
    try {
      const supabase = getSupabase();
      const { data: pendingJobs } = await supabase
        .from("provisioning_jobs")
        .select("id, config")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);

      for (const pj of pendingJobs || []) {
        const provType = (pj.config as Record<string, unknown>)?.provider_type;
        if (provType === "dry_run") continue; // Skip dry_run — handled serverless

        console.log(`[Worker] Found pending provisioning job ${pj.id}, queuing...`);
        await boss.send("provision-server-pair", { jobId: pj.id });

        // Mark as queued to prevent double-processing
        await supabase
          .from("provisioning_jobs")
          .update({ status: "in_progress" })
          .eq("id", pj.id)
          .eq("status", "pending");
      }
    } catch (err) {
      console.error("[Worker] Provisioning poll failed:", err);
    }
  };

  // Poll every 15 seconds using setInterval (pg-boss cron is 1-min minimum)
  setInterval(pollProvisioningJobs, 15000);
  // Also run immediately on startup
  await pollProvisioningJobs();

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
