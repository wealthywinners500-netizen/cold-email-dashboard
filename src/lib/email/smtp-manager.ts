import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import crypto from "crypto";

interface SmtpAccount {
  id?: string;
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
const panelHostnameCache = new Map<string, string | null>();

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

export function shouldUseSidecar(accountId: string | undefined): boolean {
  if (!accountId) return false;
  const env = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || "";
  if (!env) return false;
  const ids = env.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(accountId);
}

async function resolvePanelHostname(smtpHost: string): Promise<string | null> {
  if (panelHostnameCache.has(smtpHost)) {
    return panelHostnameCache.get(smtpHost) ?? null;
  }
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    panelHostnameCache.set(smtpHost, null);
    return null;
  }
  const url =
    `${supaUrl}/rest/v1/server_pairs` +
    `?or=(s1_ip.eq.${encodeURIComponent(smtpHost)},s1_hostname.eq.${encodeURIComponent(smtpHost)},s2_ip.eq.${encodeURIComponent(smtpHost)},s2_hostname.eq.${encodeURIComponent(smtpHost)})` +
    `&select=s1_ip,s1_hostname,s2_ip,s2_hostname&limit=1`;
  try {
    const r = await fetch(url, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    if (!r.ok) {
      panelHostnameCache.set(smtpHost, null);
      return null;
    }
    const rows = (await r.json()) as Array<{
      s1_ip: string | null;
      s1_hostname: string | null;
      s2_ip: string | null;
      s2_hostname: string | null;
    }>;
    if (!rows.length) {
      panelHostnameCache.set(smtpHost, null);
      return null;
    }
    const row = rows[0];
    const hostname =
      row.s1_ip === smtpHost || row.s1_hostname === smtpHost
        ? row.s1_hostname
        : row.s2_hostname;
    panelHostnameCache.set(smtpHost, hostname ?? null);
    return hostname ?? null;
  } catch {
    panelHostnameCache.set(smtpHost, null);
    return null;
  }
}

function composeRaw(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    headers: opts.headers,
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

function parseMessageIdFromRaw(raw: Buffer): string {
  const head = raw.slice(0, 8192).toString("utf8");
  const m = head.match(/^Message-ID:\s*(<[^>\r\n]+>)/im);
  return m ? m[1] : "";
}

async function sidecarSend(
  account: SmtpAccount,
  raw: Buffer
): Promise<SendResult> {
  const panelHostname = await resolvePanelHostname(account.smtp_host);
  if (!panelHostname) {
    throw new Error(
      `sidecar: cannot resolve panel hostname for smtp_host=${account.smtp_host} (account=${account.email})`
    );
  }
  const secret = process.env.SIDECAR_HMAC_SECRET;
  if (!secret) {
    throw new Error("sidecar: SIDECAR_HMAC_SECRET not set");
  }
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.`)
    .update(raw)
    .digest("hex");
  const url = `https://${panelHostname}/admin/send`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "message/rfc822",
      "X-Sidecar-Timestamp": ts,
      "X-Sidecar-Signature": sig,
    },
    body: new Uint8Array(raw),
  });
  const bodyText = await r.text();
  if (!r.ok) {
    throw new Error(
      `sidecar: panel ${panelHostname} returned HTTP ${r.status}: ${bodyText.slice(0, 300)}`
    );
  }
  let parsed: { success?: boolean; message_id?: string; bytes?: number; error?: string };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`sidecar: non-JSON response from ${panelHostname}: ${bodyText.slice(0, 200)}`);
  }
  if (!parsed.success) {
    throw new Error(`sidecar: ${parsed.error || "unknown error"}`);
  }
  const messageId = parsed.message_id || parseMessageIdFromRaw(raw);
  return {
    messageId,
    response: `250 OK queued via sidecar ${panelHostname} (${parsed.bytes || raw.length} bytes)`,
  };
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
  const fromAddress = account.display_name
    ? `"${account.display_name}" <${account.email}>`
    : account.email;

  const headers: Record<string, string> = {};
  if (trackingId) headers["X-Tracking-Id"] = trackingId;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  if (shouldUseSidecar(account.id)) {
    const raw = await composeRaw({
      from: fromAddress,
      to,
      subject,
      html,
      text,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
    return sidecarSend(account, raw);
  }

  const transporter = getTransporter(
    account.smtp_host,
    account.smtp_port,
    account.smtp_secure,
    account.smtp_user,
    account.smtp_pass
  );

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

export function _resetSidecarCachesForTest(): void {
  panelHostnameCache.clear();
}
