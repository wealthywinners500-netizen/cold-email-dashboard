import { createClient } from '@supabase/supabase-js';
import { getBoss } from '../../lib/email/campaign-queue';

interface SendingSchedule {
  send_between_hours: [number, number];
  allowed_days: string[];
  max_per_day: number;
  timezone: string;
}

interface Campaign {
  id: string;
  org_id: string;
  name: string;
  status: string;
  sending_schedule: SendingSchedule;
}

interface EmailAccount {
  id: string;
  daily_send_limit: number;
  sends_today: number;
}

interface CampaignRecipient {
  id: string;
  campaign_id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  status: string;
  org_id: string;
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function getDayAbbreviation(date: Date): string {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[date.getUTCDay()];
}

function isAllowedDay(schedule: SendingSchedule): boolean {
  const today = new Date();
  const dayAbbr = getDayAbbreviation(today);
  return schedule.allowed_days.includes(dayAbbr);
}

function calculateSendDelays(
  schedule: SendingSchedule,
  recipientCount: number
): number[] {
  const [startHour, endHour] = schedule.send_between_hours;
  const windowMinutes = (endHour - startHour) * 60;
  const delays: number[] = [];

  for (let i = 0; i < recipientCount; i++) {
    const fraction = recipientCount === 1 ? 0.5 : i / (recipientCount - 1);
    const offsetMinutes = fraction * windowMinutes;
    const offsetMs = offsetMinutes * 60 * 1000;
    delays.push(offsetMs);
  }

  return delays;
}

async function getActiveAccountsCapacity(
  supabase: ReturnType<typeof getSupabase>,
  orgId: string,
  campaignId: string
): Promise<{ accounts: EmailAccount[]; totalCapacity: number }> {
  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select('id, daily_send_limit, sends_today')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .gt('daily_send_limit', 0);

  if (error) {
    console.error(`Error fetching email accounts for org ${orgId}:`, error);
    return { accounts: [], totalCapacity: 0 };
  }

  if (!accounts || accounts.length === 0) {
    return { accounts: [], totalCapacity: 0 };
  }

  const accountsWithCapacity = (accounts as EmailAccount[]).filter(
    (acc) => acc.daily_send_limit > (acc.sends_today || 0)
  );

  const totalCapacity = accountsWithCapacity.reduce(
    (sum, acc) => sum + (acc.daily_send_limit - (acc.sends_today || 0)),
    0
  );

  return { accounts: accountsWithCapacity, totalCapacity };
}

async function getPendingRecipients(
  supabase: ReturnType<typeof getSupabase>,
  orgId: string,
  campaignId: string,
  limit: number
): Promise<CampaignRecipient[]> {
  // V1+b: collect the org's unsubscribed emails, then exclude any pending
  // recipient whose email matches. PostgREST has no NOT-IN-subquery, so a
  // small in-process Set is the cleanest filter. Typical unsubscribed sets
  // are small (sub-100s), so memory cost is negligible.
  const { data: unsub } = await supabase
    .from('lead_contacts')
    .select('email')
    .eq('org_id', orgId)
    .not('unsubscribed_at', 'is', null);
  const unsubSet = new Set(
    (unsub || [])
      .map((r: { email: string | null }) => (r.email || '').trim().toLowerCase())
      .filter((e) => e.length > 0)
  );

  // Pad the limit so a heavily-unsubscribed campaign still produces `limit`
  // sendable recipients per tick.
  const fetchLimit = limit + unsubSet.size;
  const { data: recipients, error } = await supabase
    .from('campaign_recipients')
    .select(
      'id, campaign_id, email, first_name, last_name, company_name, status, org_id'
    )
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(fetchLimit);

  if (error) {
    console.error(`Error fetching pending recipients for campaign ${campaignId}:`, error);
    return [];
  }

  const filtered = ((recipients as CampaignRecipient[]) || []).filter(
    (r) => !unsubSet.has((r.email || '').trim().toLowerCase())
  );
  return filtered.slice(0, limit);
}

async function roundRobinAssign(
  recipients: CampaignRecipient[],
  accounts: EmailAccount[]
): Promise<Map<string, string[]>> {
  const assignment = new Map<string, string[]>();

  accounts.forEach((acc) => {
    assignment.set(acc.id, []);
  });

  recipients.forEach((recipient, index) => {
    const accountIndex = index % accounts.length;
    const accountId = accounts[accountIndex].id;
    assignment.get(accountId)!.push(recipient.id);
  });

  return assignment;
}

async function queueSequenceSteps(
  boss: ReturnType<typeof getBoss>,
  supabase: ReturnType<typeof getSupabase>,
  recipientId: string,
  campaignId: string,
  accountId: string,
  schedule: SendingSchedule,
  delayMs: number
): Promise<void> {
  const sendAfterDate = new Date(Date.now() + delayMs);

  await boss.send(
    'process-sequence-step',
    {
      recipientId,
      campaignId,
      accountId,
      step: 0,
    },
    {
      startAfter: sendAfterDate,
      retryLimit: 3,
      retryDelay: 60,
    }
  );
}

export async function handleDistributeCampaignSends(): Promise<void> {
  const supabase = getSupabase();
  const boss = await getBoss();
  let totalDistributed = 0;

  try {
    // Fetch all campaigns with status = 'sending'
    const { data: campaigns, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, org_id, name, status, sending_schedule')
      .eq('status', 'sending');

    if (campaignError) {
      console.error('Error fetching campaigns:', campaignError);
      return;
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('[distribute-campaign-sends] No campaigns in sending status');
      return;
    }

    // Process each campaign
    for (const campaign of campaigns as Campaign[]) {
      const schedule = campaign.sending_schedule as SendingSchedule;

      // Check if today is an allowed day
      if (!isAllowedDay(schedule)) {
        console.log(
          `[distribute-campaign-sends] Campaign ${campaign.id} skipped: today not in allowed_days`
        );
        continue;
      }

      // Get active accounts with available capacity
      const { accounts, totalCapacity } = await getActiveAccountsCapacity(
        supabase,
        campaign.org_id,
        campaign.id
      );

      if (accounts.length === 0 || totalCapacity === 0) {
        console.log(
          `[distribute-campaign-sends] Campaign ${campaign.id} skipped: no available account capacity`
        );
        continue;
      }

      // Calculate how many recipients to process today
      const toDistribute = Math.min(schedule.max_per_day, totalCapacity);

      // Fetch pending recipients (V1+b: org-scoped to filter unsubscribed)
      const pendingRecipients = await getPendingRecipients(
        supabase,
        campaign.org_id,
        campaign.id,
        toDistribute
      );

      if (pendingRecipients.length === 0) {
        console.log(
          `[distribute-campaign-sends] Campaign ${campaign.id} skipped: no pending recipients`
        );
        continue;
      }

      // Round-robin assign recipients to accounts
      const assignment = await roundRobinAssign(pendingRecipients, accounts);

      // Calculate send delays across the sending window
      const delays = calculateSendDelays(schedule, pendingRecipients.length);

      // Queue sequence steps for each recipient
      let recipientIndex = 0;
      for (const [accountId, recipientIds] of assignment.entries()) {
        for (const recipientId of recipientIds) {
          const delay = delays[recipientIndex];
          await queueSequenceSteps(
            boss,
            supabase,
            recipientId,
            campaign.id,
            accountId,
            schedule,
            delay
          );
          recipientIndex++;
        }
      }

      console.log(
        `[distribute-campaign-sends] Campaign ${campaign.id} (${campaign.name}): distributed ${pendingRecipients.length} recipients across ${accounts.length} accounts`
      );
      totalDistributed += pendingRecipients.length;
    }

    console.log(`[distribute-campaign-sends] Total distributed: ${totalDistributed} recipients`);
  } catch (error) {
    console.error('[distribute-campaign-sends] Fatal error:', error);
    throw error;
  }
}
