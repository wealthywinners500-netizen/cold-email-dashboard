// ============================================
// Shared domain blacklist lookup helper.
// Used by:
//   - /api/provisioning/check-domain route (wizard pre-flight)
//   - /api/dns-registrars/[id]/domains route (IONOS auto-populate filter)
//   - pair-provisioning-saga.ts Step 8 verification_gate (post-provision warning)
//
// Hard lesson #43 (2026-04-10): Never ship a stubbed blacklist check. The
// previous check-domain endpoint returned { clean: true } for every domain,
// which allowed krogeradcollective.info (Spamhaus-listed) to pass Test #11.
// ============================================

import dns from 'dns/promises';

/**
 * Default DNSBL list checked for every domain. These are the three most
 * authoritative URI/domain blocklists for cold-email deliverability:
 *   - dbl.spamhaus.org     — Spamhaus Domain Block List
 *   - multi.surbl.org      — SURBL multi-list
 *   - uribl.spameatingmonkey.net — SpamEatingMonkey URI list
 */
export const DEFAULT_DOMAIN_BLACKLISTS = [
  'dbl.spamhaus.org',
  'multi.surbl.org',
  'uribl.spameatingmonkey.net',
];

export interface DomainBlacklistResult {
  domain: string;
  clean: boolean;
  blacklists: string[];
  /** Lists that failed with a transient DNS error (not counted as listed). */
  errors: Array<{ list: string; code: string; message: string }>;
}

/**
 * Classify a DNSBL A-record response. DNSBLs encode the meaning of a hit in
 * the A-record value, and ALSO use reserved codes to signal "your resolver
 * is blocked / rate-limited / misconfigured". Treating those reserved codes
 * as hits produces false positives.
 *
 * Legitimate listing codes are in the form 127.0.x.y (low second octet),
 * e.g. Spamhaus DBL 127.0.1.2 / 127.0.1.4, SURBL 127.0.0.2/4/8, URIBL
 * 127.0.0.2/4/8. Resolver-error codes are ALWAYS in 127.255.255.0/24, e.g.:
 *   - 127.255.255.252  typo in DNSBL name
 *   - 127.255.255.254  anonymous query via public/bulk resolver (DENIED)
 *   - 127.255.255.255  rate-limit exceeded
 *
 * Hard lesson #46 (2026-04-10): Vercel serverless DNS resolvers are
 * identified by Spamhaus as public/bulk resolvers and receive
 * 127.255.255.254 for EVERY lookup, including clean domains like google.com.
 * Without this filter, the check-domain endpoint reported every domain as
 * listed on dbl.spamhaus.org, which would make the wizard dropdown empty
 * and block every provisioning launch.
 */
type HitClass = 'listed' | 'blocked_resolver' | 'not_listed';

function classifyDnsblResponse(addresses: string[]): HitClass {
  if (!addresses || addresses.length === 0) return 'not_listed';

  let sawLegitHit = false;
  let sawBlockedResolver = false;

  for (const addr of addresses) {
    const parts = addr.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) continue;
    const [a, b, c] = parts;
    // 127.255.255.x = resolver-blocked / error sentinel (all major DNSBLs).
    if (a === 127 && b === 255 && c === 255) {
      sawBlockedResolver = true;
      continue;
    }
    // Legitimate listing codes are 127.0.x.y with x < 255.
    if (a === 127 && b === 0) {
      sawLegitHit = true;
      continue;
    }
    // Anything else (including 127.0.255.x or non-127 addresses) is unknown —
    // treat as blocked/error rather than a hit.
    sawBlockedResolver = true;
  }

  if (sawLegitHit) return 'listed';
  if (sawBlockedResolver) return 'blocked_resolver';
  return 'not_listed';
}

/**
 * Check a single DNSBL for a domain. Returns true if the domain is listed
 * with a legitimate listing code, false if not listed OR if the resolver
 * was blocked (fail-open). Throws only on transport-level DNS failures that
 * are NOT ENOTFOUND/ENODATA/SERVFAIL.
 */
async function isListedOn(domain: string, list: string): Promise<boolean> {
  try {
    const addresses = await dns.resolve4(`${domain}.${list}`);
    const cls = classifyDnsblResponse(addresses);
    if (cls === 'blocked_resolver') {
      console.warn(
        `[domain-blacklist] ${list} lookup for ${domain} returned ` +
          `resolver-blocked sentinel ${addresses.join(',')} — treating as not-listed (fail-open)`
      );
      return false;
    }
    return cls === 'listed';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTFOUND / ENODATA = not listed (normal case).
    // SERVFAIL is the other common "blocked resolver" signal from Spamhaus —
    // treat as fail-open so we don't flag every domain.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') {
      return false;
    }
    throw err;
  }
}

/**
 * Check a domain against the default DNSBL set (or a custom list).
 * Fails open on transient DNS errors (per-list), but records them in `errors`.
 */
export async function checkDomainBlacklists(
  domain: string,
  lists: string[] = DEFAULT_DOMAIN_BLACKLISTS
): Promise<DomainBlacklistResult> {
  const cleanDomain = domain.trim().toLowerCase();
  const hits: string[] = [];
  const errors: Array<{ list: string; code: string; message: string }> = [];

  for (const bl of lists) {
    try {
      if (await isListedOn(cleanDomain, bl)) {
        hits.push(bl);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code || 'UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ list: bl, code, message });
      console.error(
        `[domain-blacklist] ${bl} lookup failed for ${cleanDomain}: ${code} ${message}`
      );
    }
  }

  return {
    domain: cleanDomain,
    clean: hits.length === 0,
    blacklists: hits,
    errors,
  };
}

/**
 * Batch check many domains with bounded concurrency. Uses Promise.allSettled
 * so one DNS timeout can't take down the whole batch.
 */
export async function checkDomainsBlacklistBatch(
  domains: string[],
  options: { concurrency?: number; lists?: string[] } = {}
): Promise<DomainBlacklistResult[]> {
  const { concurrency = 10, lists = DEFAULT_DOMAIN_BLACKLISTS } = options;
  const results: DomainBlacklistResult[] = new Array(domains.length);
  let cursor = 0;

  async function worker() {
    while (cursor < domains.length) {
      const idx = cursor++;
      const domain = domains[idx];
      try {
        results[idx] = await checkDomainBlacklists(domain, lists);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[idx] = {
          domain: domain.toLowerCase(),
          clean: true, // fail-open: we'd rather warn than block on transient DNS
          blacklists: [],
          errors: [{ list: 'batch', code: 'BATCH_ERROR', message }],
        };
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
