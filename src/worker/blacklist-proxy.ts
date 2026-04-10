// ============================================
// Worker VPS blacklist-check proxy.
//
// Hard lesson #47 (2026-04-10): Spamhaus actively blocks DNSBL queries from
// cloud provider IP ranges (AWS / GCP / Azure / Vercel). The legacy public
// mirror `dbl.spamhaus.org` returns 127.255.255.254 (anonymous public
// resolver — DENIED) for EVERY query from Vercel, regardless of whether the
// domain is actually listed.
//
// Our worker VPS lives on a non-cloud IP and can still query the legacy
// public mirrors. This proxy exposes that capability over an HMAC-authed
// HTTP endpoint so the Vercel app can fall back to it whenever the primary
// Spamhaus DQS check returns `unknown`.
//
// Endpoint:
//   POST /internal/blacklist-check
//   Headers: X-Worker-Secret: <WORKER_CALLBACK_SECRET>
//   Body:    { domain: string }
//   Returns: { domain, status, lists, raw, method }
//            where status ∈ 'clean' | 'listed' | 'unknown'
//            and method = 'legacy-public'
// ============================================

import http from 'http';
import dns from 'dns/promises';

type BlacklistStatus = 'clean' | 'listed' | 'unknown';

interface BlacklistResult {
  domain: string;
  status: BlacklistStatus;
  lists: string[];
  raw: Record<string, string[]>;
  method: 'legacy-public' | 'unavailable';
}

// Spamhaus DBL "listed" return codes (legitimate listing signals).
// Any A-record value in 127.0.1.0/24 is a legitimate DBL hit.
const DBL_LISTED_CODES = new Set([
  '127.0.1.2',   // spam domain
  '127.0.1.4',   // phish domain
  '127.0.1.5',   // malware domain
  '127.0.1.6',   // botnet C&C domain
  '127.0.1.102', // abused legit spam
  '127.0.1.103', // abused legit redirector
  '127.0.1.104', // abused legit phish
  '127.0.1.105', // abused legit malware
  '127.0.1.106', // abused legit botnet
]);

// Spamhaus "denied / error" return codes (resolver-blocked or quota).
// These MUST NOT be counted as hits — they mean we couldn't get a real answer.
const DENIED_CODES = new Set([
  '127.255.255.252', // typo in DNSBL zone name
  '127.255.255.254', // anonymous public resolver denied (cloud IP)
  '127.255.255.255', // rate-limit exceeded
]);

// Public mirrors the worker queries on the Vercel app's behalf.
// Order matters — Spamhaus DBL is the most useful signal for sending
// domain reputation. SURBL/URIBL provide secondary corroboration.
const LEGACY_ZONES = ['dbl.spamhaus.org', 'multi.surbl.org', 'multi.uribl.com'];

// ============================================
// Low-level DNS helper
// ============================================

async function resolveOrNxdomain(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw err;
  }
}

function classifyDblAddresses(
  addresses: string[]
): { status: BlacklistStatus; sawDenied: boolean } {
  if (addresses.length === 0) return { status: 'clean', sawDenied: false };

  let sawListed = false;
  let sawDenied = false;

  for (const addr of addresses) {
    if (DENIED_CODES.has(addr)) {
      sawDenied = true;
      continue;
    }
    if (DBL_LISTED_CODES.has(addr) || addr.startsWith('127.0.1.')) {
      sawListed = true;
      continue;
    }
    if (addr.startsWith('127.0.0.')) {
      // SURBL/URIBL hits — treat as listed.
      sawListed = true;
      continue;
    }
    sawDenied = true;
  }

  if (sawListed) return { status: 'listed', sawDenied };
  if (sawDenied) return { status: 'unknown', sawDenied };
  return { status: 'clean', sawDenied };
}

// ============================================
// Domain check
// ============================================

async function checkLegacyMirrors(domain: string): Promise<BlacklistResult> {
  const cleaned = domain.toLowerCase().replace(/\.$/, '');
  const raw: Record<string, string[]> = {};
  const lists: string[] = [];
  let anyDenied = false;
  let anySuccess = false;

  for (const zone of LEGACY_ZONES) {
    const host = `${cleaned}.${zone}`;
    try {
      const addresses = await resolveOrNxdomain(host);
      raw[zone] = addresses;
      anySuccess = true;
      const { status, sawDenied } = classifyDblAddresses(addresses);
      if (sawDenied) anyDenied = true;
      if (status === 'listed') {
        lists.push(zone);
      }
    } catch (err) {
      console.error(
        `[blacklist-proxy] ${zone} lookup failed for ${cleaned}:`,
        err instanceof Error ? err.message : err
      );
      anyDenied = true;
    }
  }

  if (lists.length > 0) {
    return { domain: cleaned, status: 'listed', lists, raw, method: 'legacy-public' };
  }
  if (!anySuccess || anyDenied) {
    return { domain: cleaned, status: 'unknown', lists: [], raw, method: 'legacy-public' };
  }
  return { domain: cleaned, status: 'clean', lists: [], raw, method: 'legacy-public' };
}

// ============================================
// HTTP server
// ============================================

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function readBody(req: http.IncomingMessage, maxBytes = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function startBlacklistProxy(): http.Server | null {
  const port = Number(process.env.BLACKLIST_PROXY_PORT || 3001);
  const secret = process.env.WORKER_CALLBACK_SECRET;

  if (!secret) {
    console.warn(
      '[blacklist-proxy] WORKER_CALLBACK_SECRET is not set — proxy will NOT start.'
    );
    return null;
  }

  const server = http.createServer(async (req, res) => {
    // Health probe
    if (req.method === 'GET' && req.url === '/internal/blacklist-check/health') {
      jsonResponse(res, 200, { ok: true, method: 'legacy-public', zones: LEGACY_ZONES });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/internal/blacklist-check') {
      jsonResponse(res, 404, { error: 'not found' });
      return;
    }

    const provided = req.headers['x-worker-secret'];
    if (!provided || provided !== secret) {
      jsonResponse(res, 401, { error: 'unauthorized' });
      return;
    }

    let bodyText: string;
    try {
      bodyText = await readBody(req);
    } catch (err) {
      jsonResponse(res, 413, {
        error: err instanceof Error ? err.message : 'failed to read body',
      });
      return;
    }

    let parsed: { domain?: unknown };
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON' });
      return;
    }

    const domainRaw = typeof parsed.domain === 'string' ? parsed.domain : '';
    const cleaned = domainRaw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    if (!cleaned || !DOMAIN_REGEX.test(cleaned)) {
      jsonResponse(res, 400, { error: 'invalid domain' });
      return;
    }

    try {
      const result = await checkLegacyMirrors(cleaned);
      jsonResponse(res, 200, result);
    } catch (err) {
      console.error('[blacklist-proxy] check failed:', err);
      jsonResponse(res, 500, {
        domain: cleaned,
        status: 'unknown',
        lists: [],
        raw: {},
        method: 'unavailable',
        error: err instanceof Error ? err.message : 'lookup failed',
      });
    }
  });

  server.listen(port, () => {
    console.log(
      `[blacklist-proxy] Listening on :${port} — POST /internal/blacklist-check (zones: ${LEGACY_ZONES.join(', ')})`
    );
  });

  return server;
}
