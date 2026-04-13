// ============================================
// Standalone IP DNSBL checker for the create_vps step.
//
// PATCH 9 (2026-04-12): Fresh Linode IPs can carry pre-existing blacklist
// entries from prior tenants. This module queries 4 IP-based DNSBL zones
// immediately after VPS creation so the create_vps handler can delete
// dirty-IP servers and re-roll before wasting 25-30 min of provisioning.
//
// This is intentionally separate from verification.ts's DNSVerifier class
// (which has constructor deps on Supabase, etc.) — all we need here is a
// lightweight DNS A-record probe per zone.
//
// Hard Lesson #74: Treat transient DNSBL errors (timeout, SERVFAIL) as
// "not listed" — a false-negative here just means the VG catches it later.
// A false-positive would block provisioning unnecessarily.
// ============================================

import { Resolver } from 'dns';

// PATCH 10b: Removed Barracuda from IP pre-check — Barracuda lists ~80% of
// Linode IPs across all US regions, causing 4/4 re-rolls to fail every time.
// Barracuda delisting is instant/free and is NOT a hard deliverability blocker.
// It's still checked in Step 8 (VG) as a non-fatal warning.
//
// Hard Lesson #83: TRUNCATE and Anonmails added as non-fatal monitors.
// They're queryable from any IP and not as false-positive-heavy as Barracuda,
// but listing shouldn't trigger IP re-roll — the VG surfaces them as warnings.
const IP_BLACKLISTS = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN', fatal: true },
  { zone: 'dnsbl.sorbs.net', name: 'SORBS', fatal: true },
  { zone: 'dnsbl-1.uceprotect.net', name: 'UCEPROTECT L1', fatal: true },
  { zone: 'truncate.gbudb.net', name: 'TRUNCATE', fatal: false },
  { zone: 'spam.dnsbl.anonmails.de', name: 'Anonmails', fatal: false },
] as const;

export interface IPBlacklistResult {
  ip: string;
  listed: boolean;       // true if ANY zone listed (fatal or not)
  fatalListed: boolean;  // true only if a fatal zone listed (triggers re-roll)
  listings: Array<{ zone: string; name: string; fatal: boolean; response?: string }>;
}

/**
 * Query a single DNSBL zone for a reversed-IP lookup.
 * Returns the first A-record response if listed, or null if clean/error.
 */
function queryZone(
  reversedIP: string,
  zone: string,
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const resolver = new Resolver();
    resolver.setServers(['8.8.8.8']);

    const timer = setTimeout(() => {
      resolver.cancel();
      resolve(null); // Timeout = treat as not listed
    }, timeoutMs);

    resolver.resolve4(`${reversedIP}.${zone}`, (err, addresses) => {
      clearTimeout(timer);
      if (err) {
        // NXDOMAIN, ENODATA, ECANCELLED, SERVFAIL = not listed (or transient)
        resolve(null);
      } else if (addresses && addresses.length > 0) {
        resolve(addresses[0]);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Check a single IP against all DNSBL zones in parallel.
 *
 * Any A-record response from a zone means the IP is listed on that zone.
 * NXDOMAIN or timeout means clean (or transient error → treated as clean
 * per Hard Lesson #74).
 *
 * Runs on the worker VPS (200.234.226.226) which is NOT a cloud provider
 * IP, so Spamhaus ZEN queries work without the 127.255.255.254 cloud-IP
 * denial (Hard Lesson #47).
 *
 * Returns both `listed` (any zone) and `fatalListed` (only fatal zones).
 * The create_vps handler should only re-roll on `fatalListed` — non-fatal
 * listings (TRUNCATE, Anonmails) are logged as warnings.
 */
export async function checkIPBlacklist(ip: string): Promise<IPBlacklistResult> {
  const reversed = ip.split('.').reverse().join('.');
  const TIMEOUT_MS = 5000;

  const results = await Promise.all(
    IP_BLACKLISTS.map(async ({ zone, name, fatal }) => {
      const response = await queryZone(reversed, zone, TIMEOUT_MS);
      return { zone, name, fatal, response };
    })
  );

  const listings = results
    .filter((r) => r.response !== null)
    .map((r) => ({ zone: r.zone, name: r.name, fatal: r.fatal, response: r.response! }));

  return {
    ip,
    listed: listings.length > 0,
    fatalListed: listings.some((l) => l.fatal),
    listings,
  };
}
