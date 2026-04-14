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
      const response = await queryZone(reversed, zone, TIMEOUT_MS);
      return { zone, name, fatal: true, response }; // ALL are fatal
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
