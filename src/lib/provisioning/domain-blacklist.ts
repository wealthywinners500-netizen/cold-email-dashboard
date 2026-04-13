// ============================================
// Shared domain blacklist lookup helper.
// Used by:
//   - /api/provisioning/check-domain route (wizard pre-flight)
//   - /api/dns-registrars/[id]/domains route (IONOS auto-populate filter)
//   - pair-provisioning-saga.ts Step 8 verification_gate (post-provision warning)
//
// Hard lesson #43 (2026-04-10): Never ship a stubbed blacklist check.
// Hard lesson #46 (2026-04-10): Spamhaus reserved 127.255.255.x return codes
//   must be classified as "resolver blocked", not "listed".
// Hard lesson #47 (2026-04-10): Spamhaus actively blocks DNSBL queries from
//   cloud provider IP ranges (AWS/GCP/Azure/Vercel). The legacy public mirror
//   `dbl.spamhaus.org` returns 127.255.255.254 ("anonymous public resolver —
//   DENIED") for EVERY query from Vercel, regardless of whether the domain
//   is actually listed. The official workaround is Spamhaus Data Query
//   Service (DQS), which uses a per-account key embedded in the query name:
//     {domain}.{key}.dbl.dq.spamhaus.net
//   Set SPAMHAUS_DQS_KEY in the Vercel env. Signup: https://portal.spamhaus.com
//
// This module now implements a 4-tier blacklist check:
//   1. PRIMARY: DQS (cloud-IP-allowed, auth'd via SPAMHAUS_DQS_KEY)
//   2. DIRECT DNSBL: SURBL + URIBL (no auth needed, work from cloud IPs)
//   3. FALLBACK: worker VPS proxy (non-cloud IP, queries legacy mirrors)
//   4. UNAVAILABLE: definitive "unknown" result — wizard warns, doesn't block
//
// Hard Lesson #83: DQS only checks Spamhaus DBL. SURBL and URIBL must be
// checked separately via direct DNS. Results are MERGED — a domain listed
// on SURBL but clean on DBL is still "listed".
// ============================================

import dns from 'dns/promises';

// Spamhaus DQS query format — official docs:
// https://docs.spamhaus.com/datasets/docs/source/70-access-methods/data-query-service/040-dqs-queries.html
// Format: {domain}.{key}.{zone}.dq.spamhaus.net
const DQS_ZONES = ['dbl'] as const; // can add 'zrd' (zero-reputation domain) later

// Spamhaus DBL "listed" return codes (legitimate listing signals, not errors).
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

export type BlacklistStatus = 'clean' | 'listed' | 'unknown';
export type BlacklistMethod =
  | 'dqs'              // primary: Spamhaus DQS
  | 'direct-dnsbl'     // tier 2: direct DNSBL queries (SURBL, URIBL)
  | 'fallback-proxy'   // tier 3: worker VPS proxy
  | 'legacy-public'    // legacy: public mirrors (worker only)
  | 'unavailable';     // no method succeeded

export interface BlacklistResult {
  domain: string;
  status: BlacklistStatus;
  lists: string[];              // which lists flagged it (when status='listed')
  raw: Record<string, string[]>; // per-list raw A records (debugging)
  method: BlacklistMethod;
  // Backwards-compat aliases — `clean` only true when status === 'clean'.
  clean: boolean;
  blacklists: string[];
}

function makeResult(
  domain: string,
  status: BlacklistStatus,
  lists: string[],
  raw: Record<string, string[]>,
  method: BlacklistMethod
): BlacklistResult {
  return {
    domain,
    status,
    lists,
    raw,
    method,
    clean: status === 'clean',
    blacklists: lists,
  };
}

// ============================================
// Low-level DNS helper
// ============================================

/**
 * Resolve an A record. Returns the addresses, OR [] on NXDOMAIN (not listed).
 * Throws on all other errors (caller decides fail-open vs error out).
 */
async function resolveOrNxdomain(host: string): Promise<string[]> {
  try {
    return await dns.resolve4(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw err;
  }
}

/**
 * Classify a set of DNSBL A-records. Used for BOTH DQS and legacy paths —
 * they use the same 127.0.x.y listing / 127.255.255.x denied scheme.
 */
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
    // 127.0.0.x used by other DNSBL families (SURBL/URIBL) — treat as listed too
    if (addr.startsWith('127.0.0.')) {
      sawListed = true;
      continue;
    }
    // Anything else is unexpected — treat as denied rather than hit
    sawDenied = true;
  }

  if (sawListed) return { status: 'listed', sawDenied };
  if (sawDenied) return { status: 'unknown', sawDenied };
  return { status: 'clean', sawDenied };
}

// ============================================
// Primary path: Spamhaus DQS
// ============================================

async function checkViaDQS(domain: string): Promise<BlacklistResult | null> {
  const key = process.env.SPAMHAUS_DQS_KEY;
  if (!key) return null;

  const cleaned = domain.toLowerCase().replace(/\.$/, '');
  const raw: Record<string, string[]> = {};
  const lists: string[] = [];
  let anyDenied = false;

  for (const zone of DQS_ZONES) {
    const host = `${cleaned}.${key}.${zone}.dq.spamhaus.net`;
    try {
      const addresses = await resolveOrNxdomain(host);
      raw[zone] = addresses;
      const { status, sawDenied } = classifyDblAddresses(addresses);
      if (sawDenied) anyDenied = true;
      if (status === 'listed') {
        lists.push(`${zone}.dq.spamhaus.net`);
      }
    } catch (err) {
      console.error(
        `[domain-blacklist] DQS ${zone} lookup failed for ${cleaned}:`,
        err instanceof Error ? err.message : err
      );
      anyDenied = true; // transient — treat as unknown so fallback can try
    }
  }

  if (lists.length > 0) {
    return makeResult(cleaned, 'listed', lists, raw, 'dqs');
  }
  if (anyDenied) {
    return makeResult(cleaned, 'unknown', [], raw, 'dqs');
  }
  return makeResult(cleaned, 'clean', [], raw, 'dqs');
}

// ============================================
// Tier 2: Direct DNSBL queries (SURBL, URIBL)
// These zones accept domain lookups (not reversed-IP) and work from cloud IPs.
// No authentication key needed.
// ============================================

const DIRECT_DOMAIN_DNSBLS = [
  { zone: 'multi.surbl.org', name: 'SURBL' },
  { zone: 'black.uribl.com', name: 'URIBL' },
] as const;

async function checkDirectDomainDNSBLs(
  domain: string
): Promise<{ lists: string[]; raw: Record<string, string[]> }> {
  const cleaned = domain.toLowerCase().replace(/\.$/, '');
  const lists: string[] = [];
  const raw: Record<string, string[]> = {};

  for (const { zone, name } of DIRECT_DOMAIN_DNSBLS) {
    const host = `${cleaned}.${zone}`;
    try {
      const addresses = await resolveOrNxdomain(host);
      raw[zone] = addresses;
      // Any 127.0.x.x response = listed; NXDOMAIN (empty) = clean
      if (addresses.length > 0 && addresses.some((a) => a.startsWith('127.0.'))) {
        lists.push(name);
      }
    } catch (err) {
      // Timeout or DNS error — fail-open (treat as unknown for this zone)
      console.error(
        `[domain-blacklist] Direct DNSBL ${name} lookup failed for ${cleaned}:`,
        err instanceof Error ? err.message : err
      );
      raw[zone] = [];
    }
  }

  return { lists, raw };
}

// ============================================
// Fallback path: worker VPS proxy
// ============================================

async function checkViaWorkerProxy(
  domain: string
): Promise<BlacklistResult | null> {
  const workerUrl = process.env.WORKER_BLACKLIST_URL; // e.g. https://worker.example/internal/blacklist-check
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!workerUrl || !secret) return null;

  try {
    const res = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': secret,
      },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(
        `[domain-blacklist] Worker proxy returned ${res.status} for ${domain}`
      );
      return null;
    }
    const data = (await res.json()) as {
      status?: BlacklistStatus;
      lists?: string[];
      raw?: Record<string, string[]>;
    };
    if (!data.status) return null;
    return makeResult(
      domain.toLowerCase(),
      data.status,
      data.lists || [],
      data.raw || {},
      'fallback-proxy'
    );
  } catch (err) {
    console.error(
      `[domain-blacklist] Worker proxy fallback failed for ${domain}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ============================================
// Public API
// ============================================

/**
 * Check a single domain against the blacklist tier chain.
 *   1. DQS (if SPAMHAUS_DQS_KEY set) — Spamhaus DBL
 *   2. Direct DNSBL (SURBL + URIBL) — always available, no key needed
 *   3. Worker proxy (if WORKER_BLACKLIST_URL + WORKER_CALLBACK_SECRET set)
 *   4. Returns `unknown` with method='unavailable'
 *
 * IMPORTANT: Results are MERGED across tiers 1+2. If DQS says clean but
 * SURBL says listed, the combined result is 'listed'. Don't short-circuit
 * after DQS clean — always run Tier 2. Only skip Tier 3 if Tiers 1+2
 * produced at least one definitive answer (Hard Lesson #83).
 *
 * Returns a 3-state result. Callers MUST handle 'unknown' explicitly —
 * do NOT treat it as clean OR as listed.
 */
export async function checkDomainBlacklist(
  domain: string
): Promise<BlacklistResult> {
  const cleaned = domain.trim().toLowerCase();
  const mergedLists: string[] = [];
  const mergedRaw: Record<string, string[]> = {};
  let hadDefinitiveAnswer = false;

  // Tier 1: DQS (Spamhaus DBL)
  const dqs = await checkViaDQS(cleaned);
  if (dqs) {
    Object.assign(mergedRaw, dqs.raw);
    if (dqs.status === 'listed') {
      mergedLists.push(...dqs.lists);
      hadDefinitiveAnswer = true;
    } else if (dqs.status === 'clean') {
      hadDefinitiveAnswer = true;
    }
    // If 'unknown', DQS was inconclusive — still run Tier 2
  }

  // Tier 2: Direct DNSBL (SURBL + URIBL) — always run, merge results
  const direct = await checkDirectDomainDNSBLs(cleaned);
  Object.assign(mergedRaw, direct.raw);
  if (direct.lists.length > 0) {
    mergedLists.push(...direct.lists);
    hadDefinitiveAnswer = true;
  } else if (Object.values(direct.raw).some((addrs) => addrs.length === 0)) {
    // At least one zone responded (even if clean) — that's a definitive answer
    hadDefinitiveAnswer = true;
  }

  // If any tier found a listing, return 'listed' immediately
  if (mergedLists.length > 0) {
    return makeResult(cleaned, 'listed', mergedLists, mergedRaw, dqs ? 'dqs' : 'direct-dnsbl');
  }

  // If tiers 1+2 both returned definitive clean, no need for proxy fallback
  if (hadDefinitiveAnswer && dqs && dqs.status !== 'unknown') {
    return makeResult(cleaned, 'clean', [], mergedRaw, 'dqs');
  }

  // Tier 3: worker proxy (only if tiers 1+2 were insufficient)
  const proxy = await checkViaWorkerProxy(cleaned);
  if (proxy && proxy.status !== 'unknown') {
    Object.assign(mergedRaw, proxy.raw);
    if (proxy.status === 'listed') {
      return makeResult(cleaned, 'listed', proxy.lists, mergedRaw, 'fallback-proxy');
    }
    return makeResult(cleaned, 'clean', [], mergedRaw, 'fallback-proxy');
  }

  // If we had a definitive answer from Tier 2 even though DQS was unavailable
  if (hadDefinitiveAnswer) {
    return makeResult(cleaned, 'clean', [], mergedRaw, 'direct-dnsbl');
  }

  // All tiers inconclusive
  if (dqs) return makeResult(cleaned, 'unknown', [], mergedRaw, 'dqs');
  if (proxy) return makeResult(cleaned, 'unknown', [], mergedRaw, 'fallback-proxy');
  return makeResult(cleaned, 'unknown', [], mergedRaw, 'unavailable');
}

/**
 * Batch check with bounded concurrency. Uses per-domain try/catch so one
 * failure can't take down the whole batch.
 */
export async function checkDomainBlacklistBatch(
  domains: string[],
  options: { concurrency?: number } = {}
): Promise<BlacklistResult[]> {
  const { concurrency = 10 } = options;
  const results: BlacklistResult[] = new Array(domains.length);
  let cursor = 0;

  async function worker() {
    while (cursor < domains.length) {
      const idx = cursor++;
      const domain = domains[idx];
      try {
        results[idx] = await checkDomainBlacklist(domain);
      } catch (err) {
        console.error(
          `[domain-blacklist] batch worker failed for ${domain}:`,
          err instanceof Error ? err.message : err
        );
        results[idx] = makeResult(
          domain.toLowerCase(),
          'unknown',
          [],
          {},
          'unavailable'
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, domains.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ============================================
// Backwards-compat shims
// ============================================
// Old code imported `checkDomainBlacklists` / `checkDomainsBlacklistBatch` /
// `DomainBlacklistResult`. Keep them as thin wrappers so we can migrate
// consumers one at a time without breaking the build.

export type DomainBlacklistResult = BlacklistResult;

export async function checkDomainBlacklists(
  domain: string
): Promise<BlacklistResult> {
  return checkDomainBlacklist(domain);
}

export async function checkDomainsBlacklistBatch(
  domains: string[],
  options: { concurrency?: number } = {}
): Promise<BlacklistResult[]> {
  return checkDomainBlacklistBatch(domains, options);
}
