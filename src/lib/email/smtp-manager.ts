import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

interface TransportKey {
  host: string;
  port: number;
  secure: boolean;
}

interface SmtpAccount {
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}

interface SendResult {
  messageId: string;
  response: string;
}

const transporterCache = new Map<string, Transporter>();

function getCacheKey(host: string, port: number, secure: boolean): string {
  return `${host}:${port}:${secure}`;
}

function getTransporter(host: string, port: number, secure: boolean, user: string, pass: string): Transporter {
  const key = getCacheKey(host, port, secure);
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    tls: {
      rejectUnauthorized: false,
    },
  });

  transporterCache.set(key, transporter);
  return transporter;
}

export async function sendEmail(
  account: SmtpAccount,
  to: string,
  subject: string,
  html: string,
  text?: string,
  trackingId?: string,
  extraHeaders?: Record<string, string>
): Promise<SendResult> {
  const transporter = getTransporter(
    account.smtp_host,
    account.smtp_port,
    account.smtp_secure,
    account.smtp_user,
    account.smtp_pass
  );

  const fromAddress = account.display_name
    ? `"${account.display_name}" <${account.email}>`
    : account.email;

  const headers: Record<string, string> = {};
  if (trackingId) headers["X-Tracking-Id"] = trackingId;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
    text: text || undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });

  return {
    messageId: info.messageId,
    response: info.response,
  };
}

export async function testConnection(
  host: string,
  port: number,
  secure: boolean,
  user: string,
  pass: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.verify();
    transporter.close();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return { success: false, error: message };
  }
}

export function closeAll(): void {
  for (const [key, transporter] of transporterCache.entries()) {
    transporter.close();
    transporterCache.delete(key);
  }
}
