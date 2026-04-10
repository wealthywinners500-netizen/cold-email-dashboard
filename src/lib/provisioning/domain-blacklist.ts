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
 * Check a single DNSBL for a domain. Returns true if the domain is listed.
 * ENOTFOUND / ENODATA => not listed (normal case).
 * Any other error => rethrown so the caller can fail-open or log.
 */
async function isListedOn(domain: string, list: string): Promise<boolean> {
  try {
    const addresses = await dns.resolve4(`${domain}.${list}`);
    // Spamhaus and SURBL encode reasons in the A-record value (127.0.1.x).
    // Any returned A record means the domain is listed.
    return addresses.length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return false;
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
