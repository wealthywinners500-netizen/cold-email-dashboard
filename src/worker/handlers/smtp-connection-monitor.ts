import { createClient } from "@supabase/supabase-js";
import { testConnection } from "../../lib/email/smtp-manager";

interface EmailAccount {
  id: string;
  org_id: string;
  email: string;
  status: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  consecutive_failures: number;
  last_error: string | null;
  last_error_at: string | null;
}

interface SystemAlert {
  org_id: string;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown>;
  account_id?: string;
  acknowledged?: boolean;
}

const FAILURE_THRESHOLD = 5;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function handleSmtpConnectionMonitor() {
  const supabase = getSupabase();

  try {
    // Fetch all active email accounts
    const { data: accounts, error: fetchError } = await supabase
      .from("email_accounts")
      .select(
        "id, org_id, email, status, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, consecutive_failures, last_error, last_error_at"
      )
      .eq("status", "active");

    if (fetchError) {
      throw new Error(`Failed to fetch email accounts: ${fetchError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log("[smtp-connection-monitor] No active email accounts found");
      return;
    }

    console.log(
      `[smtp-connection-monitor] Testing SMTP connections for ${accounts.length} active accounts`
    );

    const updates: Array<{
      id: string;
      consecutive_failures: number;
      last_error: string | null;
      last_error_at: string | null;
    }> = [];

    const disabledAccounts: Array<{
      id: string;
      org_id: string;
      email: string;
    }> = [];

    const alerts: SystemAlert[] = [];
    let totalFailures = 0;
    let successCount = 0;

    // Test each account's SMTP connection
    for (const account of accounts as EmailAccount[]) {
      try {
        const result = await testConnection(
          account.smtp_host,
          account.smtp_port,
          account.smtp_secure,
          account.smtp_user,
          account.smtp_pass
        );

        if (result.success) {
          // Connection successful: reset failure count
          updates.push({
            id: account.id,
            consecutive_failures: 0,
            last_error: null,
            last_error_at: null,
          });
          successCount++;
        } else {
          // Connection failed: increment failure count
          const newFailureCount = account.consecutive_failures + 1;
          totalFailures++;

          updates.push({
            id: account.id,
            consecutive_failures: newFailureCount,
            last_error: result.error || "Unknown SMTP connection error",
            last_error_at: new Date().toISOString(),
          });

          // Check if threshold reached
          if (newFailureCount >= FAILURE_THRESHOLD) {
            disabledAccounts.push({
              id: account.id,
              org_id: account.org_id,
              email: account.email,
            });

            // Create ERROR alert for auto-disabling
            alerts.push({
              org_id: account.org_id,
              alert_type: "smtp_connection_failure",
              severity: "critical",
              title: "Email account disabled due to SMTP connection failures",
              details: {
                email: account.email,
                consecutiveFailures: newFailureCount,
                threshold: FAILURE_THRESHOLD,
                lastError: result.error || "Unknown error",
                smtpHost: account.smtp_host,
                smtpPort: account.smtp_port,
              },
              account_id: account.id,
            });
          }
        }
      } catch (testError) {
        // Handle unexpected errors during testing
        const errorMessage =
          testError instanceof Error ? testError.message : String(testError);
        const newFailureCount = account.consecutive_failures + 1;
        totalFailures++;

        console.error(
          `[smtp-connection-monitor] Error testing account ${account.id}:`,
          testError
        );

        updates.push({
          id: account.id,
          consecutive_failures: newFailureCount,
          last_error: errorMessage,
          last_error_at: new Date().toISOString(),
        });

        // Check if threshold reached
        if (newFailureCount >= FAILURE_THRESHOLD) {
          disabledAccounts.push({
            id: account.id,
            org_id: account.org_id,
            email: account.email,
          });

          // Create ERROR alert for auto-disabling
          alerts.push({
            org_id: account.org_id,
            alert_type: "smtp_connection_failure",
            severity: "critical",
            title: "Email account disabled due to SMTP connection failures",
            details: {
              email: account.email,
              consecutiveFailures: newFailureCount,
              threshold: FAILURE_THRESHOLD,
              lastError: errorMessage,
              smtpHost: account.smtp_host,
              smtpPort: account.smtp_port,
            },
            account_id: account.id,
          });
        }
      }
    }

    // Batch update connection status
    if (updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from("email_accounts")
          .update({
            consecutive_failures: update.consecutive_failures,
            last_error: update.last_error,
            last_error_at: update.last_error_at,
          })
          .eq("id", update.id);

        if (updateError) {
          console.error(
            `[smtp-connection-monitor] Failed to update account ${update.id}: ${updateError.message}`
          );
        }
      }

      console.log(`[smtp-connection-monitor] Updated ${updates.length} accounts`);
    }

    // Batch disable accounts that exceeded threshold
    if (disabledAccounts.length > 0) {
      for (const account of disabledAccounts) {
        const { error: disableError } = await supabase
          .from("email_accounts")
          .update({
            status: "disabled",
            disable_reason: "smtp_connection_failures",
          })
          .eq("id", account.id);

        if (disableError) {
          console.error(
            `[smtp-connection-monitor] Failed to disable account ${account.id}: ${disableError.message}`
          );
        } else {
          console.log(
            `[smtp-connection-monitor] Auto-disabled account ${account.email} after ${FAILURE_THRESHOLD} failures`
          );
        }
      }
    }

    // Batch insert alerts
    if (alerts.length > 0) {
      const { error: alertError } = await supabase
        .from("system_alerts")
        .insert(alerts);

      if (alertError) {
        console.error(
          `[smtp-connection-monitor] Failed to insert alerts: ${alertError.message}`
        );
      } else {
        console.log(
          `[smtp-connection-monitor] Created ${alerts.length} critical alerts`
        );
      }
    }

    // Log summary
    console.log(
      `[smtp-connection-monitor] Summary: ${successCount} successful, ${totalFailures} failures, ${disabledAccounts.length} accounts auto-disabled`
    );
  } catch (error) {
    console.error("[smtp-connection-monitor] Fatal error:", error);
    throw error;
  }
}
