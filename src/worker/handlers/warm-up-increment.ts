import { createClient } from '@supabase/supabase-js';

interface EmailAccount {
  id: string;
  org_id: string;
  email: string;
  status: string;
  daily_send_limit: number;
  created_at: string;
  warm_up_phase: number;
}

interface SystemAlert {
  org_id: string;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown>;
  account_id: string;
}

// Warm-up schedule: days range -> daily send limit
const WARMUP_SCHEDULE: Array<{ days: [number, number]; limit: number }> = [
  { days: [1, 5], limit: 10 },
  { days: [6, 10], limit: 25 },
  { days: [11, 15], limit: 50 },
  { days: [16, 20], limit: 100 },
  { days: [21, 30], limit: 200 },
  { days: [31, Infinity], limit: 300 },
];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function calculateDaysSinceCreated(createdAt: string): number {
  const createdTime = new Date(createdAt).getTime();
  const nowTime = Date.now();
  return Math.floor((nowTime - createdTime) / (1000 * 60 * 60 * 24));
}

function getWarmupPhaseAndLimit(daysSinceCreated: number): {
  phase: number;
  limit: number;
} {
  for (let i = 0; i < WARMUP_SCHEDULE.length; i++) {
    const schedule = WARMUP_SCHEDULE[i];
    if (
      daysSinceCreated >= schedule.days[0] &&
      daysSinceCreated <= schedule.days[1]
    ) {
      return { phase: i + 1, limit: schedule.limit };
    }
  }
  // Fallback (should not reach here if schedule is correct)
  return { phase: 6, limit: 300 };
}

export async function handleWarmupIncrement() {
  const supabase = getSupabase();

  try {
    // Fetch all active email accounts
    const { data: accounts, error: fetchError } = await supabase
      .from('email_accounts')
      .select('id, org_id, email, status, daily_send_limit, created_at, warm_up_phase')
      .eq('status', 'active');

    if (fetchError) {
      throw new Error(`Failed to fetch email accounts: ${fetchError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log('[warm-up-increment] No active email accounts found');
      return;
    }

    console.log(
      `[warm-up-increment] Processing ${accounts.length} active email accounts`
    );

    const updates: Array<{
      id: string;
      org_id: string;
      daily_send_limit: number;
      warm_up_phase: number;
    }> = [];
    const alerts: SystemAlert[] = [];

    // Process each account
    for (const account of accounts as EmailAccount[]) {
      const daysSinceCreated = calculateDaysSinceCreated(account.created_at);
      const { phase, limit } = getWarmupPhaseAndLimit(daysSinceCreated);

      // Never decrease limit mid-day
      if (limit <= account.daily_send_limit) {
        continue;
      }

      updates.push({
        id: account.id,
        org_id: account.org_id,
        daily_send_limit: limit,
        warm_up_phase: phase,
      });

      // Create alert for phase change
      alerts.push({
        org_id: account.org_id,
        alert_type: 'warm_up_phase_change',
        severity: 'info',
        title: 'Warm-up limit increased',
        details: {
          email: account.email,
          daysSinceCreated,
          oldLimit: account.daily_send_limit,
          newLimit: limit,
          phase,
        },
        account_id: account.id,
      });
    }

    // Batch update email accounts
    if (updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('email_accounts')
          .update({
            daily_send_limit: update.daily_send_limit,
            warm_up_phase: update.warm_up_phase,
          })
          .eq('id', update.id);

        if (updateError) {
          console.error(
            `[warm-up-increment] Failed to update account ${update.id}: ${updateError.message}`
          );
        }
      }

      console.log(`[warm-up-increment] Updated ${updates.length} accounts`);
    }

    // Batch insert alerts
    if (alerts.length > 0) {
      const { error: alertError } = await supabase
        .from('system_alerts')
        .insert(alerts);

      if (alertError) {
        console.error(
          `[warm-up-increment] Failed to insert alerts: ${alertError.message}`
        );
      } else {
        console.log(`[warm-up-increment] Created ${alerts.length} alerts`);
      }
    }
  } catch (error) {
    console.error('[warm-up-increment] Fatal error:', error);
    throw error;
  }
}
