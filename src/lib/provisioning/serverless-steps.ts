// ============================================
// Pure-function step runners for the serverless-class steps
// (configure_registrar, set_ptr, verification_gate, await_dns_propagation).
//
// Hard Lesson #59 / Test #14 (2026-04-10) made the case for moving
// every long-running provider poll OFF Vercel's 60s function cap. The
// per-step decomposition that came out of that lesson left the
// short-lived API steps (registrar NS / PTR) on the serverless side
// and the SSH steps on the worker side, but kept the bodies inline in
// `/api/provisioning/[jobId]/execute-step/route.ts`.
//
// Test #15 surfaced a related need: the worker now drives jobs
// autonomously via `pollAdvanceableJobs` (no wizard polling required),
// which means the worker side of the bridge has to be able to run
// EVERY step type — not just the SSH ones. This module exposes the
// step bodies as pure functions taking just `jobId`, so both:
//
//   1. Vercel `executeServerlessStep` (for wizard-driven jobs), and
//   2. The worker `handleProvisionStep` (for autonomous jobs)
//
// can call them with identical semantics. Each function does its own
// Supabase lookups (lazy-init Hard Lesson #34), its own provider/
// registrar instantiation, and its own retry logic. Throws on failure
// — caller turns that into a `failed` step row.
// ============================================

import { createAdminClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/provisioning/encryption";
import {
  getVPSProvider,
  getDNSRegistrar,
} from "@/lib/provisioning/provider-registry";
import type {
  ProvisioningJobRow,
  StepType,
  VPSProviderType,
  DNSRegistrarType,
} from "@/lib/provisioning/types";
import { DNSVerifier } from "@/lib/provisioning/verification";
import { checkPort25 } from "@/lib/provisioning/checks/port25";
import { checkSSLCert } from "@/lib/provisioning/checks/ssl-cn";
import { promises as dnsPromises } from "dns";

export interface StepRunResult {
  output: string;
  metadata?: Record<string, unknown>;
}

// ----- Helpers ---------------------------------------------------------------

interface LoadedJobContext {
  job: ProvisioningJobRow;
  vpsRow: {
    provider_type: string;
    config: Record<string, unknown>;
    api_key_encrypted: string | null;
    api_secret_encrypted: string | null;
  };
  dnsRow: {
    registrar_type: string;
    config: Record<string, unknown>;
    api_key_encrypted: string | null;
    api_secret_encrypted: string | null;
  };
  server1IP: string;
  server2IP: string;
}

async function loadJobContext(jobId: string): Promise<LoadedJobContext> {
  const supabase = await createAdminClient();

  const { data: job, error: jobErr } = await supabase
    .from("provisioning_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    throw new Error(
      `loadJobContext: job ${jobId} not found: ${jobErr?.message || "no row"}`
    );
  }

  const provJob = job as ProvisioningJobRow;

  const { data: vpsRow } = await supabase
    .from("vps_providers")
    .select("*")
    .eq("id", provJob.vps_provider_id)
    .single();

  const { data: dnsRow } = await supabase
    .from("dns_registrars")
    .select("*")
    .eq("id", provJob.dns_registrar_id)
    .single();

  if (!vpsRow || !dnsRow) {
    throw new Error(
      `loadJobContext: VPS provider or DNS registrar config not found for job ${jobId}`
    );
  }

  // Pull IPs from create_vps step metadata first, fall back to job row.
  const { data: createVpsStep } = await supabase
    .from("provisioning_steps")
    .select("metadata")
    .eq("job_id", jobId)
    .eq("step_type", "create_vps")
    .maybeSingle();

  const meta =
    (createVpsStep?.metadata as Record<string, unknown> | null) || {};
  const server1IP =
    (meta.server1IP as string) || provJob.server1_ip || "";
  const server2IP =
    (meta.server2IP as string) || provJob.server2_ip || "";

  return {
    job: provJob,
    vpsRow: vpsRow as LoadedJobContext["vpsRow"],
    dnsRow: dnsRow as LoadedJobContext["dnsRow"],
    server1IP,
    server2IP,
  };
}

async function getRegistrar(
  dnsRow: LoadedJobContext["dnsRow"]
) {
  const dnsConfig: Record<string, unknown> = {
    ...dnsRow.config,
    apiKey: dnsRow.api_key_encrypted
      ? decrypt(dnsRow.api_key_encrypted)
      : undefined,
    apiSecret: dnsRow.api_secret_encrypted
      ? decrypt(dnsRow.api_secret_encrypted)
      : undefined,
  };
  return getDNSRegistrar(dnsRow.registrar_type as DNSRegistrarType, dnsConfig);
}

async function getProvider(vpsRow: LoadedJobContext["vpsRow"]) {
  const vpsConfig: Record<string, unknown> = {
    ...vpsRow.config,
    apiKey: vpsRow.api_key_encrypted
      ? decrypt(vpsRow.api_key_encrypted)
      : undefined,
    apiSecret: vpsRow.api_secret_encrypted
      ? decrypt(vpsRow.api_secret_encrypted)
      : undefined,
  };
  return getVPSProvider(vpsRow.provider_type as VPSProviderType, vpsConfig);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ----- configure_registrar ---------------------------------------------------

export async function runConfigureRegistrar(
  jobId: string
): Promise<StepRunResult> {
  const ctx = await loadJobContext(jobId);
  const { job, server1IP, server2IP, dnsRow } = ctx;

  if (!server1IP || !server2IP) {
    throw new Error(
      "Server IPs not available — create_vps step must complete first"
    );
  }

  const registrar = await getRegistrar(dnsRow);

  // Set nameservers on the ns_domain itself (with glue).
  await registrar.setNameservers(job.ns_domain, [
    `ns1.${job.ns_domain}`,
    `ns2.${job.ns_domain}`,
  ]);

  await registrar.setGlueRecords(job.ns_domain, [
    { hostname: `ns1.${job.ns_domain}`, ip: server1IP },
    { hostname: `ns2.${job.ns_domain}`, ip: server2IP },
  ]);

  // Hard Lesson #62 (2026-04-11): delegate every sending domain to the new
  // pair's nameservers via updateNameserversOnly (NOT setNameservers, which
  // is a stash on Ionos). The pair-provisioning-saga had this loop; the
  // canonical execute-step driver was missing it before commit 506a2a8.
  const ns1Host = `ns1.${job.ns_domain}`;
  const ns2Host = `ns2.${job.ns_domain}`;
  const sendingDelegation: Array<{
    domain: string;
    ok: boolean;
    error?: string;
  }> = [];
  for (const sendingDomain of (job.sending_domains as string[] | null) || []) {
    try {
      await registrar.updateNameserversOnly(sendingDomain, [ns1Host, ns2Host]);
      sendingDelegation.push({ domain: sendingDomain, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendingDelegation.push({ domain: sendingDomain, ok: false, error: msg });
    }
  }

  const failed = sendingDelegation.filter((d) => !d.ok);
  if (failed.length > 0) {
    throw new Error(
      `Sending domain NS delegation failed for: ${failed
        .map((d) => `${d.domain} (${d.error})`)
        .join("; ")}`
    );
  }

  const okList =
    sendingDelegation.map((d) => d.domain).join(", ") || "(none)";
  return {
    output: `DNS configured for ${job.ns_domain}: NS → ns1/ns2, glue → ${server1IP}/${server2IP} (${dnsRow.registrar_type}). Sending domains delegated to ${ns1Host}/${ns2Host}: ${okList}`,
  };
}

// ----- set_ptr ---------------------------------------------------------------

export async function runSetPtr(jobId: string): Promise<StepRunResult> {
  const ctx = await loadJobContext(jobId);
  const { job, server1IP, server2IP, vpsRow } = ctx;

  if (!server1IP || !server2IP) {
    throw new Error(
      "Server IPs not available — create_vps step must complete first"
    );
  }

  const provider = await getProvider(vpsRow);

  // Retry with exponential backoff (DNS propagation may not be instant).
  // The await_dns_propagation step usually makes this near-instant, but
  // we keep the retries as a safety net.
  const retryDelays = [0, 60_000, 180_000, 300_000];
  let lastError = "";

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (attempt > 0) {
      await delay(retryDelays[attempt]);
    }
    try {
      await provider.setPTR({
        ip: server1IP,
        hostname: `mail1.${job.ns_domain}`,
      });
      await provider.setPTR({
        ip: server2IP,
        hostname: `mail2.${job.ns_domain}`,
      });
      return {
        output: `PTR records set: mail1.${job.ns_domain} → ${server1IP}, mail2.${job.ns_domain} → ${server2IP}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      if (msg.includes("not supported") || msg.includes("not implemented")) {
        return {
          output: `PTR via API not supported by ${vpsRow.provider_type} — manual PTR required`,
          metadata: { manualRequired: true },
        };
      }

      // DNS propagation in flight — retry
      if (
        msg.includes("unable to perform a lookup") ||
        msg.includes("Unable to look up") ||
        msg.includes("400")
      ) {
        continue;
      }

      throw err;
    }
  }

  return {
    output: `PTR could not be set automatically after ${retryDelays.length} attempts (DNS propagation pending). Last error: ${lastError}. Manual setup: ${server1IP} → mail1.${job.ns_domain}, ${server2IP} → mail2.${job.ns_domain}`,
    metadata: { manualRequired: true },
  };
}

// ----- await_dns_propagation -------------------------------------------------
//
// New step inserted between configure_registrar (3) and setup_dns_zones (4).
// Polls public resolvers (8.8.8.8, 1.1.1.1, 9.9.9.9) for the NS delegation
// of `ns_domain` until at least 2/3 resolvers return ns1/ns2 hosts within
// the domain. Waits up to 75 minutes — Ionos NS propagation typically takes
// 10-30 min, occasionally 60 min when their cache is cold. Without this gate,
// downstream steps that issue Let's Encrypt certs will fail with
// `urn:ietf:params:acme:error:dns` because LE's resolver doesn't see the
// new authoritative nameservers yet.

const PROPAGATION_RESOLVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
const PROPAGATION_MAX_MS = 75 * 60 * 1000; // 75 minutes
const PROPAGATION_POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

async function resolveNS(
  domain: string,
  resolverIP: string
): Promise<string[] | null> {
  try {
    const resolver = new dnsPromises.Resolver();
    resolver.setServers([resolverIP]);
    const records = await resolver.resolveNs(domain);
    return records.map((r) => r.toLowerCase());
  } catch {
    return null;
  }
}

export async function runAwaitDnsPropagation(
  jobId: string
): Promise<StepRunResult> {
  const ctx = await loadJobContext(jobId);
  const { job } = ctx;

  const expectedNs1 = `ns1.${job.ns_domain}`.toLowerCase();
  const expectedNs2 = `ns2.${job.ns_domain}`.toLowerCase();
  const start = Date.now();
  const pollHistory: Array<{
    elapsedSec: number;
    resolverHits: Record<string, string[]>;
    converged: boolean;
  }> = [];

  let lastConverged = false;
  while (Date.now() - start < PROPAGATION_MAX_MS) {
    const resolverHits: Record<string, string[]> = {};
    let convergedCount = 0;

    for (const resolver of PROPAGATION_RESOLVERS) {
      const ns = await resolveNS(job.ns_domain, resolver);
      resolverHits[resolver] = ns || [];
      if (
        ns &&
        ns.some((n) => n === expectedNs1 || n === expectedNs1 + ".") &&
        ns.some((n) => n === expectedNs2 || n === expectedNs2 + ".")
      ) {
        convergedCount += 1;
      }
    }

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const converged = convergedCount >= 2; // 2 of 3 resolvers
    pollHistory.push({ elapsedSec, resolverHits, converged });
    lastConverged = converged;

    if (converged) {
      return {
        output: `DNS NS delegation converged after ${elapsedSec}s. ${convergedCount}/${PROPAGATION_RESOLVERS.length} resolvers see ns1+ns2.${job.ns_domain}.`,
        metadata: {
          converged_at: new Date().toISOString(),
          elapsed_sec: elapsedSec,
          resolverHits,
        },
      };
    }

    await delay(PROPAGATION_POLL_INTERVAL_MS);
  }

  // 75 minutes elapsed without convergence — fail loudly. Better to surface
  // this than to start step 4 (BIND zones) and have LE cert issuance fail
  // with a confusing ACME error 5 steps later.
  throw new Error(
    `DNS NS delegation for ${job.ns_domain} did not converge after ${Math.round(
      PROPAGATION_MAX_MS / 60000
    )} minutes. Last poll: ${JSON.stringify(
      pollHistory[pollHistory.length - 1] || {}
    )}. lastConverged=${lastConverged}.`
  );
}

// ----- verification_gate -----------------------------------------------------
//
// The 12-item success bar gate. Beefed up significantly from the
// dig+SPF-only check that left Test #14 silently green:
//
//   1.  A records for mail1/mail2 visible on 3 resolvers
//   2.  PTR ↔ A round-trip on both servers
//   3.  HELO banner advertises mail1/mail2 hostname
//   4.  MX records on each sending domain (10 mail1, 20 mail2)
//   5.  SPF record on each sending domain with `~all` or `-all`
//   6.  DKIM `mail` selector on each sending domain (non-empty p=)
//   7.  DMARC record on each sending domain, p=quarantine or reject
//   8.  Let's Encrypt SSL cert on mail1.<ns_domain>:443 (NOT self-signed)
//   9.  Let's Encrypt SSL cert on mail2.<ns_domain>:443 (NOT self-signed)
//   10. Port 25 reachable on both servers (banner check)
//   11. Spamhaus DBL/ZEN clean via DQS (Hard Lesson #47)
//   12. /24 subnet diversity between server1 and server2
//
// Implements an outer 30-minute retry loop (60 s between attempts) so the
// gate can absorb the long tail of LE issuance + DNS propagation without
// the wizard having to call us 30 times. Caller (worker) has no time cap;
// the Vercel-side path moves verification_gate to WORKER_STEPS for this
// reason.

const VG_RETRY_MAX_MS = 30 * 60 * 1000; // 30 minutes
const VG_RETRY_INTERVAL_MS = 60 * 1000; // 60 seconds

async function runVerificationGateOnce(jobId: string): Promise<{
  ok: boolean;
  results: string[];
  failures: string[];
  warnings: string[];
}> {
  const ctx = await loadJobContext(jobId);
  const { job, server1IP, server2IP } = ctx;

  const results: string[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!server1IP || !server2IP) {
    failures.push("Server IPs not available in job context");
    return { ok: false, results, failures, warnings };
  }

  const verifier = new DNSVerifier();

  // Use the existing fullHealthCheck which already covers items 1, 2, 4-7, 11
  // (with DQS support added in this same patch). It returns a structured
  // report we can split into our 12-row table.
  const report = await verifier.fullHealthCheck({
    server1IP,
    server2IP,
    nsDomain: job.ns_domain,
    sendingDomains: job.sending_domains || [],
  });

  // Roll the report's per-server / per-domain issues up into pass/fail rows.
  for (const server of report.servers || []) {
    if ((server.issues || []).length === 0) {
      results.push(`✓ Server ${server.ip}: ${server.hostname} clean`);
    } else {
      for (const issue of server.issues) {
        failures.push(`✗ Server ${server.ip} (${server.hostname}): ${issue}`);
      }
    }
  }

  for (const domain of report.domains || []) {
    if ((domain.issues || []).length === 0) {
      results.push(`✓ Domain ${domain.domain} clean`);
    } else {
      for (const issue of domain.issues) {
        failures.push(`✗ Domain ${domain.domain}: ${issue}`);
      }
    }
  }

  // Item 10: Port 25 reachable on both servers (banner)
  const port25s1 = await checkPort25(server1IP, `mail1.${job.ns_domain}`);
  if (port25s1.ok) {
    results.push(
      `✓ Port 25 mail1 (${server1IP}): ${port25s1.banner?.slice(0, 80)}`
    );
  } else {
    failures.push(`✗ Port 25 mail1 (${server1IP}): ${port25s1.error}`);
  }

  const port25s2 = await checkPort25(server2IP, `mail2.${job.ns_domain}`);
  if (port25s2.ok) {
    results.push(
      `✓ Port 25 mail2 (${server2IP}): ${port25s2.banner?.slice(0, 80)}`
    );
  } else {
    failures.push(`✗ Port 25 mail2 (${server2IP}): ${port25s2.error}`);
  }

  // Items 8 + 9: SSL cert CN check on mail1/mail2:443
  const ssl1 = await checkSSLCert(
    `mail1.${job.ns_domain}`,
    443,
    `mail1.${job.ns_domain}`
  );
  if (ssl1.ok) {
    results.push(
      `✓ SSL mail1.${job.ns_domain}: ${ssl1.issuerCN || ssl1.issuerO} (expires ${ssl1.daysUntilExpiry}d)`
    );
  } else {
    failures.push(
      `✗ SSL mail1.${job.ns_domain}: ${ssl1.error} (subject=${ssl1.subjectCN}, issuer=${ssl1.issuerCN || ssl1.issuerO})`
    );
  }

  const ssl2 = await checkSSLCert(
    `mail2.${job.ns_domain}`,
    443,
    `mail2.${job.ns_domain}`
  );
  if (ssl2.ok) {
    results.push(
      `✓ SSL mail2.${job.ns_domain}: ${ssl2.issuerCN || ssl2.issuerO} (expires ${ssl2.daysUntilExpiry}d)`
    );
  } else {
    failures.push(
      `✗ SSL mail2.${job.ns_domain}: ${ssl2.error} (subject=${ssl2.subjectCN}, issuer=${ssl2.issuerCN || ssl2.issuerO})`
    );
  }

  // Item 12: /24 subnet diversity
  const s1Octets = server1IP.split(".");
  const s2Octets = server2IP.split(".");
  if (s1Octets.length === 4 && s2Octets.length === 4) {
    const sameSubnet24 =
      s1Octets[0] === s2Octets[0] &&
      s1Octets[1] === s2Octets[1] &&
      s1Octets[2] === s2Octets[2];
    if (sameSubnet24) {
      failures.push(
        `✗ /24 subnet collision: ${server1IP} and ${server2IP} share the same /24 (Hard Lesson #45 — Snov.io clusters them as the same sender)`
      );
    } else {
      results.push(
        `✓ /24 subnet diverse: ${s1Octets.slice(0, 3).join(".")}.0/24 vs ${s2Octets.slice(0, 3).join(".")}.0/24`
      );
    }
  }

  return {
    ok: failures.length === 0,
    results,
    failures,
    warnings,
  };
}

export async function runVerificationGate(
  jobId: string
): Promise<StepRunResult> {
  const start = Date.now();
  let attempt = 0;
  let lastResult: {
    ok: boolean;
    results: string[];
    failures: string[];
    warnings: string[];
  } | null = null;

  while (Date.now() - start < VG_RETRY_MAX_MS) {
    attempt += 1;
    lastResult = await runVerificationGateOnce(jobId);
    if (lastResult.ok) {
      const duration = Math.round((Date.now() - start) / 1000);
      return {
        output: `Verification gate passed on attempt ${attempt} (${duration}s).\n${lastResult.results.join("\n")}`,
        metadata: {
          attempts: attempt,
          duration_sec: duration,
          checks_passed: lastResult.results.length,
        },
      };
    }
    // Failed — wait and retry. The likely cause of intermittent failures
    // here is LE issuance still in flight or DNS still propagating.
    await delay(VG_RETRY_INTERVAL_MS);
  }

  // Final failure — throw with full forensic dump.
  const r = lastResult || {
    results: [],
    failures: ["No verification attempts completed"],
    warnings: [],
  };
  const err = new Error(
    `Verification gate failed after ${attempt} attempt(s) over ${Math.round(
      VG_RETRY_MAX_MS / 60000
    )} min:\n${r.failures.join("\n")}\n--- passed checks ---\n${r.results.join("\n")}`
  );
  (err as Error & { failures?: string[] }).failures = r.failures;
  throw err;
}

// ----- Dispatch table --------------------------------------------------------
//
// Used by the worker handler to call the right function for any non-SSH step.
export const SERVERLESS_STEP_RUNNERS: Partial<
  Record<StepType, (jobId: string) => Promise<StepRunResult>>
> = {
  configure_registrar: runConfigureRegistrar,
  set_ptr: runSetPtr,
  await_dns_propagation: runAwaitDnsPropagation,
  verification_gate: runVerificationGate,
};
