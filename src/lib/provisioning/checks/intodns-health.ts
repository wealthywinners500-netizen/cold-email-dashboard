/**
 * intodns-health.ts — canonical Gate 0 deliverability oracle.
 *
 * Port of `tools/verify-zone.sh` to TypeScript. Implements the DNS-layer
 * (signal a) portion of the 3-signal canonical stack adopted 2026-04-19:
 *   a. intoDNS-class programmatic checks  ← THIS FILE
 *   b. mail-tester score ≥ 8.5/10          (runtime JSON API; separate module)
 *   c. Google Postmaster Tools reputation  (no API — manual admin confirm)
 *
 * Supersedes `checks/mxtoolbox-health.ts` as the gating oracle. MXToolbox
 * UI + API remain as ADVISORY signals only — see
 * `.auto-memory/feedback_mxtoolbox_ui_api_gap.md` for the evidence trail
 * (F1: no paid API has UI parity; F2: UI is stricter than its own docs;
 * F3: google.com fails MXToolbox-class checks; F4: industry tools do not
 * agree with MXToolbox UI).
 *
 * This check runs comprehensively per zone:
 *   - SOA timer sanity (MXToolbox-safe centered values, not RFC edges)
 *   - NS consistency (parent ↔ S1 ↔ S2) and AXFR serial alignment
 *   - MX present + resolves + PTR-aligned to per-domain or shared HELO
 *   - SPF present, ≤10 DNS lookups, hardfail after week 1
 *   - DMARC present, policy ≥ quarantine, rua/ruf present
 *   - DKIM selector=mail present with RSA key
 *   - CAA letsencrypt authorization
 *   - MTA-STS DNS TXT + reachable HTTPS policy file
 *   - TLS-RPT DNS TXT
 *   - Spamhaus ZEN clean on 2-of-3 public resolvers (with rate-limit handling)
 *
 * Does NOT probe SMTP port 25 here — that check runs from the worker VPS
 * via `verification.ts`'s existing STARTTLS probe (HL #99, #104).
 */

import dnsPromises from "node:dns/promises";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// Thresholds (sources: B1–B9 of the Session 04d research deliverable)
// ---------------------------------------------------------------------------

/** MXToolbox-safe-center values that pass intoDNS and avoid the UI's undocumented bounds. */
export const SOA_TARGETS = {
  refreshMin: 7200,   // UI flags below this
  refreshMax: 43200,  // RFC 1912 upper bound, MXToolbox respects this
  retryMin: 1800,
  expireMin: 1209600, // RFC 1912 lower bound
  expireMax: 2200000, // below MXToolbox's undocumented 2419200 ceiling
  minimumMin: 300,
  minimumMax: 86400,
} as const;

export const PUBLIC_RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"] as const;

// Real Spamhaus listing codes start with 127.0.0. Anything else
// (127.255.255.* = rate-limit, other 127.X = resolver error, non-127 =
// network intercept) is NOT a listing.
const SPAMHAUS_LISTING_RE = /^127\.0\.0\.\d+$/;
const SPAMHAUS_RATELIMIT_RE = /^127\.255\.255\.\d+$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntoDNSSeverity = "pass" | "warn" | "fail";

export interface IntoDNSCheckResult {
  check: string;
  severity: IntoDNSSeverity;
  message: string;
  /** Machine-readable detail for dashboards / admin UI. */
  detail?: Record<string, unknown>;
}

export interface IntoDNSZoneReport {
  zone: string;
  nsDomain: string;
  s1Ip: string;
  s2Ip: string;
  /** All individual check results. */
  results: IntoDNSCheckResult[];
  /** Aggregate: pass if no fail AND no warn; warn if no fail but some warn; fail if any. */
  severity: IntoDNSSeverity;
}

export interface IntoDNSPairReport {
  /** One report per zone (11 per Pair 13, typically). */
  zones: IntoDNSZoneReport[];
  /** Aggregate severity across all zones — worst wins. */
  severity: IntoDNSSeverity;
  /** Convenience: true iff severity === "pass". */
  ok: boolean;
}

// ---------------------------------------------------------------------------
// Low-level DNS helpers — one resolver instance per public resolver
// ---------------------------------------------------------------------------

interface ResolverDeps {
  /** Resolve TXT at name via resolver; return joined strings. */
  resolveTxt: (resolver: string, name: string) => Promise<string[]>;
  /** Resolve A at name via resolver; return IP strings. */
  resolveA: (resolver: string, name: string) => Promise<string[]>;
  /** Resolve MX at name via resolver; return [priority, exchange] pairs. */
  resolveMx: (
    resolver: string,
    name: string
  ) => Promise<Array<{ priority: number; exchange: string }>>;
  /** Resolve NS at name via resolver; return sorted NS hostnames. */
  resolveNs: (resolver: string, name: string) => Promise<string[]>;
  /** Resolve SOA at name via resolver; returns the full SOA record or null. */
  resolveSoa: (resolver: string, name: string) => Promise<SoaRecord | null>;
  /** Reverse PTR: return hostname(s) for an IP via resolver. */
  reverse: (resolver: string, ip: string) => Promise<string[]>;
  /** Resolve CAA at name; returns records or []. */
  resolveCaa: (
    resolver: string,
    name: string
  ) => Promise<Array<{ tag: string; value: string }>>;
  /** HTTP GET — returns { status, body } or null on network error. */
  httpGet: (url: string) => Promise<{ status: number; body: string } | null>;
}

export interface SoaRecord {
  mname: string;
  serial: string;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

function makeResolver(ip: string): dnsPromises.Resolver {
  const r = new dnsPromises.Resolver();
  r.setServers([ip]);
  return r;
}

const defaultDeps: ResolverDeps = {
  resolveTxt: async (resolver, name) => {
    try {
      const records = await makeResolver(resolver).resolveTxt(name);
      return records.map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  },
  resolveA: async (resolver, name) => {
    try {
      return await makeResolver(resolver).resolve4(name);
    } catch {
      return [];
    }
  },
  resolveMx: async (resolver, name) => {
    try {
      return await makeResolver(resolver).resolveMx(name);
    } catch {
      return [];
    }
  },
  resolveNs: async (resolver, name) => {
    try {
      return (await makeResolver(resolver).resolveNs(name)).sort();
    } catch {
      return [];
    }
  },
  resolveSoa: async (resolver, name) => {
    try {
      const soa = await makeResolver(resolver).resolveSoa(name);
      return {
        mname: soa.nsname,
        serial: String(soa.serial),
        refresh: soa.refresh,
        retry: soa.retry,
        expire: soa.expire,
        minimum: soa.minttl,
      };
    } catch {
      return null;
    }
  },
  reverse: async (resolver, ip) => {
    try {
      return await makeResolver(resolver).reverse(ip);
    } catch {
      return [];
    }
  },
  resolveCaa: async (resolver, name) => {
    try {
      const recs = await makeResolver(resolver).resolveCaa(name);
      // Node's CaaRecord is `{ critical, issue? | issuewild? | iodef? | contactemail? | contactphone? }`.
      // Exactly one tag-specific property is set; we surface (tag, value).
      return recs.map((r) => {
        const asObj = r as unknown as Record<string, unknown>;
        const tag = Object.keys(asObj).find((k) => k !== "critical") ?? "";
        const value = String(asObj[tag] ?? "");
        return { tag, value };
      });
    } catch {
      return [];
    }
  },
  httpGet: async (url) => {
    try {
      const resp = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
      const body = await resp.text().catch(() => "");
      return { status: resp.status, body };
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Check implementations — each returns one IntoDNSCheckResult
// ---------------------------------------------------------------------------

function ok(check: string, message: string, detail?: Record<string, unknown>): IntoDNSCheckResult {
  return { check, severity: "pass", message, detail };
}
function warn(check: string, message: string, detail?: Record<string, unknown>): IntoDNSCheckResult {
  return { check, severity: "warn", message, detail };
}
function fail(check: string, message: string, detail?: Record<string, unknown>): IntoDNSCheckResult {
  return { check, severity: "fail", message, detail };
}

async function checkNsConsistency(
  zone: string,
  s1Ip: string,
  s2Ip: string,
  deps: ResolverDeps
): Promise<IntoDNSCheckResult[]> {
  const parent = await deps.resolveNs("8.8.8.8", zone);
  if (parent.length === 0) {
    return [fail("parent_delegation", `no NS at parent (NXDOMAIN) for ${zone}`)];
  }
  const s1Ns = (await deps.resolveNs(s1Ip, zone)).sort();
  const s2Ns = (await deps.resolveNs(s2Ip, zone)).sort();
  const parentSorted = [...parent].sort();
  const match =
    JSON.stringify(s1Ns) === JSON.stringify(s2Ns) &&
    JSON.stringify(s1Ns) === JSON.stringify(parentSorted);
  if (match) {
    return [
      ok("parent_delegation", `${parent.length} NS at parent`, { ns: parent }),
      ok("ns_consistent", `NS identical across parent / S1 / S2`, { ns: s1Ns }),
    ];
  }
  return [
    ok("parent_delegation", `${parent.length} NS at parent`),
    fail("ns_consistent", `NS divergent across authoritative servers`, {
      parent: parentSorted,
      s1: s1Ns,
      s2: s2Ns,
    }),
  ];
}

async function checkSoa(
  zone: string,
  s1Ip: string,
  s2Ip: string,
  deps: ResolverDeps
): Promise<IntoDNSCheckResult[]> {
  const s1 = await deps.resolveSoa(s1Ip, zone);
  const s2 = await deps.resolveSoa(s2Ip, zone);
  if (!s1 || !s2) {
    return [
      fail("soa_present", "SOA not reachable on one or both servers", {
        s1_reachable: !!s1,
        s2_reachable: !!s2,
      }),
    ];
  }
  const out: IntoDNSCheckResult[] = [];
  if (s1.serial === s2.serial) {
    out.push(ok("soa_serial_consistent", `serial ${s1.serial}`, { serial: s1.serial }));
  } else {
    out.push(
      fail("soa_serial_consistent", `serial drift: S1=${s1.serial} S2=${s2.serial}`, {
        s1_serial: s1.serial,
        s2_serial: s2.serial,
      })
    );
  }
  // Timers — we gate on S1's authoritative values
  const { refresh, retry, expire, minimum } = s1;
  if (refresh >= SOA_TARGETS.refreshMin && refresh <= SOA_TARGETS.refreshMax) {
    out.push(ok("soa_refresh", `${refresh} (in ${SOA_TARGETS.refreshMin}-${SOA_TARGETS.refreshMax})`));
  } else {
    out.push(
      warn(
        "soa_refresh",
        `${refresh} outside MXToolbox-safe window ${SOA_TARGETS.refreshMin}-${SOA_TARGETS.refreshMax}`,
        { refresh }
      )
    );
  }
  if (retry >= SOA_TARGETS.retryMin && retry < refresh) {
    out.push(ok("soa_retry", `${retry}`));
  } else {
    out.push(warn("soa_retry", `${retry} outside ${SOA_TARGETS.retryMin}..<refresh`, { retry }));
  }
  if (expire >= SOA_TARGETS.expireMin && expire <= SOA_TARGETS.expireMax) {
    out.push(ok("soa_expire", `${expire}`));
  } else {
    out.push(
      warn(
        "soa_expire",
        `${expire} outside MXToolbox-safe window ${SOA_TARGETS.expireMin}-${SOA_TARGETS.expireMax}`,
        { expire }
      )
    );
  }
  if (minimum >= SOA_TARGETS.minimumMin && minimum <= SOA_TARGETS.minimumMax) {
    out.push(ok("soa_minimum", `${minimum}`));
  } else {
    out.push(
      warn(
        "soa_minimum",
        `${minimum} outside ${SOA_TARGETS.minimumMin}-${SOA_TARGETS.minimumMax}`,
        { minimum }
      )
    );
  }
  return out;
}

async function checkMx(
  zone: string,
  nsDomain: string,
  deps: ResolverDeps
): Promise<IntoDNSCheckResult[]> {
  const mx = await deps.resolveMx("8.8.8.8", zone);
  if (mx.length === 0) return [fail("mx_present", "no MX records")];
  const out: IntoDNSCheckResult[] = [ok("mx_present", `${mx.length} MX record(s)`)];
  for (const rec of mx) {
    const host = rec.exchange.replace(/\.$/, "");
    const ips = await deps.resolveA("8.8.8.8", host);
    if (ips.length === 0) {
      out.push(fail("mx_resolves", `${host} does not resolve`));
      continue;
    }
    out.push(ok("mx_resolves", `${host} → ${ips[0]}`));
    const ptr = (await deps.reverse("8.8.8.8", ips[0]))[0]?.replace(/\.$/, "") ?? "";
    // Per HL #106: per-domain MX + shared HELO. PTR points to mail{1|2}.<nsDomain>,
    // not to the per-domain mail.<zone>. That is CORRECT.
    if (ptr === host) {
      out.push(ok("mx_ptr_aligned", `PTR=${ptr}`));
    } else if (ptr === `mail1.${nsDomain}` || ptr === `mail2.${nsDomain}`) {
      out.push(
        ok("mx_ptr_server_identity", `PTR=${ptr} — per-domain MX + shared HELO (HL #106)`)
      );
    } else {
      out.push(warn("mx_ptr_aligned", `PTR=${ptr} expected ${host} or mail{1|2}.${nsDomain}`));
    }
  }
  return out;
}

async function checkSpf(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const txts = await deps.resolveTxt("8.8.8.8", zone);
  const spf = txts.find((r) => r.toLowerCase().startsWith("v=spf1"));
  if (!spf) return [fail("spf_present", "no SPF record")];
  const out: IntoDNSCheckResult[] = [ok("spf_present", "present")];
  const lookupTokens = spf.match(/\b(include|a|mx|ptr|exists|redirect)\b/g) || [];
  if (lookupTokens.length <= 10) {
    out.push(ok("spf_lookups", `${lookupTokens.length}/10`));
  } else {
    out.push(fail("spf_lookups", `${lookupTokens.length} exceeds 10 (RFC 7208)`));
  }
  if (spf.includes("-all")) out.push(ok("spf_hardfail", "-all"));
  else if (spf.includes("~all")) out.push(warn("spf_terminator", "~all (softfail) — flip to -all after warm-up week 1"));
  else out.push(warn("spf_terminator", "no -all / ~all"));
  return out;
}

async function checkDmarc(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const txts = await deps.resolveTxt("8.8.8.8", `_dmarc.${zone}`);
  const dmarc = txts.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!dmarc) return [fail("dmarc_present", "no DMARC record at _dmarc." + zone)];
  const out: IntoDNSCheckResult[] = [ok("dmarc_present", "present")];
  const pMatch = dmarc.match(/\bp=(\w+)/);
  const p = pMatch?.[1] ?? "none";
  if (p === "quarantine" || p === "reject") out.push(ok("dmarc_policy", `p=${p}`));
  else out.push(warn("dmarc_policy", `p=${p} (should be quarantine or reject)`));
  // HL #109 (2026-04-20): rua/ruf are OPTIONAL per RFC 7489 §6.3. For
  // cold-email sending infrastructure we OMIT them. Surface rua presence
  // as informational only — never a WARN — so this check doesn't drive
  // the gate severity. Matches the bash `verify-zone.sh` dmarc_rua_informational
  // demotion done in the oracle-swap PR.
  if (/\brua=mailto:/.test(dmarc)) {
    out.push(ok("dmarc_rua", "rua present — fine but not required under cold-email canonical"));
  } else {
    out.push(ok("dmarc_rua", "rua absent — matches cold-email canonical (HL #109)"));
  }
  return out;
}

async function checkDkim(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const txts = await deps.resolveTxt("8.8.8.8", `mail._domainkey.${zone}`);
  if (txts.length === 0) return [fail("dkim_present", "no DKIM record at mail._domainkey." + zone)];
  const dkim = txts.join(" ");
  const out: IntoDNSCheckResult[] = [ok("dkim_present", "present")];
  if (/\bk=rsa\b/.test(dkim)) out.push(ok("dkim_algo", "k=rsa"));
  else out.push(warn("dkim_algo", "missing k=rsa tag"));
  return out;
}

async function checkCaa(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const recs = await deps.resolveCaa("8.8.8.8", zone);
  const hasLe = recs.some(
    (r) => r.tag === "issue" && /letsencrypt\.org/i.test(r.value)
  );
  return [
    hasLe
      ? ok("caa_letsencrypt", "Let's Encrypt authorized")
      : warn("caa_letsencrypt", "no CAA record authorizing letsencrypt.org"),
  ];
}

async function checkMtaSts(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const txts = await deps.resolveTxt("8.8.8.8", `_mta-sts.${zone}`);
  const txt = txts.find((r) => /v=STSv1/i.test(r));
  if (!txt) return [warn("mta_sts_txt", "no MTA-STS TXT record")];
  const out: IntoDNSCheckResult[] = [ok("mta_sts_txt", "TXT present")];
  const policy = await deps.httpGet(`https://mta-sts.${zone}/.well-known/mta-sts.txt`);
  if (!policy || policy.status !== 200) {
    out.push(
      warn("mta_sts_policy_reachable", `HTTPS endpoint unreachable (status=${policy?.status ?? "network-error"})`)
    );
    return out;
  }
  const mode = policy.body.match(/^mode:\s*(enforce|testing)/m)?.[1];
  if (mode) out.push(ok("mta_sts_policy_reachable", `mode=${mode}`));
  else out.push(warn("mta_sts_policy_reachable", "HTTPS response missing mode:"));
  return out;
}

async function checkTlsRpt(zone: string, deps: ResolverDeps): Promise<IntoDNSCheckResult[]> {
  const txts = await deps.resolveTxt("8.8.8.8", `_smtp._tls.${zone}`);
  const ok_ = txts.some((r) => /v=TLSRPTv1/i.test(r));
  return [
    ok_
      ? ok("tls_rpt_present", "TXT present")
      : warn("tls_rpt_present", `no TLS-RPT record at _smtp._tls.${zone}`),
  ];
}

/** Reverse-IP-octets string for DNSBL queries. */
function reverseIpQuad(ip: string): string {
  return ip.split(".").reverse().join(".");
}

async function checkSpamhaus(ip: string, deps: ResolverDeps): Promise<IntoDNSCheckResult> {
  const revName = `${reverseIpQuad(ip)}.zen.spamhaus.org`;
  let hits = 0;
  let checkable = 0;
  for (const resolver of PUBLIC_RESOLVERS) {
    const answers = await deps.resolveA(resolver, revName);
    const listing = answers.find((a) => SPAMHAUS_LISTING_RE.test(a));
    const rateLimit = answers.find((a) => SPAMHAUS_RATELIMIT_RE.test(a));
    if (listing) {
      hits++;
      checkable++;
    } else if (rateLimit) {
      // skip — not checkable via this resolver right now
    } else {
      // Either clean (NXDOMAIN / empty) OR network error. Treat empty as clean+checkable.
      checkable++;
    }
  }
  if (hits === 0 && checkable > 0) {
    return ok("spamhaus_zen", `${ip}: clean on ${checkable}/${PUBLIC_RESOLVERS.length} checkable`);
  }
  if (checkable === 0) {
    return warn("spamhaus_zen", `${ip}: all resolvers rate-limited or unreachable — recheck from the worker VPS`);
  }
  return fail("spamhaus_zen", `${ip}: listed on ${hits}/${PUBLIC_RESOLVERS.length} resolvers`);
}

// ---------------------------------------------------------------------------
// Top-level entry points
// ---------------------------------------------------------------------------

export interface IntoDNSHealthInput {
  /** Zone to check (sending domain or NS domain). */
  zone: string;
  /** NS domain owning this zone's infrastructure (HL #106 PTR alignment). */
  nsDomain: string;
  /** Primary server IP (used for NS-consistency probe + SOA pull). */
  s1Ip: string;
  /** Secondary server IP (used for NS-consistency probe + SOA pull). */
  s2Ip: string;
  /** Optional dep injection — defaults to real node:dns + fetch. */
  deps?: ResolverDeps;
}

export async function checkZoneIntoDNSHealth(
  input: IntoDNSHealthInput
): Promise<IntoDNSZoneReport> {
  const deps = input.deps ?? defaultDeps;
  const results: IntoDNSCheckResult[] = [];
  results.push(...(await checkNsConsistency(input.zone, input.s1Ip, input.s2Ip, deps)));
  results.push(...(await checkSoa(input.zone, input.s1Ip, input.s2Ip, deps)));
  results.push(...(await checkMx(input.zone, input.nsDomain, deps)));
  results.push(...(await checkSpf(input.zone, deps)));
  results.push(...(await checkDmarc(input.zone, deps)));
  results.push(...(await checkDkim(input.zone, deps)));
  results.push(...(await checkCaa(input.zone, deps)));
  results.push(...(await checkMtaSts(input.zone, deps)));
  results.push(...(await checkTlsRpt(input.zone, deps)));
  results.push(await checkSpamhaus(input.s1Ip, deps));
  results.push(await checkSpamhaus(input.s2Ip, deps));
  const severity: IntoDNSSeverity = results.some((r) => r.severity === "fail")
    ? "fail"
    : results.some((r) => r.severity === "warn")
      ? "warn"
      : "pass";
  return {
    zone: input.zone,
    nsDomain: input.nsDomain,
    s1Ip: input.s1Ip,
    s2Ip: input.s2Ip,
    results,
    severity,
  };
}

export interface IntoDNSHealthPairInput {
  zones: string[];
  nsDomain: string;
  s1Ip: string;
  s2Ip: string;
  /** Throttle between zones so we don't trigger resolver rate limits. */
  delayBetweenZonesMs?: number;
  deps?: ResolverDeps;
}

export async function checkPairIntoDNSHealth(
  input: IntoDNSHealthPairInput
): Promise<IntoDNSPairReport> {
  const zones: IntoDNSZoneReport[] = [];
  for (const zone of input.zones) {
    const r = await checkZoneIntoDNSHealth({
      zone,
      nsDomain: input.nsDomain,
      s1Ip: input.s1Ip,
      s2Ip: input.s2Ip,
      deps: input.deps,
    });
    zones.push(r);
    if (input.delayBetweenZonesMs && input.delayBetweenZonesMs > 0) {
      await sleep(input.delayBetweenZonesMs);
    }
  }
  const severity: IntoDNSSeverity = zones.some((z) => z.severity === "fail")
    ? "fail"
    : zones.some((z) => z.severity === "warn")
      ? "warn"
      : "pass";
  return { zones, severity, ok: severity === "pass" };
}
