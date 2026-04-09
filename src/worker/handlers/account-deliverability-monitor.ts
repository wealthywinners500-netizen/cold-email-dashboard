import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface Organization {
  id: string;
}

interface EmailAccount {
  id: string;
  org_id: string;
  email: string;
  status: string;
  stats?: Record<string, unknown>;
}

interface SendLogEntry {
  status: string;
}

interface SystemAlert {
  org_id: string;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown>;
  account_id: string;
}

interface AccountUpdate {
  id: string;
  org_id: string;
  status?: string;
  disable_reason?: string;
  stats: {
    sends_24h: number;
    bounces_24h: number;
    bounce_rate: number;
    last_checked: string;
  };
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function get24HoursAgoISO(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function fetchAllOrganizations(
  supabase: SupabaseClient
): Promise<Organization[]> {
  const { data: orgs, error: orgError } = await supabase
    .from('organizations')
    .select('id');

  if (orgError) {
    throw new Error(`Failed to fetch organizations: ${orgError.message}`);
  }

  return orgs || [];
}

async function fetchActiveAccountsForOrg(
  supabase: SupabaseClient,
  orgId: string
): Promise<EmailAccount[]> {
  const { data: accounts, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, org_id, email, status, stats')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (accountError) {
    throw new Error(
      `Failed to fetch accounts for org ${orgId}: ${accountError.message}`
    );
  }

  return accounts || [];
}

async function fetchSendLogsForAccount(
  supabase: SupabaseClient,
  accountId: string,
  since24hAgo: string
): Promise<SendLogEntry[]> {
  const { data: logs, error: logError } = await supabase
    .from('email_send_log')
    .select('status')
    .eq('account_id', accountId)
    .gte('sent_at', since24hAgo);

  if (logError) {
    throw new Error(
      `Failed to fetch send logs for account ${accountId}: ${logError.message}`
    );
  }

  return logs || [];
}

interface DeliverabilityStats {
  sends_24h: number;
  bounces_24h: number;
  bounce_rate: number;
}

function calculateDeliverabilityStats(logs: SendLogEntry[]): DeliverabilityStats {
  const totalSends = logs.length;
  const bouncedCount = logs.filter((log) => log.status === 'bounced').length;
  const bounceRate = totalSends > 0 ? (bouncedCount / totalSends) * 100 : 0;

  return {
    sends_24h: totalSends,
    bounces_24h: bouncedCount,
    bounce_rate: parseFloat(bounceRate.toFixed(2)),
  };
}

export async function handleAccountDeliverabilityMonitor() {
  const supabase = getSupabase();
  const since24hAgo = get24HoursAgoISO();
  const nowISO = new Date().toISOString();

  try {
    // Fetch all organizations
    const orgs = await fetchAllOrganizations(supabase);
    console.log(
      `[account-deliverability-monitor] Processing ${orgs.length} organizations`
    );

    if (orgs.length === 0) {
      console.log('[account-deliverability-monitor] No organizations found');
      return;
    }

    const updates: AccountUpdate[] = [];
    const alerts: SystemAlert[] = [];
    let totalAccountsProcessed = 0;
    let totalDisabled = 0;

    // Process each organization
    for (const org of orgs) {
      try {
        const accounts = await fetchActiveAccountsForOrg(supabase, org.id);

        // Process each account in the organization
        for (const account of accounts) {
          try {
            const sendLogs = await fetchSendLogsForAccount(
              supabase,
              account.id,
              since24hAgo
            );

            // Skip accounts with no send activity
            if (sendLogs.length === 0) {
              continue;
            }

            const stats = calculateDeliverabilityStats(sendLogs);
            totalAccountsProcessed++;

            const accountUpdate: AccountUpdate = {
              id: account.id,
              org_id: org.id,
              stats: {
                sends_24h: stats.sends_24h,
                bounces_24h: stats.bounces_24h,
                bounce_rate: stats.bounce_rate,
                last_checked: nowISO,
              },
            };

            // Auto-disable account if bounce rate > 10%
            if (stats.bounce_rate > 10) {
              accountUpdate.status = 'disabled';
              accountUpdate.disable_reason = 'high_bounce_rate';
              totalDisabled++;

              alerts.push({
                org_id: org.id,
                alert_type: 'account_auto_disabled',
                severity: 'critical',
                title: 'Email account auto-disabled due to high bounce rate',
                details: {
                  email: account.email,
                  bounce_rate: stats.bounce_rate,
                  sends_24h: stats.sends_24h,
                  bounces_24h: stats.bounces_24h,
                  threshold: 10,
                },
                account_id: account.id,
              });
            }
            // Create warning alert if bounce rate > 7% but <= 10%
            else if (stats.bounce_rate > 7) {
              alerts.push({
                org_id: org.id,
                alert_type: 'account_high_bounce_warning',
                severity: 'warning',
                title: 'Email account approaching bounce rate threshold',
                details: {
                  email: account.email,
                  bounce_rate: stats.bounce_rate,
                  sends_24h: stats.sends_24h,
                  bounces_24h: stats.bounces_24h,
                  threshold: 10,
                },
                account_id: account.id,
              });
            }

            updates.push(accountUpdate);
          } catch (accountError) {
            console.error(
              `[account-deliverability-monitor] Failed to process account ${account.id}:`,
              accountError
            );

            // Create error alert for processing failure
            const { error: alertError } = await supabase
              .from('system_alerts')
              .insert({
                org_id: org.id,
                alert_type: 'account_monitoring_error',
                severity: 'critical',
                title: 'Failed to monitor account deliverability',
                details: {
                  email: account.email,
                  error:
                    accountError instanceof Error
                      ? accountError.message
                      : String(accountError),
                },
                account_id: account.id,
              });

            if (alertError) {
              console.error(
                '[account-deliverability-monitor] Failed to insert error alert:',
                alertError
              );
            }
          }
        }
      } catch (orgError) {
        console.error(
          `[account-deliverability-monitor] Failed to process organization ${org.id}:`,
          orgError
        );

        // Create critical alert for org-level processing failure
        const { error: alertError } = await supabase
          .from('system_alerts')
          .insert({
            org_id: org.id,
            alert_type: 'org_monitoring_error',
            severity: 'critical',
            title: 'Failed to monitor organization deliverability',
            details: {
              error:
                orgError instanceof Error
                  ? orgError.message
                  : String(orgError),
            },
            account_id: '',
          });

        if (alertError) {
          console.error(
            '[account-deliverability-monitor] Failed to insert org error alert:',
            alertError
          );
        }
      }
    }

    // Batch update email accounts
    if (updates.length > 0) {
      for (const update of updates) {
        try {
          const updatePayload: {
            stats: AccountUpdate['stats'];
            status?: string;
            disable_reason?: string;
          } = {
            stats: update.stats,
          };

          if (update.status) {
            updatePayload.status = update.status;
          }

          if (update.disable_reason) {
            updatePayload.disable_reason = update.disable_reason;
          }

          const { error: updateError } = await supabase
            .from('email_accounts')
            .update(updatePayload)
            .eq('id', update.id);

          if (updateError) {
            console.error(
              `[account-deliverability-monitor] Failed to update account ${update.id}: ${updateError.message}`
            );
          }
        } catch (updateError) {
          console.error(
            `[account-deliverability-monitor] Error updating account ${update.id}:`,
            updateError
          );
        }
      }

      console.log(
        `[account-deliverability-monitor] Updated ${updates.length} accounts (${totalDisabled} disabled)`
      );
    }

    // Batch insert alerts
    if (alerts.length > 0) {
      const { error: alertError } = await supabase
        .from('system_alerts')
        .insert(alerts);

      if (alertError) {
        console.error(
          `[account-deliverability-monitor] Failed to insert alerts: ${alertError.message}`
        );
      } else {
        console.log(`[account-deliverability-monitor] Created ${alerts.length} alerts`);
      }
    }

    console.log(
      `[account-deliverability-monitor] Monitor complete: ${totalAccountsProcessed} accounts processed, ${totalDisabled} disabled`
    );
  } catch (error) {
    console.error('[account-deliverability-monitor] Fatal error:', error);
    throw error;
  }
}
