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

const IP_BLACKLISTS = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'dnsbl.sorbs.net', name: 'SORBS' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda' },
  { zone: 'dnsbl-1.uceprotect.net', name: 'UCEPROTECT L1' },
] as const;

export interface IPBlacklistResult {
  ip: string;
  listed: boolean;
  listings: Array<{ zone: string; name: string; response?: string }>;
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
 * Check a single IP against all 4 DNSBL zones in parallel.
 *
 * Any A-record response from a zone means the IP is listed on that zone.
 * NXDOMAIN or timeout means clean (or transient error → treated as clean
 * per Hard Lesson #74).
 *
 * Runs on the worker VPS (200.234.226.226) which is NOT a cloud provider
 * IP, so Spamhaus ZEN queries work without the 127.255.255.254 cloud-IP
 * denial (Hard Lesson #47).
 */
export async function checkIPBlacklist(ip: string): Promise<IPBlacklistResult> {
  const reversed = ip.split('.').reverse().join('.');
  const TIMEOUT_MS = 5000;

  const results = await Promise.all(
    IP_BLACKLISTS.map(async ({ zone, name }) => {
      const response = await queryZone(reversed, zone, TIMEOUT_MS);
      return { zone, name, response };
    })
  );

  const listings = results
    .filter((r) => r.response !== null)
    .map((r) => ({ zone: r.zone, name: r.name, response: r.response! }));

  return {
    ip,
    listed: listings.length > 0,
    listings,
  };
}
