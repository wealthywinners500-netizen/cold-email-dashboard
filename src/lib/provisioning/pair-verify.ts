// ============================================
// In-app Pair Verify — on-demand deliverability audit
//
// Runs four checks IN PARALLEL against a server_pair + up to 2 sending_domains:
//   a) MXToolbox Domain Health   (remote HTTP API; 5xx → warn, not red)
//   b) Multi-resolver PTR        (8.8.8.8 / 1.1.1.1 / 9.9.9.9 must all match)
//   c) DNS propagation           (A/MX/SPF/_dmarc consistent across 3 resolvers)
//   d) Operational blacklist sweep
//       OPERATIONAL = hard-fail (Spamhaus SBL/DBL, Barracuda, Invaluement)
//       SEM         = complaint-based, tolerated (SORBS SPAM, UCEPROTECT L3)
//
// Deliberately does NOT edit verification.ts's WARN_ONLY_BLACKLISTS —
// that set tunes the provisioning gate (Barracuda warn-only on Linode).
// For pair_verify the spec is different: Barracuda is operational-red.
// ============================================

import dnsPromises from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================
// Blacklist classification — OUR local rules, NOT verification.ts's
// ============================================

export const OPERATIONAL_BLACKLISTS = new Set<string>([
  'Spamhaus SBL',
  'Spamhaus DBL',
  'Barracuda',
  'Invaluement SIP',
]);

export const SEM_BLACKLISTS = new Set<string>([
  'SORBS SPAM',
  'UCEPROTECT L3',
]);

interface DnsblZone {
  zone: string;
  name: string;
  classification: 'operational' | 'sem';
  target: 'ip' | 'domain';
}

// Zones we actually query in the sweep. SEM zones are intentionally NOT
// in this list for the pair_verify flow — we don't want SEM warnings to
// fire on a healthy pair, and the spec explicitly says SEM lists are
// "tolerated". We keep SEM_BLACKLISTS exported for classification if
// an MXToolbox response mentions them.
const PAIR_VERIFY_ZONES: DnsblZone[] = [
  { zone: 'sbl.spamhaus.org',     name: 'Spamhaus SBL',    classification: 'operational', target: 'ip' },
  { zone: 'dbl.spamhaus.org',     name: 'Spamhaus DBL',    classification: 'operational', target: 'domain' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda',     classification: 'operational', target: 'ip' },
  { zone: 'sip.invaluement.com',  name: 'Invaluement SIP', classification: 'operational', target: 'ip' },
];

// The three resolvers the spec mandates.
const RESOLVERS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];

// ============================================
// Types
// ============================================

export type CheckResult = 'pass' | 'fail' | 'warn';

export interface PairVerifyCheck {
  name: string;
  result: CheckResult;
  details: Record<string, unknown>;
  is_sem_warning: boolean;
}

export type PairVerifyStatus = 'green' | 'yellow' | 'red';

export interface PairVerifyReport {
  status: PairVerifyStatus;
  checks: PairVerifyCheck[];
  duration_ms: number;
}

interface PairRow {
  id: string;
  ns_domain: string;
  s1_ip: string;
  s1_hostname: string;
  s2_ip: string;
  s2_hostname: string;
}

interface SendingDomainRow {
  domain: string;
}

// ============================================
// Injected dependency shapes (so tests can avoid the network)
// ============================================

export interface MxtoolboxResult {
  host: string;
  failed: string[];
  warnings: string[];
  passed: string[];
  http_error?: string | null; // populated on 5xx / network error
}

export type MxtoolboxFn = (host: string) => Promise<MxtoolboxResult>;

export interface ResolverAnswer {
  resolver: string;
  values: string[];
  error?: string;
}

/** Reverse-lookup a single IP against a single resolver. Return hostnames (may be []). */
export type ReverseFn = (resolver: string, ip: string) => Promise<string[]>;

/** Forward-resolve a record type against a single resolver. Return values (may be []). */
export type ResolveFn = (
  resolver: string,
  name: string,
  type: 'A' | 'MX' | 'TXT'
) => Promise<string[]>;

/**
 * DNSBL query: does `queryName.<zone>` resolve to an A record?
 * Returns the A record strings (any value means 'listed'), [] means not listed.
 */
export type DnsblQueryFn = (queryName: string, zone: string) => Promise<string[]>;

export interface PairVerifyDeps {
  mxtoolbox: MxtoolboxFn;
  reverse: ReverseFn;
  resolve: ResolveFn;
  dnsbl: DnsblQueryFn;
}

// ============================================
// Default dependencies (used in production)
// ============================================

function makeResolver(resolverIp: string): dnsPromises.Resolver {
  const r = new dnsPromises.Resolver();
  r.setServers([resolverIp]);
  return r;
}

const defaultReverse: ReverseFn = async (resolver, ip) => {
  const r = makeResolver(resolver);
  try {
    return await r.reverse(ip);
  } catch {
    return [];
  }
};

const defaultResolve: ResolveFn = async (resolver, name, type) => {
  const r = makeResolver(resolver);
  try {
    if (type === 'A') {
      return await r.resolve4(name);
    }
    if (type === 'MX') {
      const mx = await r.resolveMx(name);
      return mx.map((m) => `${m.priority} ${m.exchange}`);
    }
    const txt = await r.resolveTxt(name);
    return txt.map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
};

const defaultDnsbl: DnsblQueryFn = async (queryName, zone) => {
  const r = makeResolver('8.8.8.8');
  try {
    return await r.resolve4(`${queryName}.${zone}`);
  } catch {
    return [];
  }
};

const defaultMxtoolbox: MxtoolboxFn = async (host) => {
  const key = process.env.MXTOOLBOX_API_KEY;
  if (!key) {
    // No key configured — surface as http_error so the check lands in 'warn'.
    return { host, failed: [], warnings: [], passed: [], http_error: 'MXTOOLBOX_API_KEY not set' };
  }
  const url = `https://mxtoolbox.com/api/v1/Lookup/domain/?argument=${encodeURIComponent(host)}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: key },
    });
    if (resp.status >= 500) {
      return { host, failed: [], warnings: [], passed: [], http_error: `HTTP ${resp.status}` };
    }
    if (!resp.ok) {
      return { host, failed: [], warnings: [], passed: [], http_error: `HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as {
      Failed?: Array<{ Name?: string; Info?: string }>;
      Warnings?: Array<{ Name?: string; Info?: string }>;
      Passed?: Array<{ Name?: string; Info?: string }>;
    };
    const toNames = (arr: Array<{ Name?: string; Info?: string }> | undefined): string[] =>
      (arr ?? []).map((x) => x.Name ?? x.Info ?? 'unknown').filter((s): s is string => !!s);
    return {
      host,
      failed: toNames(body.Failed),
      warnings: toNames(body.Warnings),
      passed: toNames(body.Passed),
      http_error: null,
    };
  } catch (err) {
    return {
      host,
      failed: [],
      warnings: [],
      passed: [],
      http_error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const defaultPairVerifyDeps: PairVerifyDeps = {
  mxtoolbox: defaultMxtoolbox,
  reverse: defaultReverse,
  resolve: defaultResolve,
  dnsbl: defaultDnsbl,
};

// ============================================
// Individual checks
// ============================================

/**
 * MXToolbox Domain Health check.
 * Queries the pair's ns_domain (acts as hostname) plus the 2 sending domains.
 * On 5xx / network error: returns warn. Never operational-red.
 */
async function runMxtoolboxCheck(
  hosts: string[],
  mxtoolbox: MxtoolboxFn
): Promise<PairVerifyCheck> {
  const results = await Promise.all(hosts.map((h) => mxtoolbox(h)));

  const anyHttpError = results.find((r) => r.http_error);
  if (anyHttpError) {
    return {
      name: 'mxtoolbox_domain_health',
      result: 'warn',
      details: {
        http_error: anyHttpError.http_error,
        hosts,
        retry_guidance:
          'MXToolbox unreachable — re-run the verification in a few minutes. No operational signal was produced.',
      },
      is_sem_warning: false,
    };
  }

  const hasFailures = results.some((r) => r.failed.length > 0);
  const hasWarnings = results.some((r) => r.warnings.length > 0);

  if (hasFailures) {
    return {
      name: 'mxtoolbox_domain_health',
      result: 'fail',
      details: { per_host: results },
      is_sem_warning: false,
    };
  }

  if (hasWarnings) {
    return {
      name: 'mxtoolbox_domain_health',
      result: 'warn',
      details: { per_host: results },
      is_sem_warning: false,
    };
  }

  return {
    name: 'mxtoolbox_domain_health',
    result: 'pass',
    details: { per_host: results },
    is_sem_warning: false,
  };
}

/**
 * Multi-resolver PTR alignment.
 * For each pair IP: query PTR against all 3 resolvers. All three must return
 * a set that INCLUDES the pair's recorded hostname (s1/s2_hostname).
 */
async function runPtrCheck(
  ip1: string,
  host1: string,
  ip2: string,
  host2: string,
  reverse: ReverseFn
): Promise<PairVerifyCheck> {
  const pairs: Array<{ ip: string; host: string }> = [
    { ip: ip1, host: host1 },
    { ip: ip2, host: host2 },
  ];

  type PerResolver = { resolver: string; hostnames: string[]; matches: boolean };
  type PerIp = { ip: string; expected: string; resolvers: PerResolver[]; all_match: boolean };

  const perIp: PerIp[] = await Promise.all(
    pairs.map(async ({ ip, host }) => {
      const perResolver: PerResolver[] = await Promise.all(
        RESOLVERS.map(async (resolver) => {
          const hostnames = await reverse(resolver, ip);
          const norm = host.toLowerCase().replace(/\.$/, '');
          const matches = hostnames.some(
            (h) => h.toLowerCase().replace(/\.$/, '') === norm
          );
          return { resolver, hostnames, matches };
        })
      );
      const allMatch = perResolver.every((r) => r.matches);
      return { ip, expected: host, resolvers: perResolver, all_match: allMatch };
    })
  );

  const allPass = perIp.every((p) => p.all_match);

  return {
    name: 'multi_resolver_ptr',
    result: allPass ? 'pass' : 'fail',
    details: { per_ip: perIp },
    is_sem_warning: false,
  };
}

/**
 * DNS propagation check.
 * For each sending domain: fetch A / MX / TXT(SPF) / TXT(_dmarc) across the
 * 3 resolvers. Each record type must be (a) non-empty and (b) consistent
 * across all resolvers that returned an answer.
 */
async function runDnsPropagationCheck(
  domains: string[],
  resolve: ResolveFn
): Promise<PairVerifyCheck> {
  if (domains.length === 0) {
    return {
      name: 'dns_propagation',
      result: 'warn',
      details: { note: 'No sending domains attached to pair — nothing to verify.' },
      is_sem_warning: false,
    };
  }

  type RecordCheck = {
    recordType: string;
    queryName: string;
    per_resolver: Array<{ resolver: string; values: string[] }>;
    consistent: boolean;
    non_empty: boolean;
  };
  type PerDomain = { domain: string; records: RecordCheck[]; ok: boolean };

  const perDomain: PerDomain[] = await Promise.all(
    domains.map(async (domain) => {
      const targets: Array<{ type: 'A' | 'MX' | 'TXT'; name: string; label: string }> = [
        { type: 'A', name: domain, label: 'A' },
        { type: 'MX', name: domain, label: 'MX' },
        { type: 'TXT', name: domain, label: 'TXT(SPF)' },
        { type: 'TXT', name: `_dmarc.${domain}`, label: 'TXT(_dmarc)' },
      ];

      const records: RecordCheck[] = await Promise.all(
        targets.map(async ({ type, name, label }) => {
          const perResolver = await Promise.all(
            RESOLVERS.map(async (resolver) => ({
              resolver,
              values: await resolve(resolver, name, type),
            }))
          );

          // For SPF we only count records starting with v=spf1; for DMARC
          // only records starting with v=DMARC1. Other TXT values shouldn't
          // be treated as "found".
          const filtered = perResolver.map((r) => ({
            resolver: r.resolver,
            values:
              label === 'TXT(SPF)'
                ? r.values.filter((v) => v.toLowerCase().startsWith('v=spf1'))
                : label === 'TXT(_dmarc)'
                ? r.values.filter((v) => v.toLowerCase().startsWith('v=dmarc1'))
                : r.values,
          }));

          const withData = filtered.filter((r) => r.values.length > 0);
          const nonEmpty = withData.length === filtered.length;
          const consistent =
            withData.length <= 1 ||
            withData.every(
              (r) =>
                JSON.stringify([...r.values].sort()) ===
                JSON.stringify([...withData[0].values].sort())
            );
          return {
            recordType: label,
            queryName: name,
            per_resolver: filtered,
            consistent,
            non_empty: nonEmpty,
          };
        })
      );

      const ok = records.every((r) => r.consistent && r.non_empty);
      return { domain, records, ok };
    })
  );

  const allOk = perDomain.every((d) => d.ok);

  return {
    name: 'dns_propagation',
    result: allOk ? 'pass' : 'fail',
    details: { per_domain: perDomain },
    is_sem_warning: false,
  };
}

/**
 * Operational blacklist sweep.
 * SBL + Barracuda + Invaluement: query both pair IPs (reversed octets).
 * DBL: query the 2 sending-domain A records — but the DBL zone is a
 * domain-side zone, so we query the domain directly.
 *
 * SEM zones are intentionally NOT queried here — the spec requires
 * "tolerated" SEM warnings to not fire when the pair is clean.
 */
async function runBlacklistSweep(
  ip1: string,
  ip2: string,
  sendingDomains: string[],
  dnsbl: DnsblQueryFn
): Promise<PairVerifyCheck> {
  const reverseIp = (ip: string) => ip.split('.').reverse().join('.');

  type Hit = {
    zone_name: string;
    classification: 'operational' | 'sem';
    target: string;
    response: string[];
  };

  const listings: Hit[] = [];

  await Promise.all(
    PAIR_VERIFY_ZONES.map(async (z) => {
      if (z.target === 'ip') {
        await Promise.all(
          [ip1, ip2].map(async (ip) => {
            const answer = await dnsbl(reverseIp(ip), z.zone);
            if (answer.length > 0) {
              listings.push({
                zone_name: z.name,
                classification: z.classification,
                target: ip,
                response: answer,
              });
            }
          })
        );
      } else {
        await Promise.all(
          sendingDomains.map(async (d) => {
            const answer = await dnsbl(d, z.zone);
            if (answer.length > 0) {
              listings.push({
                zone_name: z.name,
                classification: z.classification,
                target: d,
                response: answer,
              });
            }
          })
        );
      }
    })
  );

  const operationalHits = listings.filter((l) => l.classification === 'operational');

  // If the sweep finds a SEM hit (future-proofing: we don't query SEM zones
  // above, but an external source could classify one), we'd surface as warn.
  const semHits = listings.filter((l) => l.classification === 'sem');

  if (operationalHits.length > 0) {
    return {
      name: 'operational_blacklist_sweep',
      result: 'fail',
      details: { listings },
      is_sem_warning: false,
    };
  }

  if (semHits.length > 0) {
    return {
      name: 'operational_blacklist_sweep',
      result: 'warn',
      details: { listings },
      is_sem_warning: true,
    };
  }

  return {
    name: 'operational_blacklist_sweep',
    result: 'pass',
    details: { listings: [] },
    is_sem_warning: false,
  };
}

// ============================================
// Entry point
// ============================================

/**
 * Build a verification report for a pair. Pure, no direct DB writes — the
 * caller (the pg-boss handler or test harness) is responsible for persisting
 * the returned report.
 *
 * Accepts optional dependency overrides so tests don't touch the network
 * or Supabase — see __tests__/pair-verify.test.ts.
 */
export async function runPairVerification(
  pairId: string,
  supabase: Pick<SupabaseClient, 'from'>,
  deps: Partial<PairVerifyDeps> = {}
): Promise<PairVerifyReport> {
  const start = Date.now();
  const mxtoolbox = deps.mxtoolbox ?? defaultPairVerifyDeps.mxtoolbox;
  const reverse = deps.reverse ?? defaultPairVerifyDeps.reverse;
  const resolve = deps.resolve ?? defaultPairVerifyDeps.resolve;
  const dnsbl = deps.dnsbl ?? defaultPairVerifyDeps.dnsbl;

  // Load the pair
  const { data: pair, error: pairErr } = await supabase
    .from('server_pairs')
    .select('id, ns_domain, s1_ip, s1_hostname, s2_ip, s2_hostname')
    .eq('id', pairId)
    .single();

  if (pairErr || !pair) {
    return {
      status: 'red',
      checks: [
        {
          name: 'load_pair',
          result: 'fail',
          details: { error: pairErr?.message ?? 'pair not found', pairId },
          is_sem_warning: false,
        },
      ],
      duration_ms: Date.now() - start,
    };
  }

  const pairRow = pair as PairRow;

  // Load up to 2 random sending domains. Supabase doesn't have an ORDER BY
  // RANDOM() in the JS client, but we can fetch up to 10 then shuffle.
  const { data: domains } = await supabase
    .from('sending_domains')
    .select('domain')
    .eq('pair_id', pairId)
    .limit(10);

  const allDomains = ((domains ?? []) as SendingDomainRow[]).map((d) => d.domain);
  const shuffled = [...allDomains].sort(() => Math.random() - 0.5);
  const sampleDomains = shuffled.slice(0, 2);

  const mxtoolboxHosts = [pairRow.ns_domain, ...sampleDomains].filter(
    (h, i, arr) => !!h && arr.indexOf(h) === i
  );

  // Run all 4 checks in parallel
  const [mxCheck, ptrCheck, dnsCheck, blCheck] = await Promise.all([
    runMxtoolboxCheck(mxtoolboxHosts, mxtoolbox),
    runPtrCheck(
      pairRow.s1_ip,
      pairRow.s1_hostname,
      pairRow.s2_ip,
      pairRow.s2_hostname,
      reverse
    ),
    runDnsPropagationCheck(sampleDomains, resolve),
    runBlacklistSweep(pairRow.s1_ip, pairRow.s2_ip, sampleDomains, dnsbl),
  ]);

  const checks: PairVerifyCheck[] = [mxCheck, ptrCheck, dnsCheck, blCheck];

  // Status classification
  //   any operational fail            → 'red'
  //   mxtoolbox warn from http_error → 'yellow' (if nothing else failed)
  //   only SEM warnings               → 'green' (with is_sem_warning flags)
  //   otherwise                       → 'green'
  const hasOperationalFail = checks.some(
    (c) => c.result === 'fail' && !c.is_sem_warning
  );

  let status: PairVerifyStatus;
  if (hasOperationalFail) {
    status = 'red';
  } else {
    const mxtHttpError =
      mxCheck.result === 'warn' &&
      typeof (mxCheck.details as Record<string, unknown>).http_error === 'string';
    status = mxtHttpError ? 'yellow' : 'green';
  }

  return {
    status,
    checks,
    duration_ms: Date.now() - start,
  };
}
