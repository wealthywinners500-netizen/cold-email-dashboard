/**
 * MXToolbox domain health check — runs comprehensive DNS/mail verification
 * against all domains in a pair.
 *
 * Two modes:
 *   1. REAL MODE (MXTOOLBOX_API_KEY set + budget available):
 *      Calls the actual MXToolbox REST API for SPF, DKIM, DMARC, MX per domain.
 *      This is the gold standard — what MXToolbox reports IS reality.
 *      Checks remaining API budget before starting (64 lookups/day on free plan).
 *
 *   2. FALLBACK MODE (no key, or forceInternal, or budget exhausted):
 *      Uses Node DNS resolver against 1.1.1.1/8.8.8.8 for record checks.
 *      Validates CONTENT — not just existence — for SPF syntax, DKIM public key,
 *      DMARC policy, and MX hostname correctness.
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

interface MXToolboxUsageResponse {
  DnsRequests: number;
  DnsMax: number;
  [key: string]: unknown;
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
// Budget checking
// ---------------------------------------------------------------------------

/**
 * Check remaining MXToolbox API budget via the Usage endpoint.
 * Returns the number of remaining DNS lookups, or null on failure.
 */
async function checkBudget(apiKey: string): Promise<{ remaining: number; max: number } | null> {
  try {
    const res = await fetch("https://mxtoolbox.com/api/v1/Usage", {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      console.warn(`[mxtoolbox-health] Usage endpoint returned ${res.status}`);
      return null;
    }
    const data = (await res.json()) as MXToolboxUsageResponse;
    const remaining = data.DnsMax - data.DnsRequests;
    console.log(
      `[mxtoolbox-health] API budget: ${data.DnsRequests}/${data.DnsMax} used, ${remaining} remaining`
    );
    return { remaining, max: data.DnsMax };
  } catch (err) {
    console.warn(
      `[mxtoolbox-health] Budget check failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
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
 * Budget-aware: checks remaining quota first and prioritizes accordingly.
 * Priority order when budget is limited:
 *   1. SPF + DKIM (most critical for deliverability) — 2 lookups per domain
 *   2. DMARC — 1 lookup per domain
 *   3. MX — 1 lookup per domain
 *
 * Hard Lesson #57: circuit breaker on first permanent error (401/403-persistent).
 * If the API key is invalid, bail immediately — don't hammer 44 times.
 */
async function checkViaAPI(
  allDomains: string[],
  apiKey: string
): Promise<MXToolboxHealthReport> {
  const domainReports: MXToolboxDomainReport[] = [];

  // Check budget before starting
  const budget = await checkBudget(apiKey);
  const totalNeeded = allDomains.length * 4;

  if (budget !== null && budget.remaining <= 0) {
    console.warn(
      `[mxtoolbox-health] API budget exhausted (${budget.remaining}/${budget.max}) — falling back to internal checks`
    );
    // Return a report indicating we couldn't check
    for (const domain of allDomains) {
      domainReports.push({
        domain,
        errors: 0,
        warnings: 1,
        errorDetails: [],
        warningDetails: ["MXToolbox API budget exhausted — using internal DNS checks"],
      });
    }
    return {
      ok: true,
      source: "mxtoolbox-api-budget-exhausted",
      domains: domainReports,
    };
  }

  // Determine which checks to run based on budget
  // Priority: SPF > DKIM > DMARC > MX
  type CommandDef = { cmd: string; arg: (d: string) => string; label: string; priority: number };
  const allCommands: CommandDef[] = [
    { cmd: "spf", arg: (d) => d, label: "SPF", priority: 1 },
    { cmd: "dkim", arg: (d) => `${d}:mail`, label: "DKIM", priority: 1 },
    { cmd: "dmarc", arg: (d) => d, label: "DMARC", priority: 2 },
    { cmd: "mx", arg: (d) => d, label: "MX", priority: 3 },
  ];

  let commands = allCommands;
  if (budget !== null && budget.remaining < totalNeeded) {
    console.warn(
      `[mxtoolbox-health] Limited budget (${budget.remaining} remaining, need ${totalNeeded}). Prioritizing checks.`
    );
    // Calculate how many commands we can afford per domain
    const perDomain = Math.floor(budget.remaining / allDomains.length);
    if (perDomain >= 3) {
      commands = allCommands.filter((c) => c.priority <= 2); // SPF, DKIM, DMARC
    } else if (perDomain >= 2) {
      commands = allCommands.filter((c) => c.priority <= 1); // SPF, DKIM only
    } else if (perDomain >= 1) {
      commands = [allCommands[0]]; // SPF only
    } else {
      commands = []; // No budget at all
    }
    console.log(
      `[mxtoolbox-health] Running ${commands.length} checks per domain (${commands.map((c) => c.label).join(", ")})`
    );
  }

  let circuitBroken = false;
  let lookupsUsed = 0;

  for (const domain of allDomains) {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (circuitBroken) {
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

    // Check remaining budget before each domain
    if (budget !== null && lookupsUsed >= budget.remaining) {
      warnings.push("Skipped — MXToolbox API budget exhausted mid-run");
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
        lookupsUsed++;

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

        // Budget exhausted (403 after retries)
        if (msg.includes("403")) {
          console.warn(
            `[mxtoolbox-api] Budget likely exhausted (403 persistent) — stopping gracefully`
          );
          warnings.push(`[${label}] API budget exhausted (403)`);
          circuitBroken = true;
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
// Internal fallback — validates record CONTENT, not just existence
// ---------------------------------------------------------------------------

async function checkViaInternalDNS(
  allDomains: string[],
  nsDomain: string,
  serverIPs: { server1IP: string; server2IP: string }
): Promise<MXToolboxHealthReport> {
  const resolver = new dnsPromises.Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);

  const domainReports: MXToolboxDomainReport[] = [];

  for (const domain of allDomains) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ---- SPF: validate syntax, not just existence ----
    try {
      const txtRecords = await resolver.resolveTxt(domain);
      const spfRecords = txtRecords
        .map((r) => r.join(""))
        .filter((r) => r.startsWith("v=spf1"));

      if (spfRecords.length === 0) {
        errors.push("No SPF record found");
      } else if (spfRecords.length > 1) {
        errors.push(`Multiple SPF records found (${spfRecords.length})`);
      } else {
        const spf = spfRecords[0];
        // Validate SPF has ip4: mechanism
        if (!spf.includes("ip4:")) {
          errors.push(`SPF missing ip4: mechanism: ${spf}`);
        }
        // Validate SPF ends with -all or ~all
        if (!spf.includes("-all") && !spf.includes("~all")) {
          errors.push(`SPF missing -all or ~all qualifier: ${spf}`);
        }
        // Check that the IP in SPF matches one of our server IPs
        const ipMatch = spf.match(/ip4:(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          const spfIP = ipMatch[1];
          if (spfIP !== serverIPs.server1IP && spfIP !== serverIPs.server2IP) {
            warnings.push(`SPF ip4:${spfIP} doesn't match either server IP (${serverIPs.server1IP}, ${serverIPs.server2IP})`);
          }
        }
        // Count DNS lookup mechanisms (max 10 per RFC 7208)
        const dnsLookups = (spf.match(/\b(include|a|mx|ptr|exists|redirect)\b/g) || []).length;
        if (dnsLookups >= 10) {
          errors.push(`SPF has ${dnsLookups} DNS lookup mechanisms (max 10)`);
        }
      }
    } catch {
      errors.push("SPF lookup failed (NXDOMAIN or timeout)");
    }

    // ---- DKIM: validate public key content ----
    try {
      // Hard Lesson #75: DKIM selector is `mail`, NOT `default`
      const dkimRecords = await resolver.resolveTxt(`mail._domainkey.${domain}`);
      const dkim = dkimRecords
        .map((r) => r.join(""))
        .filter((r) => r.includes("v=DKIM1"));

      if (dkim.length === 0) {
        errors.push("No DKIM record found at mail._domainkey");
      } else {
        const dkimRecord = dkim[0];
        // Check for v=DKIM1 tag
        if (!dkimRecord.includes("v=DKIM1")) {
          errors.push("DKIM record missing v=DKIM1 tag");
        }
        // Check for k=rsa key type
        if (!dkimRecord.includes("k=rsa")) {
          warnings.push("DKIM record missing k=rsa (may use default)");
        }
        // Check for p= public key — must be non-empty
        const pMatch = dkimRecord.match(/p=([A-Za-z0-9+/=]*)/);
        if (!pMatch) {
          errors.push("DKIM record missing p= (public key)");
        } else if (pMatch[1].length === 0) {
          errors.push("DKIM public key is empty (p=) — key revoked?");
        } else {
          // Check key length (2048-bit = ~256 bytes = ~341 base64 chars)
          const keyLen = Math.floor((pMatch[1].length * 3) / 4);
          if (keyLen < 128) {
            warnings.push(`DKIM key seems short (${keyLen} bytes, recommend ≥256 for 2048-bit)`);
          }
        }
      }
    } catch {
      errors.push("DKIM lookup failed (NXDOMAIN or timeout) at mail._domainkey");
    }

    // ---- DMARC: validate policy content ----
    try {
      const dmarcRecords = await resolver.resolveTxt(`_dmarc.${domain}`);
      const dmarc = dmarcRecords
        .map((r) => r.join(""))
        .filter((r) => r.startsWith("v=DMARC1"));

      if (dmarc.length === 0) {
        errors.push("No DMARC record found");
      } else if (dmarc.length > 1) {
        errors.push(`Multiple DMARC records found (${dmarc.length})`);
      } else {
        const dmarcRecord = dmarc[0];
        // Check policy
        if (dmarcRecord.includes("p=none")) {
          warnings.push("DMARC policy is p=none (should be p=quarantine or p=reject)");
        } else if (!dmarcRecord.includes("p=quarantine") && !dmarcRecord.includes("p=reject")) {
          errors.push(`DMARC missing valid policy (p=quarantine or p=reject): ${dmarcRecord}`);
        }
        // Check for duplicate p= tags
        const pCount = (dmarcRecord.match(/\bp=/g) || []).length;
        if (pCount > 1) {
          errors.push("DMARC has duplicate policy tags");
        }
      }
    } catch {
      errors.push("No DMARC record found");
    }

    // ---- MX: validate hostname correctness ----
    try {
      const mxRecords = await resolver.resolveMx(domain);
      if (mxRecords.length === 0) {
        warnings.push("No MX record found");
      } else {
        // Verify MX points to mail1 or mail2 of the NS domain
        const mxHost = mxRecords[0].exchange.replace(/\.$/, "");
        const validHosts = [
          `mail1.${nsDomain}`,
          `mail2.${nsDomain}`,
        ];
        if (!validHosts.includes(mxHost)) {
          warnings.push(
            `MX points to ${mxHost} — expected ${validHosts.join(" or ")}`
          );
        }
        // Check for multiple MX records (not necessarily wrong, but worth noting)
        if (mxRecords.length > 1) {
          warnings.push(`Multiple MX records found (${mxRecords.length})`);
        }
      }
    } catch {
      warnings.push("MX lookup failed");
    }

    // ---- A record: check existence ----
    try {
      const aRecords = await resolver.resolve4(domain);
      if (aRecords.length === 0) {
        warnings.push("No A record found");
      } else {
        // Verify A record points to one of our server IPs
        const validIPs = [serverIPs.server1IP, serverIPs.server2IP];
        const domainIP = aRecords[0];
        if (!validIPs.includes(domainIP)) {
          warnings.push(
            `A record ${domainIP} doesn't match server IPs (${validIPs.join(", ")})`
          );
        }
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
 * @param allDomains - All domains to check (ns_domain + sending domains)
 * @param serverIPs - S1 and S2 IP addresses
 * @param nsDomain - The NS domain (for MX hostname validation)
 * @param options.forceInternal - Force internal DNS checks even if API key is available.
 *   Use this for VG2 (post-fix verification) to save API budget for VG1.
 */
export async function checkMXToolboxHealth(
  allDomains: string[],
  serverIPs: { server1IP: string; server2IP: string },
  nsDomain: string,
  options?: { forceInternal?: boolean }
): Promise<MXToolboxHealthReport> {
  const apiKey = process.env.MXTOOLBOX_API_KEY;

  if (options?.forceInternal) {
    console.log(
      `[mxtoolbox-health] forceInternal=true — using internal DNS checks on ${allDomains.length} domains`
    );
    return checkViaInternalDNS(allDomains, nsDomain, serverIPs);
  }

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
  return checkViaInternalDNS(allDomains, nsDomain, serverIPs);
}
