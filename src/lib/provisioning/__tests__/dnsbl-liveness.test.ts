/**
 * DNSBL zone liveness cache tests
 *
 * Covers the 24h fail-safe cache that sits in front of the create_vps
 * DNSBL canary check. We never hit real DNS or real Supabase — both the
 * resolver and the DB layer are injected via opts.
 *
 * Test matrix:
 *   1. all-live              — 3 resolvers 'listed'        => live=true
 *   2. 1-of-3 live           — 1 'listed' + 2 'timeout'    => live=true
 *   3. 3-of-3 dead <24h      — all NXDOMAIN, within grace  => live=true
 *   4. 3-of-3 dead >=24h     — all NXDOMAIN, past 24h      => live=false
 */

import {
  isDnsblZoneLive,
  type DnsblLivenessRow,
  type DnsblLivenessDbAdapter,
  type DnsblResolveFn,
  type ZoneQueryOutcome,
} from '../dnsbl-liveness';

// ============================================
// Test helpers
// ============================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

/**
 * In-memory DB adapter used by every test. Exposes the internal map so
 * tests can seed prior state (e.g. first_seen_dead set 25h ago) before
 * calling isDnsblZoneLive.
 */
function createMemoryDb(): DnsblLivenessDbAdapter & {
  rows: Map<string, DnsblLivenessRow>;
} {
  const rows = new Map<string, DnsblLivenessRow>();
  return {
    rows,
    async get(zone) {
      return rows.get(zone) ?? null;
    },
    async upsert(row) {
      rows.set(row.zone, row);
    },
  };
}

/**
 * Build a resolveFn that returns a fixed outcome per resolver IP.
 * Resolver IPs are the 3 entries in RESOLVER_CHAIN: 8.8.8.8, 1.1.1.1, 9.9.9.9.
 */
function fakeResolver(
  outcomes: Record<string, ZoneQueryOutcome>
): DnsblResolveFn {
  return async (resolverIP) => {
    const o = outcomes[resolverIP];
    if (!o) {
      throw new Error(`fakeResolver: no outcome configured for ${resolverIP}`);
    }
    return o;
  };
}

// ============================================
// Test cases
// ============================================

async function testAllLive(): Promise<void> {
  const db = createMemoryDb();
  const resolveFn = fakeResolver({
    '8.8.8.8': 'listed',
    '1.1.1.1': 'listed',
    '9.9.9.9': 'listed',
  });

  const result = await isDnsblZoneLive('zen.spamhaus.org', {
    dbAdapter: db,
    resolveFn,
  });

  assert(result.live === true, 'all-live should return live=true');
  assert(result.cached === false, 'fresh probe should not be cached');
  assert(
    result.evidence['8.8.8.8'] === 'listed',
    'evidence for 8.8.8.8 should be listed'
  );
  assert(
    result.evidence['1.1.1.1'] === 'listed',
    'evidence for 1.1.1.1 should be listed'
  );
  assert(
    result.evidence['9.9.9.9'] === 'listed',
    'evidence for 9.9.9.9 should be listed'
  );

  const persisted = db.rows.get('zen.spamhaus.org');
  assert(persisted !== undefined, 'row should be persisted');
  assert(persisted!.live === true, 'persisted row should be live');
  assert(
    persisted!.first_seen_dead === null,
    'first_seen_dead should be null when any resolver sees listed'
  );

  console.log('✓ all-live: 3 resolvers listed => live=true');
}

async function testOneOfThreeLive(): Promise<void> {
  const db = createMemoryDb();
  const resolveFn = fakeResolver({
    '8.8.8.8': 'listed',
    '1.1.1.1': 'timeout',
    '9.9.9.9': 'timeout',
  });

  const result = await isDnsblZoneLive('bl.spamcop.net', {
    dbAdapter: db,
    resolveFn,
  });

  assert(result.live === true, '1-of-3 listed should return live=true');
  assert(result.evidence['8.8.8.8'] === 'listed', 'first resolver listed');
  assert(result.evidence['1.1.1.1'] === 'timeout', 'second resolver timeout');
  assert(result.evidence['9.9.9.9'] === 'timeout', 'third resolver timeout');

  const persisted = db.rows.get('bl.spamcop.net');
  assert(persisted!.live === true, 'persisted row should be live');
  assert(
    persisted!.first_seen_dead === null,
    'any listed should clear first_seen_dead'
  );

  console.log('✓ 1-of-3 live: any listed = live=true');
}

async function testAllDeadWithinGrace(): Promise<void> {
  const db = createMemoryDb();
  const zone = 'dnsbl-1.uceprotect.net';
  const resolveFn = fakeResolver({
    '8.8.8.8': 'nxdomain',
    '1.1.1.1': 'nxdomain',
    '9.9.9.9': 'nxdomain',
  });

  // ----- Call #1: no prior row. first_seen_dead gets set to NOW,
  //       but we're within grace so live=true. -----
  const t0 = new Date('2026-04-17T00:00:00.000Z');
  const r1 = await isDnsblZoneLive(zone, {
    dbAdapter: db,
    resolveFn,
    now: () => t0,
  });

  assert(r1.live === true, 'first all-NXDOMAIN should still be live (grace)');
  assert(r1.cached === false, 'first call is a fresh probe');

  const row1 = db.rows.get(zone);
  assert(row1 !== undefined, 'row should be written');
  assert(
    row1!.first_seen_dead === t0.toISOString(),
    'first_seen_dead should be set to t0 on first all-NXDOMAIN'
  );
  assert(row1!.live === true, 'persisted live=true within grace');

  // ----- Call #2: manually rewind first_seen_dead to 12h before the
  //       observation time. We also rewind last_checked so the cache TTL
  //       (6h) doesn't short-circuit the probe. Expect: still live. -----
  const t1 = new Date('2026-04-17T15:00:00.000Z'); // observation time
  const twelveHoursAgo = new Date(t1.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const sevenHoursAgo = new Date(t1.getTime() - 7 * 60 * 60 * 1000).toISOString();
  db.rows.set(zone, {
    ...row1!,
    first_seen_dead: twelveHoursAgo,
    last_checked: sevenHoursAgo, // outside the 6h cache TTL -> force re-probe
  });

  const r2 = await isDnsblZoneLive(zone, {
    dbAdapter: db,
    resolveFn,
    now: () => t1,
  });

  assert(r2.live === true, '12h dead should still be live (within 24h grace)');
  const row2 = db.rows.get(zone);
  assert(
    row2!.first_seen_dead === twelveHoursAgo,
    'first_seen_dead should be preserved, not reset'
  );
  assert(row2!.live === true, 'persisted live=true at 12h dead');

  console.log('✓ 3-of-3 dead <24h: live=true (within grace)');
}

async function testAllDeadPastFailSafe(): Promise<void> {
  const db = createMemoryDb();
  const zone = 'spam.dnsbl.sorbs.net';
  const resolveFn = fakeResolver({
    '8.8.8.8': 'nxdomain',
    '1.1.1.1': 'nxdomain',
    '9.9.9.9': 'nxdomain',
  });

  const now = new Date('2026-04-17T00:00:00.000Z');
  const twentyFiveHoursAgo = new Date(
    now.getTime() - 25 * 60 * 60 * 1000
  ).toISOString();
  const sevenHoursAgo = new Date(
    now.getTime() - 7 * 60 * 60 * 1000
  ).toISOString();

  // Seed: we've been observing this zone dead for 25h, past the 24h fail-safe.
  // last_checked is 7h ago so the 6h cache TTL doesn't short-circuit.
  db.rows.set(zone, {
    zone,
    last_checked: sevenHoursAgo,
    live: true,
    sample_ip: '127.0.0.2',
    evidence: {
      '8.8.8.8': 'nxdomain',
      '1.1.1.1': 'nxdomain',
      '9.9.9.9': 'nxdomain',
    },
    first_seen_dead: twentyFiveHoursAgo,
    updated_at: sevenHoursAgo,
  });

  const result = await isDnsblZoneLive(zone, {
    dbAdapter: db,
    resolveFn,
    now: () => now,
  });

  assert(
    result.live === false,
    '25h dead past 24h fail-safe should return live=false'
  );
  assert(result.cached === false, 'fresh probe, not cached');

  const persisted = db.rows.get(zone);
  assert(persisted!.live === false, 'persisted live=false past fail-safe');
  assert(
    persisted!.first_seen_dead === twentyFiveHoursAgo,
    'first_seen_dead should remain the original dead-observation timestamp'
  );

  console.log('✓ 3-of-3 dead >=24h: live=false (fail-safe tripped)');
}

// ============================================
// Runner
// ============================================

export async function testDnsblLiveness(): Promise<void> {
  console.log('\n=== DNSBL Zone Liveness Cache Tests ===\n');
  await testAllLive();
  await testOneOfThreeLive();
  await testAllDeadWithinGrace();
  await testAllDeadPastFailSafe();
  console.log('\n=== DNSBL Liveness: ALL PASSED ===\n');
}

async function main(): Promise<void> {
  try {
    await testDnsblLiveness();
    console.log('ALL TESTS PASSED ✓');
    process.exit(0);
  } catch (err) {
    console.error('\nTEST FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
