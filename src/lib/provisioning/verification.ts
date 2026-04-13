// ============================================
// B15-5: DNS Verification Engine
// Replaces manual MXToolbox/DNSChecker checks
// All checks via direct DNS queries — no external APIs
// ============================================

import dns from 'dns';
import dnsPromises from 'dns/promises';

// --- Result Types ---

export interface ResolverResult {
  resolver: string;
  name: string;
  values: string[];
  error?: string;
}

export interface DNSCheckResult {
  recordType: string;
  domain: string;
  found: boolean;
  values: string[];
  consistent: boolean;
  resolvers: ResolverResult[];
  expectedValue?: string;
  matchesExpected: boolean;
}

export interface PTRCheckResult {
  ip: string;
  expectedHostname: string;
  found: boolean;
  actualHostnames: string[];
  matches: boolean;
}

export interface AlignmentResult {
  ip: string;
  hostname: string;
  heloDomain: string;
  ptr_ok: boolean;
  a_ok: boolean;
  helo_ok: boolean;
  fully_aligned: boolean;
  details: {
    ptr_hostnames: string[];
    a_ips: string[];
    helo_spf_record: string | null;
    helo_includes_ip: boolean;
  };
}

export interface SPFCheckResult {
  domain: string;
  found: boolean;
  record: string | null;
  valid: boolean;
  has_all: boolean;
  policy: string | null; // e.g. "-all", "~all", "+all"
  issues: string[];
}

export interface DKIMCheckResult {
  domain: string;
  selector: string;
  found: boolean;
  record: string | null;
  valid: boolean;
  issues: string[];
}

export interface DMARCCheckResult {
  domain: string;
  found: boolean;
  record: string | null;
  policy: string | null; // none, quarantine, reject
  valid: boolean;
  issues: string[];
}

export interface BlacklistEntry {
  name: string;
  listed: boolean;
  response?: string;
}

export interface BlacklistResult {
  target: string;
  listed: boolean;
  blacklists: BlacklistEntry[];
}

export interface DomainHealthScore {
  domain: string;
  dns_ok: boolean;
  auth_ok: boolean;
  ptr_ok: boolean;
  blacklist_ok: boolean;
  overall: 'PASS' | 'FAIL' | 'WARN';
  issues: string[];
  checks: {
    a_record?: DNSCheckResult;
    mx_record?: DNSCheckResult;
    spf?: SPFCheckResult;
    dkim?: DKIMCheckResult;
    dmarc?: DMARCCheckResult;
  };
}

export interface ServerHealthScore {
  ip: string;
  hostname: string;
  ptr: PTRCheckResult;
  alignment: AlignmentResult;
  blacklist: BlacklistResult;
  overall: 'PASS' | 'FAIL' | 'WARN';
  issues: string[];
}

export interface DomainHealthReport {
  timestamp: string;
  servers: ServerHealthScore[];
  domains: DomainHealthScore[];
  nsDomain: DomainHealthScore;
  overall: 'PASS' | 'FAIL' | 'WARN';
  totalIssues: number;
  summary: {
    domainsChecked: number;
    domainsPassing: number;
    domainsFailing: number;
    domainsWarning: number;
    blacklistClean: boolean;
    allAligned: boolean;
  };
}

// --- Resolver Configuration ---

const RESOLVERS = [
  { ip: '8.8.8.8', name: 'Google' },
  { ip: '9.9.9.9', name: 'Quad9' },
  { ip: '1.1.1.1', name: 'Cloudflare' },
  { ip: '208.67.222.222', name: 'OpenDNS' },
];

// PATCH 10d.3: Barracuda re-added as WARN-only (not a hard FAIL).
// Barracuda lists ~80% of Linode IPs but only 0.35% market share (enterprise
// appliances only — Gmail/Outlook don't check it). Logged for visibility but
// won't block provisioning. Spamhaus/SORBS/UCEPROTECT remain hard FAILs.
const IP_BLACKLISTS = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
  { zone: 'dnsbl.sorbs.net', name: 'SORBS' },
  { zone: 'dnsbl-1.uceprotect.net', name: 'UCEPROTECT L1' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda' },
];

// Barracuda is WARN-only — not checked by Gmail/Outlook (Hard Lesson #76)
const WARN_ONLY_BLACKLISTS = new Set(['Barracuda']);

const DOMAIN_BLACKLISTS = [
  { zone: 'dbl.spamhaus.org', name: 'Spamhaus DBL' },
];

// --- Helper: create resolver with specific nameserver ---

function createResolver(nameserver: string): dnsPromises.Resolver {
  const resolver = new dnsPromises.Resolver();
  resolver.setServers([nameserver]);
  return resolver;
}

// --- Helper: resolve with timeout ---

async function resolveWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 10000
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('DNS query timeout')), timeoutMs)
    ),
  ]);
}

// --- DNSVerifier Class ---

export class DNSVerifier {
  private queryTimeout: number;

  constructor(queryTimeout: number = 10000) {
    this.queryTimeout = queryTimeout;
  }

  /**
   * Check a DNS record across multiple resolvers
   */
  async checkDNS(
    domain: string,
    recordType: string,
    expectedValue?: string
  ): Promise<DNSCheckResult> {
    const resolverResults: ResolverResult[] = [];
    const allValues = new Set<string>();

    for (const { ip, name } of RESOLVERS) {
      const resolver = createResolver(ip);
      try {
        let values: string[] = [];

        switch (recordType.toUpperCase()) {
          case 'A':
            values = await resolveWithTimeout(
              () => resolver.resolve4(domain),
              this.queryTimeout
            );
            break;
          case 'AAAA':
            values = await resolveWithTimeout(
              () => resolver.resolve6(domain),
              this.queryTimeout
            );
            break;
          case 'MX': {
            const mxRecords = await resolveWithTimeout(
              () => resolver.resolveMx(domain),
              this.queryTimeout
            );
            values = mxRecords.map((r) => `${r.priority} ${r.exchange}`);
            break;
          }
          case 'TXT': {
            const txtRecords = await resolveWithTimeout(
              () => resolver.resolveTxt(domain),
              this.queryTimeout
            );
            values = txtRecords.map((chunks) => chunks.join(''));
            break;
          }
          case 'NS': {
            values = await resolveWithTimeout(
              () => resolver.resolveNs(domain),
              this.queryTimeout
            );
            break;
          }
          case 'CNAME': {
            const cname = await resolveWithTimeout(
              () => resolver.resolveCname(domain),
              this.queryTimeout
            );
            values = cname;
            break;
          }
          default: {
            const anyRecords = await resolveWithTimeout(
              () => resolver.resolveAny(domain),
              this.queryTimeout
            ).catch(() => [] as dns.AnyRecord[]);
            values = anyRecords.map((r) => JSON.stringify(r));
            break;
          }
        }

        values.forEach((v) => allValues.add(v));
        resolverResults.push({ resolver: ip, name, values });
      } catch (err) {
        resolverResults.push({
          resolver: ip,
          name,
          values: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const valuesArray = Array.from(allValues);
    const found = valuesArray.length > 0;

    // Check consistency: all resolvers that returned data should agree
    const resolversWithData = resolverResults.filter((r) => r.values.length > 0);
    const consistent =
      resolversWithData.length <= 1 ||
      resolversWithData.every(
        (r) =>
          JSON.stringify([...r.values].sort()) ===
          JSON.stringify([...resolversWithData[0].values].sort())
      );

    let matchesExpected = true;
    if (expectedValue && found) {
      matchesExpected = valuesArray.some(
        (v) => v.toLowerCase().includes(expectedValue.toLowerCase())
      );
    } else if (expectedValue && !found) {
      matchesExpected = false;
    }

    return {
      recordType,
      domain,
      found,
      values: valuesArray,
      consistent,
      resolvers: resolverResults,
      expectedValue,
      matchesExpected,
    };
  }

  /**
   * Check PTR (reverse DNS) record
   */
  async checkPTR(ip: string, expectedHostname: string): Promise<PTRCheckResult> {
    try {
      const hostnames = await resolveWithTimeout(
        () => dnsPromises.reverse(ip),
        this.queryTimeout
      );

      const matches = hostnames.some(
        (h) => h.toLowerCase() === expectedHostname.toLowerCase() ||
               h.toLowerCase() === `${expectedHostname}.`.toLowerCase()
      );

      return {
        ip,
        expectedHostname,
        found: hostnames.length > 0,
        actualHostnames: hostnames,
        matches,
      };
    } catch {
      return {
        ip,
        expectedHostname,
        found: false,
        actualHostnames: [],
        matches: false,
      };
    }
  }

  /**
   * Check PTR/A/HELO alignment (the gold standard for deliverability)
   */
  async checkAlignment(
    ip: string,
    hostname: string,
    heloDomain: string
  ): Promise<AlignmentResult> {
    // 1. PTR must resolve to hostname
    const ptr = await this.checkPTR(ip, hostname);

    // 2. A record for hostname must resolve back to IP
    const aCheck = await this.checkDNS(hostname, 'A', ip);

    // 3. SPF on HELO domain must include the IP
    const spfCheck = await this.checkSPF(heloDomain);
    const heloIncludesIP =
      spfCheck.found && spfCheck.record
        ? spfCheck.record.includes(ip) ||
          spfCheck.record.includes('+a') ||
          spfCheck.record.includes('+mx')
        : false;

    return {
      ip,
      hostname,
      heloDomain,
      ptr_ok: ptr.matches,
      a_ok: aCheck.matchesExpected,
      helo_ok: heloIncludesIP,
      fully_aligned: ptr.matches && aCheck.matchesExpected && heloIncludesIP,
      details: {
        ptr_hostnames: ptr.actualHostnames,
        a_ips: aCheck.values,
        helo_spf_record: spfCheck.record,
        helo_includes_ip: heloIncludesIP,
      },
    };
  }

  /**
   * Check SPF record validity
   */
  async checkSPF(domain: string): Promise<SPFCheckResult> {
    const txtCheck = await this.checkDNS(domain, 'TXT');
    const issues: string[] = [];

    const spfRecords = txtCheck.values.filter((v) =>
      v.toLowerCase().startsWith('v=spf1')
    );

    if (spfRecords.length === 0) {
      return {
        domain,
        found: false,
        record: null,
        valid: false,
        has_all: false,
        policy: null,
        issues: ['No SPF record found'],
      };
    }

    if (spfRecords.length > 1) {
      issues.push('Multiple SPF records found — only one allowed per domain');
    }

    const record = spfRecords[0];

    // Check for -all, ~all, +all, ?all
    const allMatch = record.match(/[+~?-]all/);
    const policy = allMatch ? allMatch[0] : null;

    if (!policy) {
      issues.push('SPF record missing "all" mechanism');
    } else if (policy === '+all') {
      issues.push('SPF uses +all which allows any server to send — extremely dangerous');
    } else if (policy === '?all') {
      issues.push('SPF uses ?all (neutral) — should use ~all or -all');
    }

    // Check for too many lookups (rough check)
    const lookupMechanisms = (record.match(/(include:|a:|mx:|ptr:|redirect=)/g) || []).length;
    if (lookupMechanisms > 8) {
      issues.push(`SPF record has ${lookupMechanisms} lookup mechanisms — nearing 10-lookup limit`);
    }

    return {
      domain,
      found: true,
      record,
      valid: issues.length === 0 || (issues.length === 1 && issues[0].includes('Multiple')),
      has_all: !!policy,
      policy,
      issues,
    };
  }

  /**
   * Check DKIM record
   */
  async checkDKIM(domain: string, selector: string = 'mail'): Promise<DKIMCheckResult> {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    const txtCheck = await this.checkDNS(dkimDomain, 'TXT');
    const issues: string[] = [];

    if (!txtCheck.found) {
      return {
        domain,
        selector,
        found: false,
        record: null,
        valid: false,
        issues: [`No DKIM record found at ${dkimDomain}`],
      };
    }

    const dkimRecords = txtCheck.values.filter(
      (v) => v.includes('v=DKIM1') || v.includes('k=rsa') || v.includes('p=')
    );

    if (dkimRecords.length === 0) {
      return {
        domain,
        selector,
        found: false,
        record: txtCheck.values[0] || null,
        valid: false,
        issues: [`TXT record at ${dkimDomain} does not appear to be a DKIM record`],
      };
    }

    const record = dkimRecords[0];

    // Check for public key
    if (!record.includes('p=')) {
      issues.push('DKIM record missing public key (p= tag)');
    }

    // Check for empty public key (revoked)
    const pMatch = record.match(/p=([^;]*)/);
    if (pMatch && pMatch[1].trim() === '') {
      issues.push('DKIM public key is empty — key has been revoked');
    }

    return {
      domain,
      selector,
      found: true,
      record,
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Check DMARC record
   */
  async checkDMARC(domain: string): Promise<DMARCCheckResult> {
    const dmarcDomain = `_dmarc.${domain}`;
    const txtCheck = await this.checkDNS(dmarcDomain, 'TXT');
    const issues: string[] = [];

    const dmarcRecords = txtCheck.values.filter((v) =>
      v.toLowerCase().startsWith('v=dmarc1')
    );

    if (dmarcRecords.length === 0) {
      return {
        domain,
        found: false,
        record: null,
        policy: null,
        valid: false,
        issues: ['No DMARC record found'],
      };
    }

    const record = dmarcRecords[0];

    // Extract policy
    const policyMatch = record.match(/p=(\w+)/);
    const policy = policyMatch ? policyMatch[1].toLowerCase() : null;

    if (!policy) {
      issues.push('DMARC record missing p= (policy) tag');
    } else if (policy === 'none') {
      issues.push('DMARC policy is "none" — consider quarantine or reject for better protection');
    }

    return {
      domain,
      found: true,
      record,
      policy,
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Check IP against DNS blacklists
   */
  async checkBlacklist(ip: string): Promise<BlacklistResult> {
    // Reverse IP for DNSBL query (1.2.3.4 → 4.3.2.1)
    const reversed = ip.split('.').reverse().join('.');
    const entries: BlacklistEntry[] = [];

    for (const { zone, name } of IP_BLACKLISTS) {
      const queryDomain = `${reversed}.${zone}`;
      try {
        const resolver = createResolver('8.8.8.8');
        const results = await resolveWithTimeout(
          () => resolver.resolve4(queryDomain),
          5000
        );
        // If we get a response, the IP is listed
        entries.push({
          name,
          listed: true,
          response: results[0],
        });
      } catch {
        // NXDOMAIN or timeout = not listed (good)
        entries.push({ name, listed: false });
      }
    }

    return {
      target: ip,
      listed: entries.some((e) => e.listed),
      blacklists: entries,
    };
  }

  /**
   * Check domain against domain blacklists (Spamhaus DBL)
   */
  async checkBlacklistDomain(domain: string): Promise<BlacklistResult> {
    const entries: BlacklistEntry[] = [];

    for (const { zone, name } of DOMAIN_BLACKLISTS) {
      const queryDomain = `${domain}.${zone}`;
      try {
        const resolver = createResolver('8.8.8.8');
        const results = await resolveWithTimeout(
          () => resolver.resolve4(queryDomain),
          5000
        );
        entries.push({
          name,
          listed: true,
          response: results[0],
        });
      } catch {
        entries.push({ name, listed: false });
      }
    }

    return {
      target: domain,
      listed: entries.some((e) => e.listed),
      blacklists: entries,
    };
  }

  /**
   * Full health check for a server pair — the big one
   * Runs ALL checks on ALL domains + both IPs
   */
  async fullHealthCheck(serverPair: {
    server1IP: string;
    server2IP: string;
    nsDomain: string;
    sendingDomains: string[];
  }): Promise<DomainHealthReport> {
    const { server1IP, server2IP, nsDomain, sendingDomains } = serverPair;
    const allDomains = [nsDomain, ...sendingDomains];

    // Run server-level checks in parallel
    const [
      ptr1,
      ptr2,
      alignment1,
      alignment2,
      blacklist1,
      blacklist2,
    ] = await Promise.all([
      this.checkPTR(server1IP, `mail1.${nsDomain}`),
      this.checkPTR(server2IP, `mail2.${nsDomain}`),
      this.checkAlignment(server1IP, `mail1.${nsDomain}`, nsDomain),
      this.checkAlignment(server2IP, `mail2.${nsDomain}`, nsDomain),
      this.checkBlacklist(server1IP),
      this.checkBlacklist(server2IP),
    ]);

    // Build server scores
    const buildServerScore = (
      ip: string,
      hostname: string,
      ptr: PTRCheckResult,
      alignment: AlignmentResult,
      blacklist: BlacklistResult
    ): ServerHealthScore => {
      const issues: string[] = [];
      if (!ptr.matches) issues.push(`PTR mismatch: expected ${hostname}, got ${ptr.actualHostnames.join(', ') || 'nothing'}`);
      if (!alignment.a_ok) issues.push(`A record for ${hostname} does not resolve to ${ip}`);
      if (!alignment.helo_ok) issues.push(`HELO SPF on ${alignment.heloDomain} does not include ${ip}`);
      if (blacklist.listed) {
        const listedOn = blacklist.blacklists.filter((b) => b.listed);
        const hardFails = listedOn.filter((b) => !WARN_ONLY_BLACKLISTS.has(b.name));
        const softFails = listedOn.filter((b) => WARN_ONLY_BLACKLISTS.has(b.name));
        if (hardFails.length > 0) issues.push(`IP listed on: ${hardFails.map((b) => b.name).join(', ')}`);
        if (softFails.length > 0) issues.push(`IP listed on ${softFails.map((b) => b.name).join(', ')} (WARN — not checked by Gmail/Outlook)`);
      }

      // Only hard-fail blacklists (non-Barracuda) cause FAIL status
      const hardBlacklisted = blacklist.listed && blacklist.blacklists.some(
        (b) => b.listed && !WARN_ONLY_BLACKLISTS.has(b.name)
      );
      let overall: 'PASS' | 'FAIL' | 'WARN' = 'PASS';
      if (hardBlacklisted || !ptr.matches) overall = 'FAIL';
      else if (!alignment.fully_aligned || (blacklist.listed && !hardBlacklisted)) overall = 'WARN';

      return { ip, hostname, ptr, alignment, blacklist, overall, issues };
    };

    const servers: ServerHealthScore[] = [
      buildServerScore(server1IP, `mail1.${nsDomain}`, ptr1, alignment1, blacklist1),
      buildServerScore(server2IP, `mail2.${nsDomain}`, ptr2, alignment2, blacklist2),
    ];

    // Run domain-level checks in parallel
    const domainScores: DomainHealthScore[] = await Promise.all(
      allDomains.map(async (domain) => {
        const isNs = domain === nsDomain;
        const issues: string[] = [];

        // Run all checks for this domain in parallel
        const [aCheck, mxCheck, spf, dkim, dmarc, domainBl] = await Promise.all([
          this.checkDNS(domain, 'A'),
          isNs ? Promise.resolve(null) : this.checkDNS(domain, 'MX'),
          this.checkSPF(domain),
          this.checkDKIM(domain, 'mail'),
          this.checkDMARC(domain),
          this.checkBlacklistDomain(domain),
        ]);

        // DNS checks
        let dns_ok = true;
        if (!aCheck.found) {
          dns_ok = false;
          issues.push(`No A record for ${domain}`);
        }
        if (!aCheck.consistent) {
          issues.push(`Inconsistent A records across resolvers for ${domain}`);
        }
        if (!isNs && mxCheck && !mxCheck.found) {
          dns_ok = false;
          issues.push(`No MX record for ${domain}`);
        }

        // Auth checks
        let auth_ok = true;
        if (!spf.found || !spf.valid) {
          auth_ok = false;
          issues.push(...spf.issues);
        }
        if (!dkim.found || !dkim.valid) {
          auth_ok = false;
          issues.push(...dkim.issues);
        }
        if (!dmarc.found) {
          auth_ok = false;
          issues.push(...dmarc.issues);
        }

        // Blacklist
        const blacklist_ok = !domainBl.listed;
        if (domainBl.listed) {
          const listedOn = domainBl.blacklists.filter((b) => b.listed).map((b) => b.name);
          issues.push(`Domain listed on: ${listedOn.join(', ')}`);
        }

        // PTR is server-level, mark as ok for domain score
        const ptr_ok = true;

        let overall: 'PASS' | 'FAIL' | 'WARN' = 'PASS';
        if (!dns_ok || !auth_ok || !blacklist_ok) overall = 'FAIL';
        else if (dmarc.policy === 'none' || spf.issues.length > 0) overall = 'WARN';

        return {
          domain,
          dns_ok,
          auth_ok,
          ptr_ok,
          blacklist_ok,
          overall,
          issues,
          checks: {
            a_record: aCheck,
            mx_record: mxCheck || undefined,
            spf,
            dkim,
            dmarc,
          },
        };
      })
    );

    // Separate NS domain from sending domains
    const nsDomainScore = domainScores.find((d) => d.domain === nsDomain)!;
    const sendingDomainScores = domainScores.filter((d) => d.domain !== nsDomain);

    // Calculate overall
    const allScores = [...servers, ...domainScores];
    const hasFail = allScores.some((s) => s.overall === 'FAIL');
    const hasWarn = allScores.some((s) => s.overall === 'WARN');
    const totalIssues = allScores.reduce(
      (sum, s) => sum + s.issues.length,
      0
    );

    const domainsPassing = domainScores.filter((d) => d.overall === 'PASS').length;
    const domainsFailing = domainScores.filter((d) => d.overall === 'FAIL').length;
    const domainsWarning = domainScores.filter((d) => d.overall === 'WARN').length;

    return {
      timestamp: new Date().toISOString(),
      servers,
      domains: sendingDomainScores,
      nsDomain: nsDomainScore,
      overall: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
      totalIssues,
      summary: {
        domainsChecked: allDomains.length,
        domainsPassing,
        domainsFailing,
        domainsWarning,
        blacklistClean: !blacklist1.listed && !blacklist2.listed,
        allAligned: alignment1.fully_aligned && alignment2.fully_aligned,
      },
    };
  }
}

// ============================================
// Subnet diversity check (hard lesson #44)
// Both servers in a pair should live in different /24 networks to avoid
// MXToolbox "same subnet" warnings and to insulate reputation. Linode
// assigns IPs from the same regional pool, so identical region = near-
// guaranteed shared /24. We warn (non-fatal) so Dean can decide whether
// to rollback and reprovision in a different region.
// ============================================

export interface SubnetDiversityResult {
  ip1: string;
  ip2: string;
  sameSlash24: boolean;
  sameSlash16: boolean;
  slash24_1: string;
  slash24_2: string;
}

export function checkSubnetDiversity(
  ip1: string,
  ip2: string
): SubnetDiversityResult {
  const [a1, b1, c1] = ip1.split('.');
  const [a2, b2, c2] = ip2.split('.');
  return {
    ip1,
    ip2,
    sameSlash24: a1 === a2 && b1 === b2 && c1 === c2,
    sameSlash16: a1 === a2 && b1 === b2,
    slash24_1: `${a1}.${b1}.${c1}.0/24`,
    slash24_2: `${a2}.${b2}.${c2}.0/24`,
  };
}
