// ============================================
// Standalone IP DNSBL checker for the create_vps step.
//
// PATCH 9 (2026-04-12): Fresh Linode IPs can carry pre-existing blacklist
// entries from prior tenants. This module queries IP-based DNSBL zones
// immediately after VPS creation so the create_vps handler can delete
// dirty-IP servers and re-roll before wasting 25-30 min of provisioning.
//
// PATCH 20 (2026-04-14): ZERO TOLERANCE — expanded to cover every DNSBL
// that MXToolbox checks. ALL listings are fatal. No IP with ANY blacklist
// listing is acceptable. Hard Lesson #98.
//
// Hard Lesson #74: Treat transient DNSBL errors (timeout, SERVFAIL) as
// "not listed" — a false-negative here just means the VG catches it later.
// A false-positive would block provisioning unnecessarily.
// ============================================

import { Resolver } from 'dns';
import { isDnsblZoneLive } from './dnsbl-liveness';

// PATCH 20: Complete DNSBL coverage matching MXToolbox's blacklist checker.
// ALL are fatal — Dean's rule: zero blacklists on any launched server.
// Previously only checked 5 lists (3 fatal + 2 non-fatal). Now checks ~40
// including all UCEPROTECT tiers, SpamCop, Barracuda, SORBS variants,
// Spamhaus components, and every other list MXToolbox reports on.
//
// Hard Lesson #98: UCEPROTECT L1 was clean but L2 (subnet) was listed.
// Our old check only had L1. Must check ALL tiers.
const IP_BLACKLISTS = [
  // Spamhaus (comprehensive)
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'sbl.spamhaus.org', name: 'Spamhaus SBL' },
  { zone: 'xbl.spamhaus.org', name: 'Spamhaus XBL' },
  { zone: 'pbl.spamhaus.org', name: 'Spamhaus PBL' },
  { zone: 'css.spamhaus.org', name: 'Spamhaus CSS' },

  // UCEPROTECT (all 3 tiers — L2/L3 catch subnet/ASN listings)
  { zone: 'dnsbl-1.uceprotect.net', name: 'UCEPROTECT L1' },
  { zone: 'dnsbl-2.uceprotect.net', name: 'UCEPROTECT L2' },
  { zone: 'dnsbl-3.uceprotect.net', name: 'UCEPROTECT L3' },

  // SpamCop
  { zone: 'bl.spamcop.net', name: 'SpamCop' },

  // Barracuda
  { zone: 'b.barracudacentral.org', name: 'Barracuda' },

  // SORBS (all variants)
  { zone: 'dnsbl.sorbs.net', name: 'SORBS' },
  { zone: 'dul.dnsbl.sorbs.net', name: 'SORBS DUL' },
  { zone: 'smtp.dnsbl.sorbs.net', name: 'SORBS SMTP' },
  { zone: 'spam.dnsbl.sorbs.net', name: 'SORBS SPAM' },
  { zone: 'http.dnsbl.sorbs.net', name: 'SORBS HTTP' },
  { zone: 'socks.dnsbl.sorbs.net', name: 'SORBS SOCKS' },
  { zone: 'web.dnsbl.sorbs.net', name: 'SORBS WEB' },
  { zone: 'misc.dnsbl.sorbs.net', name: 'SORBS MISC' },
  { zone: 'zombie.dnsbl.sorbs.net', name: 'SORBS ZOMBIE' },
  { zone: 'new.spam.dnsbl.sorbs.net', name: 'SORBS NEW SPAM' },
  { zone: 'recent.spam.dnsbl.sorbs.net', name: 'SORBS RECENT SPAM' },
  { zone: 'old.spam.dnsbl.sorbs.net', name: 'SORBS OLD SPAM' },
  { zone: 'escalations.dnsbl.sorbs.net', name: 'SORBS ESCALATIONS' },
  { zone: 'block.dnsbl.sorbs.net', name: 'SORBS BLOCK' },

  // CBL / Abuseat
  { zone: 'cbl.abuseat.org', name: 'CBL' },

  // PSBL
  { zone: 'psbl.surriel.com', name: 'PSBL' },

  // SpamRats
  { zone: 'dyna.spamrats.com', name: 'SpamRats DYNA' },
  { zone: 'noptr.spamrats.com', name: 'SpamRats NOPTR' },
  { zone: 'spam.spamrats.com', name: 'SpamRats SPAM' },

  // DroneRL
  { zone: 'dnsbl.dronebl.org', name: 'DroneRL' },

  // TRUNCATE / GBUdb
  { zone: 'truncate.gbudb.net', name: 'TRUNCATE' },

  // Anonmails
  { zone: 'spam.dnsbl.anonmails.de', name: 'Anonmails' },

  // Additional MXToolbox-checked lists
  { zone: 'all.s5h.net', name: 'S5H' },
  { zone: 'blacklist.woody.ch', name: 'Woody' },
  { zone: 'bogons.cymru.com', name: 'Cymru Bogons' },
  { zone: 'combined.abuse.ch', name: 'Abuse.ch Combined' },
  { zone: 'db.wpbl.info', name: 'WPBL' },
  { zone: 'drone.abuse.ch', name: 'Abuse.ch Drone' },
  { zone: 'ips.backscatterer.org', name: 'Backscatterer' },
  { zone: 'ix.dnsbl.manitu.net', name: 'Manitu' },
  { zone: 'singular.ttk.pte.hu', name: 'Singular TTK' },
  { zone: 'spam.abuse.ch', name: 'Abuse.ch SPAM' },
  { zone: 'spambot.bls.digibase.ca', name: 'Digibase' },
  { zone: 'spamrbl.imp.ch', name: 'IMP SPAM' },
  { zone: 'ubl.lashback.com', name: 'Lashback UBL' },
  { zone: 'virus.rbl.jp', name: 'RBL.JP Virus' },
  { zone: 'wormrbl.imp.ch', name: 'IMP Worm' },
  { zone: 'relays.nether.net', name: 'Nether Relays' },
] as const;

export interface IPBlacklistResult {
  ip: string;
  listed: boolean;       // true if ANY zone listed
  fatalListed: boolean;  // PATCH 20: same as listed — ALL listings are fatal
  listings: Array<{ zone: string; name: string; fatal: boolean; response?: string }>;
}

/**
 * Query a single DNSBL zone for a reversed-IP lookup against a specific resolver.
 * Returns a discriminated-union result so the caller can distinguish "listed",
 * "zone returned empty" (potential blind-zone false-negative), "NXDOMAIN"
 * (properly not-listed), "error", or "timeout".
 *
 * Hard Lesson (2026-04-17): The old queryZone collapsed every non-listed
 * outcome to `null`, hiding the case where a zone was unreachable from the
 * worker's resolver path. `spam.spamrats.com` returned EMPTY from the worker
 * via 8.8.8.8 while `45.79.198.71` was actually LISTED on SpamRats — that IP
 * slipped through Step 1 because EMPTY was silently treated as "not listed".
 */
export type ZoneQueryResult =
  | { kind: 'listed'; response: string }
  | { kind: 'empty' }
  | { kind: 'nxdomain' }
  | { kind: 'error'; code: string }
  | { kind: 'timeout' };

/**
 * Classify a raw DNSBL resolver reply into a ZoneQueryResult.
 *
 * Hard Lesson #R1 (2026-04-18 — job 1e41871a): the previous version of
 * this file treated ANY non-empty A-record as `kind: 'listed'`, which
 * caused Spamhaus's `127.255.255.254` "anonymous public resolver denied"
 * sentinel (returned to Cloudflare/Google recursors) to be misread as a
 * real blacklist hit. That exact bug rejected six consecutive pairs of
 * clean Linode IPs for the launta.info job, wasting ~10 min of Step 1
 * before bailing out. The Session 02 canary PR fixed this classification
 * in `dnsbl-liveness.realResolve`, but missed the parallel path here.
 *
 * Classification rules:
 *   - Node error ENOTFOUND / ENODATA → `nxdomain` (properly not-listed)
 *   - Any other node error           → `error` with the node code
 *   - Empty answer section            → `empty` (rare — mostly zone quirks)
 *   - A-record in 127.0.0.0/24        → `listed` (the ONLY real listing range;
 *                                       every well-behaved DNSBL answers here)
 *   - A-record in 127.255.255.0/24    → `error` with code `RESOLVER_DENIED`
 *                                       (Spamhaus sentinel set for blocked
 *                                       public recursors and rate-limits)
 *   - Any other A-record              → `error` with code `UNEXPECTED_<addr>`
 *                                       (unknown — conservatively treated as
 *                                       not-listed per Hard Lesson #74)
 *
 * Keeping this as a pure helper makes it trivially unit-testable without
 * touching the network. Mirrors the semantics of
 * `dnsbl-liveness.realResolve` for consistency across the two call sites.
 */
export function classifyDnsblReply(
  err: NodeJS.ErrnoException | null,
  addresses: readonly string[] | null
): ZoneQueryResult {
  if (err) {
    const code = err.code || 'UNKNOWN';
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { kind: 'nxdomain' };
    }
    return { kind: 'error', code };
  }
  if (!addresses || addresses.length === 0) {
    return { kind: 'empty' };
  }
  const addr = addresses[0];
  if (addr.startsWith('127.0.0.')) {
    return { kind: 'listed', response: addr };
  }
  if (addr.startsWith('127.255.255.')) {
    return { kind: 'error', code: 'RESOLVER_DENIED' };
  }
  return { kind: 'error', code: `UNEXPECTED_${addr}` };
}

function queryZone(
  reversedIP: string,
  zone: string,
  resolverIP: string,
  timeoutMs: number
): Promise<ZoneQueryResult> {
  return new Promise((resolve) => {
    const resolver = new Resolver();
    resolver.setServers([resolverIP]);

    const timer = setTimeout(() => {
      resolver.cancel();
      resolve({ kind: 'timeout' });
    }, timeoutMs);

    resolver.resolve4(`${reversedIP}.${zone}`, (err, addresses) => {
      clearTimeout(timer);
      resolve(classifyDnsblReply(err ?? null, addresses ?? null));
    });
  });
}

/**
 * Resolver chain — tried in order for canary verification.
 * If a zone is blind via the first resolver, we fall back to the next.
 * If ALL resolvers fail canary, the zone is treated as UNREACHABLE (fatal).
 */
const RESOLVER_CHAIN = ['8.8.8.8', '1.1.1.1', '9.9.9.9'] as const;

// Standard DNSBL self-test IP: reversed 127.0.0.2 → '2.0.0.127'.
// Every well-behaved DNSBL publishes a listing for 127.0.0.2 so clients
// can verify the zone is reachable.
const CANARY_REVERSED = '2.0.0.127';

/**
 * Find the first resolver in RESOLVER_CHAIN that returns a positive
 * canary listing for the given zone. Returns null if every resolver fails
 * the canary — in which case the zone is UNREACHABLE from this host.
 */
async function pickResolverWithLiveZone(
  zone: string,
  timeoutMs: number
): Promise<string | null> {
  for (const resolverIP of RESOLVER_CHAIN) {
    const canary = await queryZone(CANARY_REVERSED, zone, resolverIP, timeoutMs);
    if (canary.kind === 'listed') {
      return resolverIP;
    }
  }
  return null;
}

/**
 * Check a single IP against ALL DNSBL zones in parallel.
 *
 * PATCH 20: Zero tolerance — ANY listing on ANY zone triggers re-roll.
 * Previously only fatal zones triggered re-roll. Now ALL are fatal.
 *
 * Hard Lesson #98: UCEPROTECT L2 was missed because we only checked L1.
 * Now checks ~40 zones covering everything MXToolbox reports on.
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
      // Step 1 (Gate 0 regression A, 2026-04-17): Check DB-backed liveness
      // cache. `isDnsblZoneLive` queries all 3 resolvers with the canary
      // (127.0.0.2) and caches the result for 6h. If the zone is confirmed
      // dead for ≥24h continuously, it's treated as decommissioned and
      // SKIPPED (not counted as a listing) — previously a transient
      // 3-resolver glitch would nuke fresh IPs with ZONE_UNREACHABLE.
      let liveness: Awaited<ReturnType<typeof isDnsblZoneLive>>;
      try {
        liveness = await isDnsblZoneLive(zone, { timeoutMs: TIMEOUT_MS });
      } catch (err) {
        // Cache lookup itself failed catastrophically — fall back to the
        // old behavior (fail-closed). This branch should be unreachable
        // because isDnsblZoneLive swallows its own DB errors.
        console.warn(
          `[ip-blacklist] isDnsblZoneLive threw unexpectedly for ${zone}: ${
            err instanceof Error ? err.message : String(err)
          }. Failing closed.`
        );
        return {
          zone,
          name,
          fatal: true,
          response: 'ZONE_UNREACHABLE' as string | null,
          unreachable: true as const,
        };
      }

      if (!liveness.live) {
        // Zone has been dead across all 3 resolvers for ≥24h continuously.
        // Skip silently — a genuinely decommissioned DNSBL should not
        // permanently block new IP provisioning. NOT fatal, NOT counted.
        console.warn(
          `[ip-blacklist] Zone ${zone} (${name}) confirmed dead for ≥24h; ` +
            `skipping (not fatal). Remove from IP_BLACKLISTS if permanent.`
        );
        return {
          zone,
          name,
          fatal: false,
          response: null as string | null,
          unreachable: true as const,
        };
      }

      // Step 2: pick a resolver that saw the zone live (from evidence),
      // falling back to the first resolver if none did (grace-window case
      // where all 3 returned NXDOMAIN but we haven't tripped the fail-safe).
      const livingResolver =
        RESOLVER_CHAIN.find((r) => liveness.evidence[r] === 'listed') ??
        RESOLVER_CHAIN[0];

      // Step 3: query the real IP using the picked resolver.
      const r = await queryZone(reversed, zone, livingResolver, TIMEOUT_MS);
      if (r.kind === 'listed') {
        return {
          zone,
          name,
          fatal: true,
          response: r.response as string | null,
          unreachable: false as const,
        };
      }
      // nxdomain, empty, error, or timeout on the real IP — treat as clean.
      return {
        zone,
        name,
        fatal: true,
        response: null as string | null,
        unreachable: false as const,
      };
    })
  );

  const listings = results
    .filter((r) => r.response !== null)
    .map((r) => ({ zone: r.zone, name: r.name, fatal: true, response: r.response! }));

  return {
    ip,
    listed: listings.length > 0,
    fatalListed: listings.length > 0, // ALL listings are fatal
    listings,
  };
}

// ============================================================================
// Pair subnet-diversity check (Hard Lesson: pair #N / savini.info, 2026-04-16)
// ============================================================================
//
// Pair IPs MUST NOT share the same subnet. Shared-subnet pairs are dangerous
// because (a) spam blocklists frequently list at /24 or /16, so one dirty
// IP can poison the whole pair; (b) receiving MTAs correlate sending IPs
// by /16 /12 reputation; (c) Linode's regional allocations are adjacent
// /16s inside the same /12 block, so even "different region" pairs like
// us-mia + us-lax can share a /12 and behave as one reputation pool.
//
// Concrete example that triggered this rule:
//   savini.info pair 2026-04-16:
//     s1 = 172.235.148.223  (us-mia)
//     s2 = 172.239.72.108   (us-lax)
//   Different /24, different /16 — but both live in 172.224.0.0/12, i.e.
//   the same Linode /12 allocation block. That is "same subnet" for cold
//   email purposes and the pair was rejected.
//
// Default threshold: /12. Any pair whose IPs fall in the same /12 is
// rejected and the create_vps re-roll loop deletes both servers and tries
// again. Rationale for /12 over /16:
//   - /16 would accept the savini pair above (different /16) even though
//     it is an obviously related block.
//   - /12 is strict enough to force genuinely different allocations, and
//     Linode publishes IPs across many distinct /12s so this is still
//     satisfiable within a handful of re-rolls.
//
// This is separate from the DNSBL check. A pair can fail EITHER check
// independently.

/**
 * Convert a dotted-quad IPv4 string to a 32-bit unsigned integer.
 * Throws on malformed input.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Return true if two IPv4 addresses fall inside the same CIDR block at
 * the given prefix length. prefixBits must be 0..32.
 *
 * Examples:
 *   sharesSubnet("10.0.0.1", "10.0.0.254", 24)           -> true
 *   sharesSubnet("172.235.148.223", "172.239.72.108", 16) -> false (different /16)
 *   sharesSubnet("172.235.148.223", "172.239.72.108", 12) -> true  (same /12)
 *   sharesSubnet("172.235.148.223", "172.239.72.108", 8)  -> true  (same /8)
 */
export function sharesSubnet(ip1: string, ip2: string, prefixBits: number): boolean {
  if (prefixBits < 0 || prefixBits > 32) {
    throw new Error(`prefixBits must be 0..32, got ${prefixBits}`);
  }
  if (prefixBits === 0) return true; // everything is in 0.0.0.0/0
  const a = ipv4ToInt(ip1);
  const b = ipv4ToInt(ip2);
  const mask = (0xFFFFFFFF << (32 - prefixBits)) >>> 0;
  return (a & mask) === (b & mask);
}

/**
 * Default threshold for "same subnet" rejection between pair servers.
 * /12 catches Linode's adjacent /16 allocations that would otherwise slip
 * through a textbook /16 check. See header comment for rationale.
 */
export const PAIR_SUBNET_MIN_PREFIX = 12;

/**
 * Convenience wrapper: returns true if the two IPs violate pair subnet
 * diversity (i.e., share PAIR_SUBNET_MIN_PREFIX bits of network prefix).
 */
export function pairSharesSubnet(ip1: string, ip2: string): boolean {
  return sharesSubnet(ip1, ip2, PAIR_SUBNET_MIN_PREFIX);
}
