import { PgBoss } from "pg-boss";

let bossInstance: PgBoss | null = null;

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
  let queued = 0;

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

export async function stopBoss(): Promise<void> {
  if (bossInstance) {
    await bossInstance.stop();
    bossInstance = null;
  }
}
