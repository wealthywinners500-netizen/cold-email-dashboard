// ============================================================================
// BGP-ASN-based pair subnet diversity check.
//
// Replaces the /12 CIDR-width check in ip-blacklist-check.ts#pairSharesSubnet.
// Rationale: Linode and other VPS providers assign IPs out of large BGP
// prefixes that don't line up cleanly with /12 boundaries. Two IPs can live
// in different /12s and still belong to the same origin ASN (meaning the
// same BGP advertisement, same reputation pool for receiving MTAs). The
// inverse is also true — two IPs inside the same /12 can belong to
// different ASNs when an allocation has been split and re-delegated.
//
// The canonical "are these on the same subnet for cold-email purposes"
// question is answered by BGP origin ASN. We look that up via Team Cymru's
// whois service, which publishes origin-ASN data for every routed prefix.
//
// Command format:
//   whois -h whois.cymru.com " -v <ip>"
// The leading space inside the quoted argument enables Cymru's verbose
// multi-field response. Without the space, the output is shorter and the
// header layout differs.
//
// Verbose response format:
//   AS      | IP               | BGP Prefix          | CC | Registry | Allocated  | AS Name
//   15169   | 8.8.8.8          | 8.8.8.0/24          | US | arin     | 2023-12-28 | GOOGLE, US
//
// Failure modes:
//   - Timeout: warn-but-accept. Rationale: whois is external, can flap,
//     and blocking provisioning on an intermittent lookup is worse than
//     the rare false-accept of a same-ASN pair.
//   - Parse failure: warn-but-accept. Same rationale.
//   - Successful lookup, different ASN: accept.
//   - Successful lookup, same ASN: REJECT (this is the whole point).
//
// Results are memoized in-process for 1 hour. Tests call clearAsnCache().
// ============================================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDryRunAsn } from './providers/dry-run';

const execFileAsync = promisify(execFile);

export interface AsnLookupResult {
  ip: string;
  asn: number | null;       // null on timeout / parse failure
  asName?: string;
  country?: string;
  bgpPrefix?: string;
  error?: string;
  timedOut: boolean;
}

export interface PairAsnDiversity {
  ip1Asn: number | null;
  ip2Asn: number | null;
  diverse: boolean;     // true if different non-null ASNs, OR (any lookup timed out)
  reason: 'same_asn' | 'different_asn' | 'lookup_timeout' | 'parse_failure';
  warning?: string;     // populated on timeout/parse failure
}

type ExecFn = (cmd: string, args: string[]) => Promise<string>;

interface CacheEntry {
  timestamp: number;
  result: AsnLookupResult;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TIMEOUT_MS = 5000;

// Module-level Map, cleared via clearAsnCache() (used by tests).
const asnCache = new Map<string, CacheEntry>();

/**
 * Default spawn-based exec function. Uses util.promisify(execFile) so the
 * shell isn't involved and the leading-space argument survives verbatim.
 * Returns stdout as a string; rejects on non-zero exit or timeout.
 */
async function defaultExec(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  return stdout;
}

/**
 * Parse a Cymru verbose whois response.
 *
 * Expected layout (tab/space tolerant — we split on `|` and trim):
 *   AS      | IP               | BGP Prefix          | CC | Registry | Allocated  | AS Name
 *   15169   | 8.8.8.8          | 8.8.8.0/24          | US | arin     | 2023-12-28 | GOOGLE, US
 *
 * Returns null on any parse failure.
 */
function parseCymruResponse(output: string, ip: string): AsnLookupResult | null {
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  for (const line of lines) {
    // Skip the header line. Cymru's header starts with "AS" and contains "|".
    // A data line starts with a numeric ASN.
    if (!line.includes('|')) continue;
    const fields = line.split('|').map((f) => f.trim());
    if (fields.length < 2) continue;

    const asnField = fields[0];
    // Header detection: non-numeric first column.
    if (!/^\d+/.test(asnField)) continue;

    // Parse ASN (the field may be something like "15169" or "NA" for unrouted).
    const asnMatch = asnField.match(/^(\d+)/);
    if (!asnMatch) continue;
    const asn = parseInt(asnMatch[1], 10);
    if (Number.isNaN(asn)) continue;

    const result: AsnLookupResult = {
      ip,
      asn,
      timedOut: false,
    };
    if (fields[2]) result.bgpPrefix = fields[2];
    if (fields[3]) result.country = fields[3];
    if (fields[6]) result.asName = fields[6];
    return result;
  }

  return null;
}

/**
 * Look up the origin ASN for an IPv4 address via Team Cymru whois.
 *
 * - Memoizes results (including errors) for 1 hour in-process.
 * - Injectable execFn for tests.
 * - Returns AsnLookupResult with asn=null on any failure; never throws.
 */
export async function getAsn(
  ip: string,
  opts?: {
    timeoutMs?: number;
    skipCache?: boolean;
    execFn?: ExecFn;
  }
): Promise<AsnLookupResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipCache = opts?.skipCache ?? false;
  const execFn = opts?.execFn ?? defaultExec;

  // Cache check.
  if (!skipCache) {
    const cached = asnCache.get(ip);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.result;
    }
  }

  // DryRunProvider short-circuit: IPs minted by dry-run provisioning come
  // out of RFC-5737 documentation pools (TEST-NET-1/2) and map to two
  // distinct RFC-5398 documentation ASNs. Skipping whois here means a
  // dry-run pair reliably reports different_asn rather than "unrouted".
  const synthetic = getDryRunAsn(ip);
  if (synthetic !== null) {
    const result: AsnLookupResult = {
      ip,
      asn: synthetic,
      asName: 'DRY_RUN_DOCUMENTATION',
      timedOut: false,
    };
    asnCache.set(ip, { timestamp: Date.now(), result });
    return result;
  }

  // The leading space in " -v <ip>" is required by Cymru to enable verbose
  // output. We pass it as a single argument so execFile preserves it.
  const cymruArg = ` -v ${ip}`;
  const args = ['-h', 'whois.cymru.com', cymruArg];

  let output: string;
  try {
    output = await execFn('whois', args);
  } catch (err: unknown) {
    const e = err as { code?: string; killed?: boolean; signal?: string; message?: string };
    const isTimeout =
      e?.code === 'ETIMEDOUT' ||
      e?.killed === true ||
      e?.signal === 'SIGTERM' ||
      (typeof e?.message === 'string' && /timed? ?out/i.test(e.message));

    const result: AsnLookupResult = {
      ip,
      asn: null,
      timedOut: !!isTimeout,
      error: isTimeout ? 'timeout' : String(e?.message ?? err),
    };
    asnCache.set(ip, { timestamp: Date.now(), result });
    return result;
  }

  // Silence unused-var warnings if timeoutMs isn't otherwise consumed in custom
  // execFns (default exec uses DEFAULT_TIMEOUT_MS internally; tests inject).
  void timeoutMs;

  const parsed = parseCymruResponse(output, ip);
  if (!parsed) {
    const result: AsnLookupResult = {
      ip,
      asn: null,
      timedOut: false,
      error: 'parse_failure',
    };
    asnCache.set(ip, { timestamp: Date.now(), result });
    return result;
  }

  asnCache.set(ip, { timestamp: Date.now(), result: parsed });
  return parsed;
}

/**
 * Determine whether a pair of IPs passes BGP-ASN subnet diversity.
 *
 * Policy:
 *   - Same ASN → diverse=false, reject.
 *   - Different ASN → diverse=true, accept.
 *   - Timeout on either lookup → diverse=true, accept WITH warning.
 *   - Parse failure on either lookup → diverse=true, accept WITH warning.
 *
 * Warnings are surfaced so the caller can log them; they do not block the
 * pair. A pair is only blocked on a confirmed same-ASN match.
 */
export async function pairSharesAsn(
  ip1: string,
  ip2: string,
  opts?: { timeoutMs?: number }
): Promise<PairAsnDiversity> {
  const [r1, r2] = await Promise.all([
    getAsn(ip1, { timeoutMs: opts?.timeoutMs }),
    getAsn(ip2, { timeoutMs: opts?.timeoutMs }),
  ]);

  if (r1.timedOut || r2.timedOut) {
    return {
      ip1Asn: r1.asn,
      ip2Asn: r2.asn,
      diverse: true,
      reason: 'lookup_timeout',
      warning: 'ASN lookup timed out for at least one IP; accepting pair with a warning',
    };
  }

  if (r1.asn === null || r2.asn === null) {
    return {
      ip1Asn: r1.asn,
      ip2Asn: r2.asn,
      diverse: true,
      reason: 'parse_failure',
      warning: 'Could not determine ASN from whois output; accepting pair with a warning',
    };
  }

  const diverse = r1.asn !== r2.asn;
  return {
    ip1Asn: r1.asn,
    ip2Asn: r2.asn,
    diverse,
    reason: diverse ? 'different_asn' : 'same_asn',
  };
}

/**
 * Clear the in-memory ASN cache. Intended for tests; production code does
 * not need to call this.
 */
export function clearAsnCache(): void {
  asnCache.clear();
}
