/**
 * Step 9: await_auth_dns — 10-resolver consensus gate before LE issuance.
 *
 * Inserted between await_s2_dns (step 8) and security_hardening (step 10)
 * during Session 04b. Root cause of Session 04's LE silent-exit was that
 * security_hardening issued LE certs immediately after setup_dns_zones /
 * setup_mail_domains without a broad propagation check. LE's distributed
 * validation hits multiple POPs in different continents; a record visible
 * on Google DNS but not on Quad9 or DNS.WATCH (EU) will fail validation,
 * and the 5/hour/hostname failed-validation cap trips after 3 attempts.
 *
 * Consensus: ≥7/10 resolvers must return the expected value for each
 * required record. Tolerates 3 stale or temporarily down resolvers (30%).
 *
 * Hard-fails the saga on timeout — no LE issuance against un-propagated DNS.
 *
 * HL #R3 (Session 04b).
 */

import type { SSHManager } from '../ssh-manager';

export interface AwaitAuthDnsParams {
  ssh1: SSHManager;
  nsDomain: string;
  server1IP: string;
  server2IP: string;
  server1Domains: string[];
  server2Domains: string[];
  log: (msg: string) => void;
  /** Override for testing — skip the poll loop after this many iterations. */
  maxIterations?: number;
  /** Override for testing — shorten the timeout (default 30 min). */
  timeoutMs?: number;
}

export interface AwaitAuthDnsResult {
  success: boolean;
  output: string;
  metadata: {
    iterations: number;
    elapsedSec: number;
    expectationsTotal: number;
    expectationsPassed: number;
    failures: string[];
  };
  error?: string;
}

/**
 * 10 resolvers from 9 distinct operators. Includes EU (DNS.WATCH) and
 * multiple Quad9/Umbrella POPs for geographic + anycast diversity.
 * See session 04b prompt P2.5 for operator rationale.
 */
export const CONSENSUS_RESOLVERS: readonly string[] = [
  '1.1.1.1',         // Cloudflare
  '8.8.8.8',         // Google Public DNS
  '9.9.9.9',         // Quad9 primary (DNSSEC validating)
  '149.112.112.112', // Quad9 secondary (different anycast POPs)
  '208.67.222.222',  // OpenDNS / Cisco Umbrella canonical
  '208.67.222.220',  // Cisco Umbrella FamilyShield (different service)
  '156.154.70.64',   // Vercara / UltraDNS Public
  '205.171.202.66',  // Lumen / CenturyLink
  '64.6.64.6',       // Verisign Public DNS (registry operator)
  '84.200.69.80',    // DNS.WATCH (DE — EU geographic diversity)
];

export const MIN_CONSENSUS = 7;
export const DEFAULT_TIMEOUT_MS = 30 * 60_000; // 30 minutes
const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 120_000;

type RecordType = 'A' | 'MX' | 'TXT';

interface Expectation {
  name: string;
  type: RecordType;
  descr: string;
  expected: (values: string[]) => boolean;
}

function buildExpectations(params: {
  nsDomain: string;
  server1IP: string;
  server2IP: string;
  server1Domains: string[];
  server2Domains: string[];
}): Expectation[] {
  const { nsDomain, server1IP, server2IP, server1Domains, server2Domains } = params;
  const exps: Expectation[] = [];

  // NS domain apex + glue hosts. Root A on S1; ns1/mail1 on S1; ns2/mail2 on S2.
  exps.push({ name: nsDomain, type: 'A', descr: `${nsDomain} A`, expected: (v) => v.includes(server1IP) });
  exps.push({ name: `ns1.${nsDomain}`, type: 'A', descr: `ns1.${nsDomain} A`, expected: (v) => v.includes(server1IP) });
  exps.push({ name: `ns2.${nsDomain}`, type: 'A', descr: `ns2.${nsDomain} A`, expected: (v) => v.includes(server2IP) });
  exps.push({ name: `mail1.${nsDomain}`, type: 'A', descr: `mail1.${nsDomain} A`, expected: (v) => v.includes(server1IP) });
  exps.push({ name: `mail2.${nsDomain}`, type: 'A', descr: `mail2.${nsDomain} A`, expected: (v) => v.includes(server2IP) });

  // Sending domains — A + MX pointing to owning server's mail host.
  const pushSendingDomain = (domain: string, serverIP: string, mailHost: string) => {
    exps.push({ name: domain, type: 'A', descr: `${domain} A`, expected: (v) => v.includes(serverIP) });
    exps.push({
      name: domain,
      type: 'MX',
      descr: `${domain} MX → ${mailHost}`,
      expected: (v) => v.some((r) => r.toLowerCase().includes(mailHost.toLowerCase())),
    });
    exps.push({
      name: domain,
      type: 'TXT',
      descr: `${domain} SPF`,
      expected: (v) => v.some((r) => r.includes('v=spf1')),
    });
    exps.push({
      name: `mail._domainkey.${domain}`,
      type: 'TXT',
      descr: `${domain} DKIM`,
      expected: (v) => v.some((r) => r.includes('v=DKIM1')),
    });
    exps.push({
      name: `_dmarc.${domain}`,
      type: 'TXT',
      descr: `${domain} DMARC`,
      expected: (v) => v.some((r) => r.includes('v=DMARC1')),
    });
  };

  for (const d of server1Domains) pushSendingDomain(d, server1IP, `mail1.${nsDomain}`);
  for (const d of server2Domains) pushSendingDomain(d, server2IP, `mail2.${nsDomain}`);

  return exps;
}

/**
 * Query one resolver for one record via dig over SSH. Returns the parsed
 * values, or [] on timeout/error. `dig +short` strips formatting — TXT
 * records still come back quoted, so callers that care about exact content
 * must handle quote-stripping (verification-checks.ts's normalizeTxtRecord
 * is the canonical helper). For consensus checking, the expectation
 * predicates all use `.includes()` which is quote-tolerant.
 */
async function queryOneResolver(
  ssh: SSHManager,
  resolverIp: string,
  name: string,
  type: RecordType
): Promise<string[]> {
  try {
    const cmd = `dig +short ${name} ${type} @${resolverIp} 2>/dev/null`;
    const { stdout } = await ssh.exec(cmd, { timeout: 8000 });
    return stdout
      .trim()
      .split('\n')
      .map((s: string) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function runAwaitAuthDns(
  params: AwaitAuthDnsParams
): Promise<AwaitAuthDnsResult> {
  const {
    ssh1,
    nsDomain,
    server1IP,
    server2IP,
    server1Domains,
    server2Domains,
    log,
    maxIterations = Infinity,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  const expectations = buildExpectations({
    nsDomain,
    server1IP,
    server2IP,
    server1Domains,
    server2Domains,
  });

  log(
    `[await_auth_dns] Checking ${expectations.length} expectations across ` +
      `${CONSENSUS_RESOLVERS.length} resolvers (≥${MIN_CONSENSUS}/${CONSENSUS_RESOLVERS.length} consensus required, ${timeoutMs / 60_000} min timeout)`
  );

  const start = Date.now();
  let iteration = 0;
  let pollIntervalMs = MIN_POLL_INTERVAL_MS;
  let lastFailures: string[] = [];

  while (Date.now() - start < timeoutMs && iteration < maxIterations) {
    iteration++;
    const iterStart = Date.now();
    const failures: string[] = [];
    let passed = 0;

    for (const exp of expectations) {
      // Query all resolvers for this expectation in parallel. node-ssh
      // multiplexes concurrent exec over one connection, so 10 parallel
      // digs on ssh1 run in ~1s wall time.
      const results = await Promise.all(
        CONSENSUS_RESOLVERS.map((resolver) =>
          queryOneResolver(ssh1, resolver, exp.name, exp.type).then((vals) => exp.expected(vals))
        )
      );
      const agreeing = results.filter(Boolean).length;
      if (agreeing >= MIN_CONSENSUS) {
        passed++;
      } else {
        failures.push(`${exp.descr}: ${agreeing}/${CONSENSUS_RESOLVERS.length} resolvers agree`);
      }
    }

    const iterSec = Math.round((Date.now() - iterStart) / 1000);
    const elapsedSec = Math.round((Date.now() - start) / 1000);

    if (failures.length === 0) {
      const output = `All ${expectations.length} expectations converged on ≥${MIN_CONSENSUS}/${CONSENSUS_RESOLVERS.length} resolvers in ${iteration} iterations (${elapsedSec}s).`;
      log(`[await_auth_dns] ${output}`);
      return {
        success: true,
        output,
        metadata: {
          iterations: iteration,
          elapsedSec,
          expectationsTotal: expectations.length,
          expectationsPassed: passed,
          failures: [],
        },
      };
    }

    lastFailures = failures;
    log(
      `[await_auth_dns] Iteration ${iteration}: ${passed}/${expectations.length} passed, ` +
        `${failures.length} below consensus (iter ${iterSec}s, total ${elapsedSec}s). ` +
        `Top 3: ${failures.slice(0, 3).join(' | ')}. Sleeping ${pollIntervalMs / 1000}s.`
    );

    if (Date.now() - start + pollIntervalMs >= timeoutMs) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    pollIntervalMs = Math.min(pollIntervalMs * 2, MAX_POLL_INTERVAL_MS);
  }

  const elapsedSec = Math.round((Date.now() - start) / 1000);
  const error = `await_auth_dns timed out after ${elapsedSec}s (${iteration} iterations). ${lastFailures.length} expectations never reached consensus. LE issuance blocked.`;
  log(`[await_auth_dns] ${error}`);
  log(`[await_auth_dns] Residual failures: ${lastFailures.join(' | ')}`);

  return {
    success: false,
    output: error,
    metadata: {
      iterations: iteration,
      elapsedSec,
      expectationsTotal: expectations.length,
      expectationsPassed: expectations.length - lastFailures.length,
      failures: lastFailures,
    },
    error,
  };
}
