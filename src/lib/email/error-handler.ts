// B12: Centralized Error Handler
// IMPORTANT: No module-scope client init — Hard Lesson #34
// All Supabase calls use lazy-init pattern

import { createClient, SupabaseClient } from '@supabase/supabase-js';

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function createAlert(
  orgId: string,
  alertType: string,
  severity: 'info' | 'warning' | 'critical',
  title: string,
  details: Record<string, any> = {},
  accountId?: string
): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('system_alerts').insert({
    org_id: orgId,
    alert_type: alertType,
    severity,
    title,
    details,
    account_id: accountId || null,
  });
}

/**
 * Handle SMTP errors with classification and auto-disable logic.
 * Call on failure with the error, or on success with error=null to reset failures.
 */
export async function handleSmtpError(
  error: Error | null,
  accountId: string,
  orgId: string
): Promise<void> {
  const supabase = getSupabase();

  // Success path: reset consecutive_failures
  if (!error) {
    await supabase
      .from('email_accounts')
      .update({ consecutive_failures: 0 })
      .eq('id', accountId);
    return;
  }

  const message = error.message || '';
  const code = extractSmtpCode(message);

  // Increment consecutive_failures
  const { data: account } = await supabase
    .from('email_accounts')
    .select('consecutive_failures, email')
    .eq('id', accountId)
    .single();

  const failures = (account?.consecutive_failures ?? 0) + 1;
  const email = account?.email || accountId;

  const updateData: Record<string, any> = {
    consecutive_failures: failures,
    last_error: message.substring(0, 500),
    last_error_at: new Date().toISOString(),
  };

  // Classify by SMTP error code
  if (code === 535) {
    // Auth failure
    if (failures >= 3) {
      updateData.status = 'disabled';
      await createAlert(orgId, 'smtp_auth_failure', 'critical',
        `SMTP auth failed 3x — ${email} auto-disabled`,
        { error: message, failures, account_email: email },
        accountId
      );
    } else {
      await createAlert(orgId, 'smtp_auth_failure', 'warning',
        `SMTP auth failure on ${email} (${failures}/3)`,
        { error: message, failures },
        accountId
      );
    }
  } else if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
    // Connection error — pg-boss will retry
    await createAlert(orgId, 'smtp_auth_failure', 'warning',
      `SMTP connection failed for ${email} — will retry`,
      { error: message },
      accountId
    );
  } else if (code === 421 || code === 450) {
    // Rate limited — exponential backoff via pg-boss retry
    await createAlert(orgId, 'smtp_auth_failure', 'info',
      `Rate limited on ${email} — backing off`,
      { error: message, smtp_code: code },
      accountId
    );
  } else if (code === 452) {
    // Quota exceeded — pause until tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    updateData.paused_until = tomorrow.toISOString();
    await createAlert(orgId, 'smtp_auth_failure', 'warning',
      `Quota exceeded for ${email} — paused until midnight`,
      { error: message, paused_until: tomorrow.toISOString() },
      accountId
    );
  } else {
    // Generic SMTP error
    if (failures >= 3) {
      updateData.status = 'disabled';
      await createAlert(orgId, 'smtp_auth_failure', 'critical',
        `${email} auto-disabled after ${failures} consecutive failures`,
        { error: message, failures },
        accountId
      );
    }
  }

  await supabase
    .from('email_accounts')
    .update(updateData)
    .eq('id', accountId);
}

/**
 * Optional imapflow error context. Verified field names against
 * node_modules/imapflow/lib/imap-flow.js NO/BAD throw site (CC #5b1.5).
 *
 * imapflow throws `new Error('Command failed')` on NO/BAD server responses
 * and decorates the error with `responseStatus` ('NO'|'BAD'), `responseText`,
 * `executedCommand` (full IMAP command string), and `code` (e.g. 'ETHROTTLE').
 * Pre-CC#5b1.5 alerts captured only `error.message` — losing every diagnostic
 * field. Caller in imap-sync.ts wraps these into the new context arg so
 * future "Command failed" cascades surface real root-cause data.
 */
export interface ImapErrorContext {
  responseStatus?: string;
  responseText?: string;
  executedCommand?: string;
  code?: string | number;
  cause?: string;
}

/**
 * Sidecar-routed accounts (CC #5a v2) write outbound via Exim local-pipe;
 * the worker IP can't SMTP-AUTH to those panels. Imap-sync still polls them
 * (Unibox needs inbox reads), but if imapflow returns an opaque "Command
 * failed" mid-poll we should NOT cascade-disable — the canonical liveness
 * path is sidecar-health-monitor (CC #5b1) hitting /admin/health, not
 * imap-sync command success. Mirrors getSidecarAccountIds() in
 * smtp-connection-monitor.ts (CC #5b1).
 */
function getSidecarAccountIds(): Set<string> {
  const raw = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Handle IMAP errors with classification and auto-disable logic.
 * @param context optional imapflow fields captured by caller for diagnostics.
 */
export async function handleImapError(
  error: Error,
  accountId: string,
  orgId: string,
  context?: ImapErrorContext
): Promise<void> {
  const supabase = getSupabase();
  const message = error.message || '';
  const sidecarIds = getSidecarAccountIds();
  const isSidecarAccount = sidecarIds.has(accountId);

  // Get current failure count
  const { data: account } = await supabase
    .from('email_accounts')
    .select('consecutive_failures, email')
    .eq('id', accountId)
    .single();

  const failures = (account?.consecutive_failures ?? 0) + 1;
  const email = account?.email || accountId;

  const updateData: Record<string, any> = {
    consecutive_failures: failures,
    last_error: message.substring(0, 500),
    last_error_at: new Date().toISOString(),
  };

  if (message.includes('AUTHENTICATIONFAILED') || message.includes('Invalid credentials') || message.includes('LOGIN failed')) {
    // Auth failure — cascade for ALL accounts including sidecar (real creds problem;
    // sidecar can't help with wrong credentials, would block sending too).
    if (failures >= 3) {
      updateData.status = 'disabled';
      await createAlert(orgId, 'imap_error', 'critical',
        `IMAP auth failed 3x — ${email} auto-disabled`,
        { error: message, failures, ...(context || {}) },
        accountId
      );
    } else {
      await createAlert(orgId, 'imap_error', 'warning',
        `IMAP auth failure on ${email} (${failures}/3)`,
        { error: message, failures, ...(context || {}) },
        accountId
      );
    }
  } else if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT') || message.includes('Connection lost')) {
    // Connection lost — will retry on next cron cycle (no cascade for anyone, existing behavior)
    await createAlert(orgId, 'imap_error', 'warning',
      `IMAP connection lost for ${email} — will retry next sync`,
      { error: message, ...(context || {}) },
      accountId
    );
  } else if (message.includes('Mailbox not found') || message.includes('NO [NONEXISTENT]')) {
    // Mailbox not found — critical alert for ALL accounts (real mailbox problem; sidecar can't help)
    await createAlert(orgId, 'imap_error', 'critical',
      `Mailbox not found for ${email}`,
      { error: message, ...(context || {}) },
      accountId
    );
  } else {
    // Generic IMAP error (imapflow's "Command failed" + others)
    if (failures >= 3) {
      if (isSidecarAccount) {
        // Sidecar-routed account: don't cascade-disable on opaque generic errors.
        // sidecar-health-monitor (CC #5b1) owns liveness for these accounts via
        // /admin/health probes. Alert for visibility but keep status='active'.
        // CC #5b1.5 — closes the second cascade-disable path CC #5b1 missed.
        await createAlert(orgId, 'imap_error', 'warning',
          `Sidecar-routed account ${email} hit ${failures} generic IMAP failures (cascade-disable suppressed)`,
          {
            error: message,
            failures,
            sidecar_protected: true,
            ...(context || {}),
          },
          accountId
        );
      } else {
        updateData.status = 'disabled';
        await createAlert(orgId, 'imap_error', 'critical',
          `${email} auto-disabled after ${failures} IMAP failures`,
          {
            error: message,
            failures,
            ...(context || {}),
          },
          accountId
        );
      }
    }
  }

  await supabase
    .from('email_accounts')
    .update(updateData)
    .eq('id', accountId);
}

/**
 * Handle worker-level errors. Creates alert and increments error counter.
 * Re-throws the error for pg-boss retry handling.
 */
export async function handleWorkerError(
  error: Error,
  jobName: string,
  jobData: any,
  orgId?: string
): Promise<void> {
  const supabase = getSupabase();
  const message = error.message || 'Unknown error';
  const resolvedOrgId = orgId || jobData?.orgId;

  if (resolvedOrgId) {
    await createAlert(resolvedOrgId, 'queue_backup', 'warning',
      `Worker job "${jobName}" failed`,
      { error: message, job_data: jobData, job_name: jobName }
    );

    // Increment worker_errors_today
    const { data: org } = await supabase
      .from('organizations')
      .select('worker_errors_today')
      .eq('id', resolvedOrgId)
      .single();

    await supabase
      .from('organizations')
      .update({ worker_errors_today: (org?.worker_errors_today ?? 0) + 1 })
      .eq('id', resolvedOrgId);
  } else {
    // No org context — log to all orgs? Just console for now
    console.error(`[ErrorHandler] Worker error without org context: ${jobName}`, message);
  }
}

/**
 * Reset daily worker counters. Called by reset-daily-counts cron.
 */
export async function resetDailyCounters(orgId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('organizations')
    .update({ worker_jobs_today: 0, worker_errors_today: 0 })
    .eq('id', orgId);
}

/**
 * Update worker heartbeat timestamp and increment jobs counter.
 */
export async function updateWorkerHeartbeat(orgId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: org } = await supabase
    .from('organizations')
    .select('worker_jobs_today')
    .eq('id', orgId)
    .single();

  await supabase
    .from('organizations')
    .update({
      worker_last_heartbeat: new Date().toISOString(),
      worker_jobs_today: (org?.worker_jobs_today ?? 0) + 1,
    })
    .eq('id', orgId);
}

// Helper to extract SMTP numeric code from error message
function extractSmtpCode(message: string): number | null {
  const match = message.match(/\b(\d{3})\b/);
  return match ? parseInt(match[1], 10) : null;
}
