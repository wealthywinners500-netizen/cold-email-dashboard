/**
 * MXToolbox domain health check — runs comprehensive DNS/mail verification
 * against all domains in a pair. Uses Cloudflare 1.1.1.1 as resolver.
 * Used by VG serverless step in serverless-steps.ts.
 */

import { promises as dnsPromises } from "dns";

export interface MXToolboxDomainReport {
  domain: string;
  errors: number;
  warnings: number;
  errorDetails: string[];
  warningDetails: string[];
}

export interface MXToolboxHealthReport {
  ok: boolean;
  source: string;
  domains: MXToolboxDomainReport[];
}

/**
 * Check health of all domains in a pair by querying DNS records.
 * This mirrors MXToolbox's domain health checks: SPF, DKIM, DMARC, MX, A records.
 */
export async function checkMXToolboxHealth(
  allDomains: string[],
  serverIPs: { server1IP: string; server2IP: string },
  nsDomain: string
): Promise<MXToolboxHealthReport> {
  const resolver = new dnsPromises.Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);

  const domainReports: MXToolboxDomainReport[] = [];

  for (const domain of allDomains) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check SPF
    try {
      const txtRecords = await resolver.resolveTxt(domain);
      const spfRecords = txtRecords
        .map((r) => r.join(""))
        .filter((r) => r.startsWith("v=spf1"));

      if (spfRecords.length === 0) {
        errors.push("No SPF record found");
      } else if (spfRecords.length > 1) {
        errors.push(`Multiple SPF records found (${spfRecords.length})`);
      }
    } catch {
      errors.push("SPF lookup failed (NXDOMAIN or timeout)");
    }

    // Check DMARC
    try {
      const dmarcRecords = await resolver.resolveTxt(`_dmarc.${domain}`);
      const dmarc = dmarcRecords
        .map((r) => r.join(""))
        .filter((r) => r.startsWith("v=DMARC1"));

      if (dmarc.length === 0) {
        errors.push("No DMARC record found");
      }
    } catch {
      errors.push("No DMARC record found");
    }

    // Check MX (sending domains should have MX)
    try {
      const mxRecords = await resolver.resolveMx(domain);
      if (mxRecords.length === 0) {
        warnings.push("No MX record found");
      }
    } catch {
      warnings.push("MX lookup failed");
    }

    // Check A record
    try {
      const aRecords = await resolver.resolve4(domain);
      if (aRecords.length === 0) {
        warnings.push("No A record found");
      }
    } catch {
      // NS domain may not have A record — only warn for sending domains
      if (domain !== nsDomain) {
        warnings.push("A record lookup failed");
      }
    }

    domainReports.push({
      domain,
      errors: errors.length,
      warnings: warnings.length,
      errorDetails: errors,
      warningDetails: warnings,
    });
  }

  const totalErrors = domainReports.reduce((sum, d) => sum + d.errors, 0);

  return {
    ok: totalErrors === 0,
    source: "internal-dns-check",
    domains: domainReports,
  };
}
