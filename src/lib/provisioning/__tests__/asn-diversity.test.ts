/**
 * BGP-ASN subnet-diversity tests.
 *
 * Mirrors the style of saga-dry-run.test.ts — plain tsx runner, async
 * functions, custom assert helper, console logging. No jest/vitest.
 *
 * All whois calls are mocked via the injectable execFn in getAsn(), so these
 * tests do not touch the network. clearAsnCache() is called between cases
 * so each scenario starts with an empty memoization Map.
 */

import {
  getAsn,
  pairSharesAsn,
  clearAsnCache,
} from "../asn-diversity";
import { DryRunProvider, DRY_RUN_ASN_1, DRY_RUN_ASN_2 } from "../providers/dry-run";

// ============================================
// Canned Cymru verbose responses
// ============================================

// Genuine Cymru verbose output format for 8.8.8.8 (ASN 15169 — Google).
const CYMRU_GOOGLE = `AS      | IP               | BGP Prefix          | CC | Registry | Allocated  | AS Name
15169   | 8.8.8.8          | 8.8.8.0/24          | US | arin     | 2023-12-28 | GOOGLE, US
`;

// Same ASN/prefix but applied to a different Google IP — used for the
// same-ASN pair test.
const CYMRU_GOOGLE_ALT = `AS      | IP               | BGP Prefix          | CC | Registry | Allocated  | AS Name
15169   | 8.8.4.4          | 8.8.4.0/24          | US | arin     | 2023-12-28 | GOOGLE, US
`;

// Different ASN — AS8075 (Microsoft) for the different-ASN pair test.
const CYMRU_MICROSOFT = `AS      | IP               | BGP Prefix          | CC | Registry | Allocated  | AS Name
8075    | 20.112.52.29     | 20.112.0.0/14       | US | arin     | 2021-06-15 | MICROSOFT-CORP-MSN-AS-BLOCK, US
`;

// ============================================
// Helpers
// ============================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

/**
 * Build a mock execFn that returns canned output keyed by the IP embedded
 * in the Cymru argument (" -v <ip>").
 */
function makeMockExec(responses: Record<string, string>) {
  return async (_cmd: string, args: string[]): Promise<string> => {
    // args[2] is " -v <ip>". Extract the IP.
    const arg = args[2] ?? "";
    const match = arg.match(/\s-v\s+(\S+)/);
    const ip = match ? match[1] : "";
    const out = responses[ip];
    if (out === undefined) {
      throw new Error(`mock execFn: no canned response for ip=${ip}`);
    }
    return out;
  };
}

/** Mock execFn that always rejects with a timeout-ish error. */
async function timeoutExec(_cmd: string, _args: string[]): Promise<string> {
  const err = new Error("Command failed: whois -h whois.cymru.com  -v 8.8.8.8 (timed out)") as Error & { code?: string; killed?: boolean };
  err.code = "ETIMEDOUT";
  err.killed = true;
  throw err;
}

// ============================================
// Tests
// ============================================

async function testParserExtractsAsn(): Promise<void> {
  console.log("\n=== Parser unit test ===\n");
  clearAsnCache();

  const exec = makeMockExec({ "8.8.8.8": CYMRU_GOOGLE });
  const result = await getAsn("8.8.8.8", { execFn: exec, skipCache: true });

  assert(result.asn === 15169, `expected asn=15169, got ${result.asn}`);
  assert(result.timedOut === false, "should not be timed out");
  assert(result.ip === "8.8.8.8", `expected ip=8.8.8.8, got ${result.ip}`);
  assert(
    result.bgpPrefix === "8.8.8.0/24",
    `expected bgpPrefix=8.8.8.0/24, got ${result.bgpPrefix}`
  );
  assert(result.country === "US", `expected country=US, got ${result.country}`);
  assert(
    typeof result.asName === "string" && result.asName.includes("GOOGLE"),
    `expected asName to contain GOOGLE, got ${result.asName}`
  );

  console.log("✓ parser extracts ASN 15169 from canned cymru response");
}

async function testSameAsnFailsDiversity(): Promise<void> {
  console.log("\n=== Same-ASN case (should FAIL diversity) ===\n");
  clearAsnCache();

  const exec = makeMockExec({
    "8.8.8.8": CYMRU_GOOGLE,
    "8.8.4.4": CYMRU_GOOGLE_ALT,
  });

  // Prime the cache using the injected exec, because pairSharesAsn's internal
  // getAsn calls fall back to the default (real) exec if we don't.
  await getAsn("8.8.8.8", { execFn: exec, skipCache: true });
  await getAsn("8.8.4.4", { execFn: exec, skipCache: true });

  const result = await pairSharesAsn("8.8.8.8", "8.8.4.4");

  assert(result.ip1Asn === 15169, `expected ip1Asn=15169, got ${result.ip1Asn}`);
  assert(result.ip2Asn === 15169, `expected ip2Asn=15169, got ${result.ip2Asn}`);
  assert(result.diverse === false, "same-ASN pair should be NOT diverse");
  assert(
    result.reason === "same_asn",
    `expected reason=same_asn, got ${result.reason}`
  );
  assert(
    result.warning === undefined,
    `expected no warning on clean same-ASN result, got: ${result.warning}`
  );

  console.log("✓ same-ASN pair fails diversity with reason=same_asn");
}

async function testDifferentAsnPassesDiversity(): Promise<void> {
  console.log("\n=== Different-ASN case (should PASS diversity) ===\n");
  clearAsnCache();

  const exec = makeMockExec({
    "8.8.8.8": CYMRU_GOOGLE,
    "20.112.52.29": CYMRU_MICROSOFT,
  });

  await getAsn("8.8.8.8", { execFn: exec, skipCache: true });
  await getAsn("20.112.52.29", { execFn: exec, skipCache: true });

  const result = await pairSharesAsn("8.8.8.8", "20.112.52.29");

  assert(result.ip1Asn === 15169, `expected ip1Asn=15169, got ${result.ip1Asn}`);
  assert(result.ip2Asn === 8075, `expected ip2Asn=8075, got ${result.ip2Asn}`);
  assert(result.diverse === true, "different-ASN pair should BE diverse");
  assert(
    result.reason === "different_asn",
    `expected reason=different_asn, got ${result.reason}`
  );
  assert(
    result.warning === undefined,
    `expected no warning on clean different-ASN result, got: ${result.warning}`
  );

  console.log("✓ different-ASN pair passes diversity with reason=different_asn");
}

async function testDryRunPairHasDistinctAsns(): Promise<void> {
  console.log("\n=== DryRunProvider pair ASN diversity ===\n");
  clearAsnCache();

  // Create two servers the same way the saga does — two sequential
  // createServer() calls. The provider is responsible for handing out IPs
  // from pools that map to different documentation ASNs.
  const provider = new DryRunProvider();
  const s1 = await provider.createServer({ name: "p-s1", region: "r1", size: "s1", image: "u22" });
  const s2 = await provider.createServer({ name: "p-s2", region: "r1", size: "s1", image: "u22" });

  assert(
    s1.ip !== s2.ip,
    `expected distinct IPs, got ${s1.ip} and ${s2.ip}`
  );

  // Run the real getAsn() — it must short-circuit to the documentation ASN
  // without hitting the network. The default exec path is available but
  // should never be called for DryRun-minted IPs.
  const r1 = await getAsn(s1.ip, { skipCache: true });
  const r2 = await getAsn(s2.ip, { skipCache: true });

  const validAsns = new Set([DRY_RUN_ASN_1, DRY_RUN_ASN_2]);
  assert(
    r1.asn !== null && validAsns.has(r1.asn),
    `s1 asn should be 64496 or 64497, got ${r1.asn}`
  );
  assert(
    r2.asn !== null && validAsns.has(r2.asn),
    `s2 asn should be 64496 or 64497, got ${r2.asn}`
  );
  assert(
    r1.asn !== r2.asn,
    `DryRun pair must resolve to two DIFFERENT ASNs — got ${r1.asn} and ${r2.asn}`
  );

  // pairSharesAsn must treat the dry-run pair as diverse.
  const diversity = await pairSharesAsn(s1.ip, s2.ip);
  assert(
    diversity.diverse === true,
    "dry-run pair must pass diversity check"
  );
  assert(
    diversity.reason === "different_asn",
    `expected reason=different_asn, got ${diversity.reason}`
  );

  console.log(
    `✓ DryRunProvider fake pair ${s1.ip} (AS${r1.asn}) / ${s2.ip} (AS${r2.asn}) passes diversity`
  );
}

async function testTimeoutWarnsAndPasses(): Promise<void> {
  console.log("\n=== Timeout case (should WARN but PASS) ===\n");
  clearAsnCache();

  // Prime the cache with timeout results using the timeout exec.
  const r1 = await getAsn("8.8.8.8", { execFn: timeoutExec, skipCache: true });
  const r2 = await getAsn("20.112.52.29", { execFn: timeoutExec, skipCache: true });

  assert(r1.timedOut === true, "first lookup should be flagged timed out");
  assert(r1.asn === null, "timed-out asn should be null");
  assert(r2.timedOut === true, "second lookup should be flagged timed out");

  const result = await pairSharesAsn("8.8.8.8", "20.112.52.29");

  assert(result.ip1Asn === null, `expected ip1Asn=null on timeout, got ${result.ip1Asn}`);
  assert(result.ip2Asn === null, `expected ip2Asn=null on timeout, got ${result.ip2Asn}`);
  assert(result.diverse === true, "timeout must NOT block the pair");
  assert(
    result.reason === "lookup_timeout",
    `expected reason=lookup_timeout, got ${result.reason}`
  );
  assert(
    typeof result.warning === "string" && result.warning.length > 0,
    "warning should be populated on timeout"
  );

  console.log("✓ timeout warns and does not block the pair");
}

// ============================================
// Main
// ============================================

export async function testAsnDiversity(): Promise<void> {
  console.log("BGP-ASN Diversity Test");
  console.log("====================================\n");

  await testParserExtractsAsn();
  await testSameAsnFailsDiversity();
  await testDifferentAsnPassesDiversity();
  await testTimeoutWarnsAndPasses();
  await testDryRunPairHasDistinctAsns();

  console.log("\n====================================");
  console.log("ALL TESTS PASSED ✓");
  console.log("====================================\n");
}

if (require.main === module) {
  testAsnDiversity()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("\n====================================");
      console.error("TEST FAILED:", err instanceof Error ? err.message : err);
      console.error("====================================\n");
      process.exit(1);
    });
}
