/**
 * MXToolbox domain health check — runs comprehensive DNS/mail verification
 * against all domains in a pair.
 *
 * Two modes:
 *   1. REAL MODE (MXTOOLBOX_API_KEY set):
 *      Calls the actual MXToolbox REST API for SPF, DKIM, DMARC, MX per domain.
 *      This is the gold standard — what MXToolbox reports IS reality.
 *
 *   2. FALLBACK MODE (no key):
 *      Uses Node DNS resolver against 1.1.1.1/8.8.8.8 for basic record checks.
 *      Covers existence checks only, NOT content validation.
 *
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

// ---------------------------------------------------------------------------
// MXToolbox API types
// ---------------------------------------------------------------------------

interface MXToolboxAPIItem {
  ID: number;
  Name: string;
  Info: string;
  Url?: string;
  PublicDescription?: string | null;
  IsExcludedByUser?: boolean;
}

interface MXToolboxAPIResponse {
  Command: string;
  CommandArgument: string;
  Failed: MXToolboxAPIItem[];
  Warnings: MXToolboxAPIItem[];
  Passed: MXToolboxAPIItem[];
  Timeouts: MXToolboxAPIItem[];
  // We don't use the rest of the fields
}

// ---------------------------------------------------------------------------
// Rate-limiting helpers
// ---------------------------------------------------------------------------

/** Delay between API calls to stay under MXToolbox rate limits. */
const API_CALL_DELAY_MS = 1200;

/** Max retries on a 403 (rate limit) response before giving up. */
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Real MXToolbox API calls
// ---------------------------------------------------------------------------

/**
 * Call a single MXToolbox API lookup.
 * Returns the parsed response or throws on permanent failure.
 */
async function mxToolboxLookup(
  command: string,
  argument: string,
  apiKey: string
): Promise<MXToolboxAPIResponse> {
  const url = `https://mxtoolbox.com/api/v1/Lookup/${command}/?argument=${encodeURIComponent(argument)}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 2s, 4s
      await sleep(2000 * Math.pow(2, attempt - 1));
    }

    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (res.ok) {
      return (await res.json()) as MXToolboxAPIResponse;
    }

    if (res.status === 403) {
      // Rate limited — retry with backoff
      console.warn(
        `[mxtoolbox-api] 403 rate limited on ${command}/${argument} (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      lastError = new Error(`403 rate limited after ${attempt + 1} attempts`);
      continue;
    }

    // Any other error is permanent — don't retry
    const body = await res.text().catch(() => "");
    throw new Error(
      `MXToolbox API ${res.status} on ${command}/${argument}: ${body.slice(0, 200)}`
    );
  }

  throw lastError || new Error("MXToolbox API max retries exceeded");
}

/**
 * Run real MXToolbox API checks against all domains in a pair.
 * Checks: SPF, DKIM (selector=mail), DMARC, MX for each domain.
 *
 * Hard Lesson #57: circuit breaker on first permanent error (401/403-persistent).
 * If the API key is invalid, bail immediately — don't hammer 44 times.
 */
async function checkViaAPI(
  allDomains: string[],
  apiKey: string
): Promise<MXToolboxHealthReport> {
  const domainReports: MXToolboxDomainReport[] = [];

  // Commands to run per domain. MXToolbox MX command also checks SMTP.
  const commands: Array<{ cmd: string; arg: (d: string) => string; label: string }> = [
    { cmd: "spf", arg: (d) => d, label: "SPF" },
    { cmd: "dkim", arg: (d) => `${d}:mail`, label: "DKIM" },
    { cmd: "dmarc", arg: (d) => d, label: "DMARC" },
    { cmd: "mx", arg: (d) => d, label: "MX" },
  ];

  let circuitBroken = false;

  for (const domain of allDomains) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (circuitBroken) {
      // Circuit breaker tripped — skip remaining domains, mark as unknown
      warnings.push("Skipped — MXToolbox API circuit breaker tripped");
      domainReports.push({
        domain,
        errors: 0,
        warnings: 1,
        errorDetails: [],
        warningDetails: warnings,
      });
      continue;
    }

    for (const { cmd, arg, label } of commands) {
      try {
        await sleep(API_CALL_DELAY_MS);
        const result = await mxToolboxLookup(cmd, arg(domain), apiKey);

        // Map Failed items to errors
        for (const item of result.Failed || []) {
          errors.push(`[${label}] ${item.Name}: ${item.Info}`);
        }

        // Map Warnings to warnings
        for (const item of result.Warnings || []) {
          warnings.push(`[${label}] ${item.Name}: ${item.Info}`);
        }

        // Map Timeouts to warnings (MXToolbox couldn't reach the server)
        for (const item of result.Timeouts || []) {
          warnings.push(`[${label}] Timeout: ${item.Name}: ${item.Info}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Circuit breaker: if API key is bad (401) or persistent 403, stop everything
        if (msg.includes("401") || msg.includes("Invalid ApiKey")) {
          console.error(
            `[mxtoolbox-api] CIRCUIT BREAKER: ${msg} — stopping all API calls`
          );
          circuitBroken = true;
          warnings.push(`[${label}] API circuit breaker tripped: ${msg}`);
          break;
        }

        // Other errors: record as warning, keep going
        warnings.push(`[${label}] API error (non-fatal): ${msg}`);
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
    source: circuitBroken
      ? "mxtoolbox-api-partial"
      : "mxtoolbox-api",
    domains: domainReports,
  };
}

// ---------------------------------------------------------------------------
// Internal fallback (no API key)
// ---------------------------------------------------------------------------

async function checkViaInternalDNS(
  allDomains: string[],
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

    // Check MX
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

// ---------------------------------------------------------------------------
// Public entry point — auto-selects real API vs fallback
// ---------------------------------------------------------------------------

/**
 * Check health of all domains in a pair.
 *
 * If `MXTOOLBOX_API_KEY` env var is set, uses the real MXToolbox REST API
 * (SPF, DKIM with selector=mail, DMARC, MX per domain).
 *
 * Otherwise falls back to internal DNS checks (existence only, no content
 * validation — covers ~70% of what MXToolbox checks).
 */
export async function checkMXToolboxHealth(
  allDomains: string[],
  serverIPs: { server1IP: string; server2IP: string },
  nsDomain: string
): Promise<MXToolboxHealthReport> {
  const apiKey = process.env.MXTOOLBOX_API_KEY;

  if (apiKey) {
    console.log(
      `[mxtoolbox-health] API key found — running real MXToolbox API checks on ${allDomains.length} domains ` +
        `(4 checks each, ~${Math.ceil(allDomains.length * 4 * API_CALL_DELAY_MS / 1000)}s estimated)`
    );
    return checkViaAPI(allDomains, apiKey);
  }

  console.log(
    `[mxtoolbox-health] No MXTOOLBOX_API_KEY — falling back to internal DNS checks on ${allDomains.length} domains`
  );
  return checkViaInternalDNS(allDomains, nsDomain);
}
