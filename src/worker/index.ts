import { initBoss, stopBoss } from "../lib/email/campaign-queue";
import { handleSendEmail } from "./handlers/send-email";
import { handleProcessSequenceStep } from "./handlers/process-sequence-step";
import { handleCheckNoReply } from "./handlers/check-no-reply";
import { handleSyncAllAccounts, handleClassifyReply, handleClassifyBatch } from "./handlers/sync-inbox";
import { closeAll } from "../lib/email/smtp-manager";
import { createClient } from "@supabase/supabase-js";

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

  // Register send-email handler
  interface SendEmailPayload {
    recipientId: string;
    accountId: string;
    campaignId: string;
    orgId: string;
  }

  await boss.work<SendEmailPayload>("send-email", async (jobs) => {
    for (const job of jobs) {
      console.log(`[Worker] Processing job ${job.id} for recipient ${job.data.recipientId}`);
      try {
        await handleSendEmail(job.data);
        console.log(`[Worker] Job ${job.id} completed successfully`);
      } catch (err) {
        console.error(`[Worker] Job ${job.id} failed:`, err);
        throw err;
      }
    }
  });

  // Register process-sequence-step handler
  interface ProcessSequenceStepPayload {
    stateId: string;
    recipientId: string;
    sequenceId: string;
    stepNumber: number;
    campaignId: string;
    orgId: string;
  }

  await boss.work<ProcessSequenceStepPayload>("process-sequence-step", async (jobs) => {
    for (const job of jobs) {
      console.log(
        `[Worker] Processing sequence job ${job.id} for state ${job.data.stateId}`
      );
      try {
        await handleProcessSequenceStep(job.data);
        console.log(`[Worker] Sequence job ${job.id} completed successfully`);
      } catch (err) {
        console.error(`[Worker] Sequence job ${job.id} failed:`, err);
        throw err;
      }
    }
  });

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

  // Register daily cron to reset sends_today
  await boss.schedule("reset-daily-counts", "0 0 * * *");
  await boss.work("reset-daily-counts", async () => {
    console.log("[Worker] Resetting daily send counts...");
    const supabase = getSupabase();
    const { error } = await supabase
      .from("email_accounts")
      .update({ sends_today: 0 })
      .neq("sends_today", 0);

    if (error) {
      console.error("[Worker] Failed to reset daily counts:", error);
      throw error;
    }
    console.log("[Worker] Daily send counts reset successfully");
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

  await boss.work<ClassifyReplyPayload>("classify-reply", async (jobs) => {
    for (const job of jobs) {
      console.log(`[Worker] Classifying message ${job.data.messageId}`);
      try {
        await handleClassifyReply(job.data);
        console.log(`[Worker] Classify job ${job.id} completed successfully`);
      } catch (err) {
        console.error(`[Worker] Classify job ${job.id} failed:`, err);
        throw err;
      }
    }
  });

  console.log("[Worker] Email worker is running. Waiting for jobs...");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Worker] Received ${signal}, shutting down...`);
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
