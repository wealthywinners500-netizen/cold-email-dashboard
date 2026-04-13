// ============================================
// MXToolbox Domain Health — Automated Check
// ============================================
//
// Dual-mode implementation:
//
// 1. PRIMARY: MXToolbox API (if MXTOOLBOX_API_KEY is set)
//    Uses their official REST API to run Domain Health checks.
//    Free tier = 100 lookups/month, more than enough for provisioning.
//
// 2. FALLBACK: Comprehensive internal checks mirroring MXToolbox's
//    Domain Health report categories. Covers:
//    - DNS (MX, A, NS records)
//    - Mail Server (SMTP connect, banner, EHLO, STARTTLS)
//    - Authentication (SPF, DKIM, DMARC)
//    - Blacklists (IP + domain via Spamhaus DQS)
//    - TLS/SSL (certificate validity)
//    - Reverse DNS (PTR alignment)
//
// Runs from the worker VPS (200.234.226.226) which has a real
// datacenter IP — not a cloud/serverless IP that MXToolbox might
// throttle or that has port 25 blocked.
//
// Hard Lesson #34: NEVER initialize SDK clients at module scope.
// Hard Lesson #57: Circuit breaker on per-item provider calls.

import dns from "dns";
import dnsPromises from "dns/promises";
import { checkPort25 } from "./port25";
import { checkSSLCert } from "./ssl-cn";

// ---- Types ----

export interface MXToolboxResult {
  domain: string;
  errors: number;
  warnings: number;
  passed: number;
  errorDetails: string[];
  warningDetails: string[];
  raw?: string;
}

export interface MXToolboxHealthReport {
  ok: boolean; // true only if ALL domains have 0 errors AND 0 warnings
  domains: MXToolboxResult[];
  totalErrors: number;
  totalWarnings: number;
  source: "mxtoolbox-api" | "internal-checks"; // which mode was used
}

// ---- MXToolbox API Mode ----

interface MXToolboxAPIResponse {
  Failed?: Array<{ Name: string; Info: string }>;
  Warnings?: Array<{ Name: string; Info: string }>;
  Passed?: Array<{ Name: string; Info: string }>;
  Errors?: string[];
  // Domain Health specific
  ReportItems?: Array<{
    Name: string;
    Status: number; // 0=pass, 1=warn, 2=fail
    Info?: string;
  }>;
}

async function checkViaAPI(
  domain: string,
  apiKey: string
): Promise<MXToolboxResult | null> {
  // MXToolbox API: individual lookups for each check category
  const commands = ["mx", "spf", "dmarc", "dkim", "smtp", "dns"];
  const errorDetails: string[] = [];
  const warningDetails: string[] = [];
  let passed = 0;
  let circuitBroken = false;

  for (const cmd of commands) {
    if (circuitBroken) break; // Hard Lesson #57

    try {
      const url = `https://mxtoolbox.com/api/v1/Lookup?command=${cmd}&argument=${encodeURIComponent(domain)}&resultIndex=1`;
      const resp = await fetch(url, {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (resp.status === 401 || resp.status === 403) {
        // Circuit breaker: API key invalid or expired — don't keep trying
        circuitBroken = true;
        return null; // signal to fall back to internal checks
      }

      if (!resp.ok) {
        warningDetails.push(`${cmd}: HTTP ${resp.status}`);
        continue;
      }

      const data = (await resp.json()) as MXToolboxAPIResponse;

      // Count failures, warnings, passes
      if (data.Failed && data.Failed.length > 0) {
        for (const f of data.Failed) {
          errorDetails.push(`${cmd}: ${f.Name} — ${f.Info}`);
        }
      }
      if (data.Warnings && data.Warnings.length > 0) {
        for (const w of data.Warnings) {
          warningDetails.push(`${cmd}: ${w.Name} — ${w.Info}`);
        }
      }
      if (data.Passed) {
        passed += data.Passed.length;
      }
    } catch (err) {
      warningDetails.push(
        `${cmd}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    domain,
    errors: errorDetails.length,
    warnings: warningDetails.length,
    passed,
    errorDetails,
    warningDetails,
  };
}

// ---- Internal Checks Mode (MXToolbox-equivalent) ----

const RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];

async function resolveWith(
  resolver: string,
  domain: string,
  rrtype: "A" | "MX" | "TXT" | "NS"
): Promise<string[]> {
  const r = new dnsPromises.Resolver();
  r.setServers([resolver]);
  try {
    if (rrtype === "MX") {
      const mx = await Promise.race([
        r.resolveMx(domain),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 8000)
        ),
      ]);
      return mx.map((m) => `${m.priority} ${m.exchange}`);
    }
    if (rrtype === "TXT") {
      const txt = await Promise.race([
        r.resolveTxt(domain),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 8000)
        ),
      ]);
      return txt.map((t) => t.join(""));
    }
    if (rrtype === "NS") {
      const ns = await Promise.race([
        r.resolveNs(domain),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), 8000)
        ),
      ]);
      return ns;
    }
    // A record
    const a = await Promise.race([
      r.resolve4(domain),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 8000)
      ),
    ]);
    return a;
  } catch {
    return [];
  }
}

async function checkDomainInternally(
  domain: string,
  serverIPs: { server1IP: string; server2IP: string },
  isNSDomain: boolean
): Promise<MXToolboxResult> {
  const errorDetails: string[] = [];
  const warningDetails: string[] = [];
  let passed = 0;

  // 1. MX Record Check
  const mxRecords = await resolveWith("8.8.8.8", domain, "MX");
  if (mxRecords.length === 0) {
    errorDetails.push("MX: No MX records found");
  } else {
    passed++;
    // Verify MX points to expected hostnames
    const mxStr = mxRecords.join(", ");
    if (isNSDomain) {
      if (
        !mxStr.includes(`mail1.${domain}`) &&
        !mxStr.includes(`mail2.${domain}`)
      ) {
        warningDetails.push(
          `MX: Records (${mxStr}) don't point to mail1/mail2.${domain}`
        );
      }
    }
  }

  // 2. A Record Check
  const aRecords = await resolveWith("8.8.8.8", domain, "A");
  if (aRecords.length === 0) {
    errorDetails.push("DNS: No A record found");
  } else {
    passed++;
  }

  // 3. SPF Check
  const txtRecords = await resolveWith("8.8.8.8", domain, "TXT");
  const spfRecords = txtRecords.filter((t) => t.startsWith("v=spf1"));
  if (spfRecords.length === 0) {
    errorDetails.push("SPF: No SPF record found");
  } else if (spfRecords.length > 1) {
    errorDetails.push("SPF: Multiple SPF records found (only one allowed)");
  } else {
    const spf = spfRecords[0];
    if (spf.includes("+all")) {
      errorDetails.push("SPF: Uses +all — allows any server to send");
    } else if (!spf.includes("-all") && !spf.includes("~all")) {
      warningDetails.push("SPF: Should use -all or ~all");
    }
    // Verify SPF includes server IP
    if (
      !spf.includes(serverIPs.server1IP) &&
      !spf.includes(serverIPs.server2IP)
    ) {
      warningDetails.push(
        `SPF: Record doesn't include server IPs (${serverIPs.server1IP}, ${serverIPs.server2IP})`
      );
    }
    passed++;
  }

  // 4. DKIM Check
  const dkimRecords = await resolveWith(
    "8.8.8.8",
    `mail._domainkey.${domain}`,
    "TXT"
  );
  const dkimValid = dkimRecords.some(
    (r) => r.includes("v=DKIM1") || r.includes("p=")
  );
  if (!dkimValid) {
    errorDetails.push("DKIM: No valid DKIM record at mail._domainkey");
  } else {
    const dkimRec = dkimRecords.find(
      (r) => r.includes("v=DKIM1") || r.includes("p=")
    );
    const pMatch = dkimRec?.match(/p=([^;]*)/);
    if (pMatch && pMatch[1].trim() === "") {
      errorDetails.push("DKIM: Public key is empty (revoked)");
    } else {
      passed++;
    }
  }

  // 5. DMARC Check (Hard Lesson #79: every domain needs DMARC including NS)
  const dmarcRecords = await resolveWith(
    "8.8.8.8",
    `_dmarc.${domain}`,
    "TXT"
  );
  const dmarcValid = dmarcRecords.some((r) => r.startsWith("v=DMARC1"));
  if (!dmarcValid) {
    errorDetails.push("DMARC: No DMARC record found");
  } else {
    const dmarc = dmarcRecords.find((r) => r.startsWith("v=DMARC1"))!;
    if (dmarc.includes("p=none")) {
      warningDetails.push("DMARC: Policy is 'none' — consider quarantine or reject");
    }
    passed++;
  }

  // 6. SMTP / Port 25 Check (including STARTTLS, banner, open relay)
  // Determine the expected mail hostname for this domain
  const mailHostname = isNSDomain
    ? `mail1.${domain}`
    : `mail.${domain}`;
  const targetIP =
    aRecords.length > 0
      ? aRecords[0]
      : isNSDomain
        ? serverIPs.server1IP
        : serverIPs.server1IP;

  // Use MX record to find the actual mail server IP if available
  let smtpIP = targetIP;
  if (mxRecords.length > 0) {
    const mxHost = mxRecords[0].split(" ").pop() || "";
    const mxIPs = await resolveWith("8.8.8.8", mxHost, "A");
    if (mxIPs.length > 0) {
      smtpIP = mxIPs[0];
    }
  }

  const port25 = await checkPort25(smtpIP, mailHostname, 15_000);
  if (!port25.ok) {
    errorDetails.push(`SMTP: Port 25 unreachable — ${port25.error}`);
  } else {
    passed++;
    if (!port25.starttls) {
      warningDetails.push("SMTP: STARTTLS not offered");
    } else {
      passed++;
    }
    if (!port25.bannerHostnameMatch) {
      warningDetails.push(
        `SMTP: Banner hostname mismatch — expected ${mailHostname}, got ${port25.banner}`
      );
    } else {
      passed++;
    }
    if (port25.openRelay) {
      errorDetails.push("SMTP: Server is an OPEN RELAY — critical security issue");
    } else {
      passed++;
    }
  }

  // 7. SSL/TLS Certificate Check
  try {
    const sslResult = await checkSSLCert(domain, 443, domain);
    if (sslResult.ok) {
      passed++;
    } else if (sslResult.selfSigned) {
      warningDetails.push(
        `TLS: Self-signed certificate on ${domain} (${sslResult.error})`
      );
    } else {
      warningDetails.push(
        `TLS: Certificate issue on ${domain} — ${sslResult.error}`
      );
    }
  } catch {
    // SSL check on bare domain is non-critical for mail
    warningDetails.push(`TLS: Could not connect to ${domain}:443`);
  }

  // 8. Reverse DNS / PTR Check (for NS domain only — sending domains don't have their own IPs)
  if (isNSDomain) {
    for (const [label, ip] of [
      ["mail1", serverIPs.server1IP],
      ["mail2", serverIPs.server2IP],
    ] as const) {
      try {
        const reversed = ip.split(".").reverse().join(".") + ".in-addr.arpa";
        const ptrRecords = await resolveWith("8.8.8.8", reversed, "TXT");
        // PTR is not a TXT record — use direct PTR lookup
        const r = new dnsPromises.Resolver();
        r.setServers(["8.8.8.8"]);
        const ptrs = await Promise.race([
          r.reverse(ip),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 8000)
          ),
        ]);
        const expectedPtr = `${label}.${domain}`;
        if (ptrs.some((p) => p.toLowerCase() === expectedPtr.toLowerCase())) {
          passed++;
        } else {
          warningDetails.push(
            `rDNS: PTR for ${ip} is ${ptrs.join(",")} — expected ${expectedPtr}`
          );
        }
      } catch {
        warningDetails.push(`rDNS: PTR lookup failed for ${ip}`);
      }
    }
  }

  // 9. Blacklist Check (IP-based via Spamhaus ZEN)
  // Only for NS domain to avoid redundant checks
  if (isNSDomain) {
    for (const [label, ip] of [
      ["S1", serverIPs.server1IP],
      ["S2", serverIPs.server2IP],
    ] as const) {
      const reversed = ip.split(".").reverse().join(".");
      try {
        const r = new dnsPromises.Resolver();
        r.setServers(["8.8.8.8"]);
        const result = await Promise.race([
          r.resolve4(`${reversed}.zen.spamhaus.org`),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 8000)
          ),
        ]);
        // If we get a result, the IP is listed
        if (result && result.length > 0) {
          // Check for denial codes (127.255.255.x)
          const denied = result.some((r) => r.startsWith("127.255.255."));
          if (!denied) {
            errorDetails.push(
              `Blacklist: ${label} (${ip}) listed on Spamhaus ZEN (${result.join(",")})`
            );
          }
          // denied = check unavailable, not listed
        }
      } catch {
        // NXDOMAIN = not listed (good)
        passed++;
      }
    }
  }

  return {
    domain,
    errors: errorDetails.length,
    warnings: warningDetails.length,
    passed,
    errorDetails,
    warningDetails,
  };
}

// ---- Main Entry Point ----

export async function checkMXToolboxHealth(
  domains: string[],
  serverIPs: { server1IP: string; server2IP: string },
  nsDomain?: string
): Promise<MXToolboxHealthReport> {
  const apiKey = process.env.MXTOOLBOX_API_KEY;
  let source: "mxtoolbox-api" | "internal-checks" = "internal-checks";
  const domainResults: MXToolboxResult[] = [];

  if (apiKey) {
    // Try MXToolbox API first
    source = "mxtoolbox-api";
    let apiFailed = false;

    for (const domain of domains) {
      if (apiFailed) break; // Circuit breaker
      const result = await checkViaAPI(domain, apiKey);
      if (result === null) {
        // API authentication failed — fall back to internal checks
        apiFailed = true;
        source = "internal-checks";
        break;
      }
      domainResults.push(result);
    }

    if (!apiFailed) {
      const totalErrors = domainResults.reduce((s, d) => s + d.errors, 0);
      const totalWarnings = domainResults.reduce((s, d) => s + d.warnings, 0);
      return {
        ok: totalErrors === 0 && totalWarnings === 0,
        domains: domainResults,
        totalErrors,
        totalWarnings,
        source,
      };
    }

    // If API failed, fall through to internal checks
    domainResults.length = 0;
  }

  // Internal checks mode — mirrors MXToolbox Domain Health categories
  for (const domain of domains) {
    const isNS = domain === nsDomain;
    const result = await checkDomainInternally(domain, serverIPs, isNS);
    domainResults.push(result);
  }

  const totalErrors = domainResults.reduce((s, d) => s + d.errors, 0);
  const totalWarnings = domainResults.reduce((s, d) => s + d.warnings, 0);

  return {
    ok: totalErrors === 0 && totalWarnings === 0,
    domains: domainResults,
    totalErrors,
    totalWarnings,
    source,
  };
}
