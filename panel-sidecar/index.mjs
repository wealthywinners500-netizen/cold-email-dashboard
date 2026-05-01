#!/usr/bin/env node
// dashboard-panel-sidecar — accepts HMAC-authenticated POST with raw RFC 5322,
// pipes to local Exim. Listens 127.0.0.1 only; nginx reverse-proxies the
// public :443 endpoint to us. Single-purpose service, no deps.
//
// Required env (read from systemd EnvironmentFile):
//   PORT                 default 8825
//   HMAC_SECRET          required, 32-byte hex string
//   WORKER_IP_ALLOWLIST  required, comma-separated IPs
//
// Routes:
//   POST /admin/send      — HMAC + IP gated, body=raw RFC 5322 → exim queue
//   GET  /admin/health    — unauthenticated liveness
//
// Auth scheme:
//   X-Sidecar-Timestamp:  unix-seconds (string)
//   X-Sidecar-Signature:  hex(HMAC-SHA256(HMAC_SECRET, "<ts>.<body-bytes>"))
//   Reject if |now - ts| > 300s.
//
// IP allowlist:
//   Trust X-Forwarded-For (single value) since nginx is the only public path
//   and sets it explicitly. Falls back to req.socket.remoteAddress.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const VERSION = '1.0.0';
const STARTED_AT = Date.now();

const PORT = parseInt(process.env.PORT || '8825', 10);
const HMAC_SECRET = process.env.HMAC_SECRET;
const ALLOWLIST = (process.env.WORKER_IP_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!HMAC_SECRET || HMAC_SECRET.length < 32) {
  console.error('FATAL: HMAC_SECRET missing or too short (need ≥32 chars)');
  process.exit(2);
}
if (ALLOWLIST.length === 0) {
  console.error('FATAL: WORKER_IP_ALLOWLIST empty');
  process.exit(2);
}

const TS_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  const addr = req.socket.remoteAddress || '';
  return addr.replace(/^::ffff:/, '');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyHmac(ts, sig, body) {
  if (!ts || !sig) return false;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > TS_SKEW_SECONDS) return false;
  const expected = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(`${ts}.`)
    .update(body)
    .digest('hex');
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function parseMessageId(rawBody) {
  // RFC 5322 Message-ID header. Match in first 8 KB only.
  const head = rawBody.slice(0, 8192).toString('utf8');
  const m = head.match(/^Message-ID:\s*(<[^>\r\n]+>)/im);
  return m ? m[1] : null;
}

function parseFromAddress(rawBody) {
  // Extract bare email from `From:` header: `Name <a@b>` or `a@b`.
  // Without this, Exim sets envelope sender to the calling user's identity
  // (root@hostname) and SPF alignment at the receiving MX fails.
  const head = rawBody.slice(0, 8192).toString('utf8');
  const m = head.match(/^From:\s*(?:.*?<([^>\r\n]+)>|([^\r\n<]+))/im);
  if (!m) return null;
  const addr = (m[1] || m[2] || '').trim();
  if (/^[^\s<>"@]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(addr)) return addr;
  return null;
}

function eximSubmit(rawBody, envelopeFrom) {
  const args = ['-bm', '-i', '-t'];
  if (envelopeFrom) args.unshift('-f', envelopeFrom);
  return new Promise((resolve) => {
    const child = spawn('/usr/sbin/exim', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => {
      resolve({ ok: false, exit_code: -1, stdout, stderr: `spawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, exit_code: code, stdout, stderr });
    });
    child.stdin.write(rawBody);
    child.stdin.end();
  });
}

function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const ip = getClientIp(req);

  if (req.method === 'GET' && url === '/admin/health') {
    jsonResponse(res, 200, {
      status: 'ok',
      version: VERSION,
      uptime_ms: Date.now() - STARTED_AT,
    });
    return;
  }

  if (req.method !== 'POST' || url !== '/admin/send') {
    jsonResponse(res, 404, { error: 'not found' });
    return;
  }

  if (!ALLOWLIST.includes(ip)) {
    console.warn(`[sidecar] reject ip=${ip} (not in allowlist)`);
    jsonResponse(res, 403, { error: 'forbidden' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 413, { error: String(err && err.message) || 'body error' });
    return;
  }

  const ts = req.headers['x-sidecar-timestamp'];
  const sig = req.headers['x-sidecar-signature'];
  if (!verifyHmac(ts, sig, body)) {
    console.warn(`[sidecar] reject ip=${ip} (bad hmac/ts)`);
    jsonResponse(res, 401, { error: 'unauthorized' });
    return;
  }

  const messageId = parseMessageId(body);
  const envelopeFrom = parseFromAddress(body);
  const result = await eximSubmit(body, envelopeFrom);
  if (!result.ok) {
    console.error(`[sidecar] exim failed ip=${ip} mid=${messageId} envelope=${envelopeFrom} exit=${result.exit_code} stderr=${result.stderr.slice(0, 500)}`);
    jsonResponse(res, 502, {
      success: false,
      error: 'exim submission failed',
      exit_code: result.exit_code,
      stderr: result.stderr.slice(0, 500),
    });
    return;
  }

  console.log(`[sidecar] queued ip=${ip} envelope=${envelopeFrom} mid=${messageId} bytes=${body.length}`);
  jsonResponse(res, 200, {
    success: true,
    message_id: messageId,
    bytes: body.length,
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sidecar] listening 127.0.0.1:${PORT} v${VERSION} allowlist=${ALLOWLIST.join(',')}`);
});

const shutdown = (sig) => {
  console.log(`[sidecar] received ${sig}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
