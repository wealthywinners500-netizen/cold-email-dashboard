import { PgBoss } from "pg-boss";
import { createClient } from "@supabase/supabase-js";
import { initializeSequence } from "./sequence-engine";

let bossInstance: PgBoss | null = null;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export function getBoss(): PgBoss {
  if (!bossInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required for pg-boss");
    }
    bossInstance = new PgBoss(connectionString);
  }
  return bossInstance;
}

export async function initBoss(): Promise<PgBoss> {
  const boss = getBoss();
  await boss.start();
  return boss;
}

interface SendEmailJobPayload {
  recipientId: string;
  accountId: string;
  campaignId: string;
  orgId: string;
}

export async function queueCampaign(
  campaignId: string,
  orgId: string,
  recipients: Array<{ id: string; assigned_account_id: string }>,
  schedule: {
    send_between_hours: [number, number];
    timezone: string;
    days: string[];
    max_per_day: number;
    per_account_per_hour: number;
  }
): Promise<number> {
  const boss = getBoss();
  const supabase = getSupabase();
  let queued = 0;

  // Check if campaign has a primary sequence
  const { data: primarySequence, error: sequenceErr } = await supabase
    .from("campaign_sequences")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("sequence_type", "primary")
    .maybeSingle();

  if (sequenceErr && sequenceErr.code !== "PGRST116") {
    // PGRST116 = no rows found, which is fine
    throw sequenceErr;
  }

  // If primary sequence exists, initialize sequence workflow instead
  if (primarySequence) {
    console.log(
      `[QueueCampaign] Campaign ${campaignId} has primary sequence, initializing sequence workflow`
    );
    await initializeSequence(campaignId, orgId);
    return recipients.length;
  }

  // Fall through to existing single-shot logic
  const [startHour, endHour] = schedule.send_between_hours;
  const sendWindowHours = endHour - startHour;
  const totalMinutes = sendWindowHours * 60;
  const delayBetween = Math.max(1, Math.floor((totalMinutes * 60) / recipients.length));

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const delaySeconds = i * delayBetween;

    const payload: SendEmailJobPayload = {
      recipientId: recipient.id,
      accountId: recipient.assigned_account_id,
      campaignId,
      orgId,
    };

    await boss.send("send-email", payload, {
      startAfter: delaySeconds,
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    });

    queued++;
  }

  return queued;
}

export async function pauseCampaign(campaignId: string): Promise<number> {
  const boss = getBoss();
  // pg-boss doesn't have a native "cancel by metadata" so we use SQL
  // For now, we'll mark the campaign as paused in the DB and the handler will skip paused campaigns
  return 0;
}

interface SequenceStepJobPayload {
  stateId: string;
  recipientId: string;
  sequenceId: string;
  stepNumber: number;
  campaignId: string;
  orgId: string;
}

export async function queueSequenceStep(
  stateId: string,
  recipientId: string,
  sequenceId: string,
  stepNumber: number,
  campaignId: string,
  orgId: string,
  sendAt: Date
): Promise<void> {
  const boss = getBoss();

  const payload: SequenceStepJobPayload = {
    stateId,
    recipientId,
    sequenceId,
    stepNumber,
    campaignId,
    orgId,
  };

  // Calculate startAfter as milliseconds from now
  const now = new Date();
  const delayMs = Math.max(0, sendAt.getTime() - now.getTime());
  const delaySeconds = Math.ceil(delayMs / 1000);

  await boss.send("process-sequence-step", payload, {
    startAfter: delaySeconds,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  });
}

export async function stopBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop();
    bossInstance = null;
  }
}
