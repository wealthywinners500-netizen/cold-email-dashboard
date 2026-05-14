// === ALERT: never-again 2026-05-13 (admin-alert helper) ===
// Minimal nodemailer-backed admin-email sender. Used by the DBL re-sweep
// to fire an email to dean.hofer@thestealthmail.com on any clean→burnt
// transition of `sending_domains.blacklist_status`.
//
// Design choices:
//   - No new dependency. Re-uses the existing `nodemailer ^8.0.4` package
//     already in package.json — same transport used by smtp-manager for
//     campaign sends.
//   - Env-driven credentials (no DB row pick). The alert sender must not
//     consume warm-up reputation of an active campaign account, so it
//     uses a separate dedicated mailbox via:
//       ADMIN_ALERT_FROM_EMAIL      — required
//       ADMIN_ALERT_FROM_PASSWORD   — required
//       ADMIN_ALERT_SMTP_HOST       — required
//       ADMIN_ALERT_SMTP_PORT       — optional (default 587)
//       ADMIN_ALERT_SMTP_SECURE     — optional (default false; STARTTLS)
//   - GRACEFUL NO-OP if any env var missing — logs a warning and returns
//     `{ sent: false, reason: 'missing_env' }`. Allows the PR to merge
//     before Dean configures Vercel/worker env. The system_alerts row is
//     ALWAYS written by the caller (dbl-resweep already does this); only
//     the email side-effect is gated.
//
// Test pin: src/__tests__/dbl-alert.test.ts

import nodemailer from "nodemailer";

export interface AdminAlertInput {
  to: string;
  subject: string;
  body: string;
}

export interface AdminAlertResult {
  sent: boolean;
  reason?: "missing_env" | "send_error";
  error?: string;
  messageId?: string;
}

export type AdminAlertSender = (
  input: AdminAlertInput
) => Promise<AdminAlertResult>;

export async function sendAdminAlert(
  input: AdminAlertInput
): Promise<AdminAlertResult> {
  const fromEmail = process.env.ADMIN_ALERT_FROM_EMAIL;
  const fromPassword = process.env.ADMIN_ALERT_FROM_PASSWORD;
  const smtpHost = process.env.ADMIN_ALERT_SMTP_HOST;
  const smtpPort = parseInt(process.env.ADMIN_ALERT_SMTP_PORT ?? "587", 10);
  const smtpSecure = (process.env.ADMIN_ALERT_SMTP_SECURE ?? "false") === "true";

  if (!fromEmail || !fromPassword || !smtpHost) {
    console.warn(
      `[admin-alert] missing env (FROM_EMAIL=${fromEmail ? "set" : "MISSING"} FROM_PASSWORD=${fromPassword ? "set" : "MISSING"} SMTP_HOST=${smtpHost ? "set" : "MISSING"}) — skipping email for: ${input.subject}`
    );
    return { sent: false, reason: "missing_env" };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: fromEmail, pass: fromPassword },
    connectionTimeout: 15000,
    socketTimeout: 15000,
  });
  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin-alert] send failed: ${msg}`);
    return { sent: false, reason: "send_error", error: msg };
  } finally {
    transporter.close();
  }
}
// === /ALERT ===
