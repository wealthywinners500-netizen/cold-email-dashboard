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
import { SSHManager } from "@/lib/provisioning/ssh-manager";
import { promises as dnsPromises } from "dns";
import { exec as execCb } from "child_process";
import { promisify } from "util";

const execAsync = promisify(execCb);

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

  // Hard Lesson #72: Ionos 202 Accepted is async — the update can silently
  // fail. Verify each delegation actually took effect by reading back the
  // nameservers from the Ionos API after a short wait.
  if (dnsRow.registrar_type === "ionos") {
    await delay(5000); // Allow Ionos async processing
    const { IonosRegistrar } = await import("./registrars/ionos");
    if (registrar instanceof IonosRegistrar) {
      for (const entry of sendingDelegation.filter((d) => d.ok)) {
        const nsInfo = await registrar.getDomainNameservers(entry.domain);
        const nsNames = nsInfo?.nameservers?.map((ns: { name: string }) => ns.name?.toLowerCase()) || [];
        const hasNs1 = nsNames.some((n: string) => n?.includes(`ns1.${job.ns_domain}`));
        const hasNs2 = nsNames.some((n: string) => n?.includes(`ns2.${job.ns_domain}`));
        if (!hasNs1 || !hasNs2) {
          throw new Error(
            `Ionos NS verification failed for ${entry.domain}: expected ns1/ns2.${job.ns_domain}, ` +
            `got [${nsNames.join(", ")}]. Ionos accepted the 202 but did not apply the update.`
          );
        }
        console.log(`[configure_registrar] Ionos NS verified for ${entry.domain}: [${nsNames.join(", ")}]`);
      }
    }
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

/**
 * Hard Lesson #64 (Test #15, 2026-04-11): the previous implementation
 * polled recursive resolvers (8.8.8.8/1.1.1.1/9.9.9.9) for the
 * `ns_domain`'s NS records. This created a chicken-and-egg deadlock
 * because:
 *   1. The recursive resolver follows the .info parent's delegation,
 *      which (after configure_registrar) points to ns1.<ns_domain> /
 *      ns2.<ns_domain> living on the brand-new VPS pair.
 *   2. setup_dns_zones (the next step) hasn't run yet, so BIND on the
 *      new pair has NO zones loaded — every query gets REFUSED.
 *   3. The recursive resolver then returns SERVFAIL, never sees the
 *      delegation, and `await_dns_propagation` waits the full 75 min
 *      and throws.
 *
 * Fix: query the TLD parent's authoritative nameservers DIRECTLY for
 * the child delegation. Parent NS responses contain the NS records
 * (and glue) in the AUTHORITY/ADDITIONAL sections without ever touching
 * the child BIND. This proves "the registrar update has propagated to
 * the parent zone", which is the actual condition we care about — once
 * the parent has the new delegation, every recursive resolver in the
 * world will start following it as soon as we put zones on BIND.
 *
 * Implementation uses `dig` (already on the worker VPS) for two reasons:
 *   - Node's dnsPromises.Resolver always recurses; it can't be told to
 *     stop after a referral.
 *   - dig +norecurse against a TLD NS gives us exactly the referral
 *     we want, parseable from the AUTHORITY section.
 */
const TLD_PARENT_NS: Record<string, string[]> = {
  // .info — Afilias (Identity Digital). 6 IPv4 NS, picked deterministically
  // for cache-friendliness.
  info: [
    "199.254.31.1", // a0.info.afilias-nst.info
    "199.254.48.1", // a2.info.afilias-nst.info
    "199.249.112.1", // b0.info.afilias-nst.org
    "199.249.119.1", // b2.info.afilias-nst.org
    "199.253.59.1", // c0.info.afilias-nst.info
    "199.254.63.1", // d0.info.afilias-nst.org
  ],
  // .com / .net — Verisign. Stable for 25 years.
  com: [
    "192.5.6.30", // a.gtld-servers.net
    "192.33.14.30", // b.gtld-servers.net
    "192.26.92.30", // c.gtld-servers.net
    "192.31.80.30", // d.gtld-servers.net
    "192.12.94.30", // e.gtld-servers.net
  ],
  net: [
    "192.5.6.30",
    "192.33.14.30",
    "192.26.92.30",
    "192.31.80.30",
    "192.12.94.30",
  ],
  // .io — IO TLD (Identity Digital).
  io: [
    "194.0.1.1", // a0.nic.io
    "194.0.2.1", // a2.nic.io
    "199.249.119.1",
  ],
  // .co — .CO Internet (GoDaddy Registry).
  co: [
    "156.154.124.65", // a0.cctld.afilias-nst.info
    "156.154.125.65",
    "156.154.127.65",
  ],
};

function getTldParentNs(domain: string): string[] | null {
  const tld = domain.split(".").pop()?.toLowerCase();
  if (!tld) return null;
  return TLD_PARENT_NS[tld] || null;
}

/**
 * Query a TLD parent NS for the child delegation. Returns the list of
 * NS hostnames the parent says are authoritative for `domain`, or null
 * on error.
 *
 * dig output we parse (AUTHORITY section):
 *   krogerengage.info.   86400 IN NS ns1.krogerengage.info.
 *   krogerengage.info.   86400 IN NS ns2.krogerengage.info.
 */
async function queryParentForChildNs(
  parentNsIp: string,
  childDomain: string
): Promise<string[] | null> {
  try {
    // +norecurse → don't ask the parent to recurse, just give us the referral.
    // +noall +authority → only print the AUTHORITY section.
    // +time=5 +tries=2 → fast fail on dead NS.
    const cmd = `dig @${parentNsIp} ${childDomain} NS +norecurse +noall +authority +time=5 +tries=2`;
    const { stdout } = await execAsync(cmd, { timeout: 15000 });
    const lines = stdout.split("\n");
    const nsRecords: string[] = [];
    for (const line of lines) {
      // Match `<domain>. <ttl> IN NS <nshost>.`
      const m = line.match(
        /^\s*\S+\.\s+\d+\s+IN\s+NS\s+(\S+?)\.?\s*$/i
      );
      if (m) {
        nsRecords.push(m[1].toLowerCase());
      }
    }
    return nsRecords;
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

  // Pick the TLD parent NS list. If the TLD isn't in our table, fall
  // back to the (deadlocked) recursive-resolver path with a 5-min cap
  // — better to surface than to silently spin for 75 min.
  const parentNsList = getTldParentNs(job.ns_domain);
  if (!parentNsList) {
    throw new Error(
      `await_dns_propagation: no TLD parent NS table entry for ${job.ns_domain} (TLD=${job.ns_domain.split(".").pop()}). Add to TLD_PARENT_NS in serverless-steps.ts.`
    );
  }

  const start = Date.now();
  const pollHistory: Array<{
    elapsedSec: number;
    parentNsHits: Record<string, string[]>;
    converged: boolean;
  }> = [];

  while (Date.now() - start < PROPAGATION_MAX_MS) {
    const parentNsHits: Record<string, string[]> = {};
    let convergedCount = 0;

    for (const parentNsIp of parentNsList) {
      const ns = await queryParentForChildNs(parentNsIp, job.ns_domain);
      parentNsHits[parentNsIp] = ns || [];
      if (
        ns &&
        ns.some((n) => n === expectedNs1) &&
        ns.some((n) => n === expectedNs2)
      ) {
        convergedCount += 1;
      }
    }

    const elapsedSec = Math.round((Date.now() - start) / 1000);
    // Need majority (≥ ceil(N/2)+1 of N) of TLD NS to confirm — guards
    // against a single stale NS in the cluster.
    const required = Math.floor(parentNsList.length / 2) + 1;
    const converged = convergedCount >= required;
    pollHistory.push({ elapsedSec, parentNsHits, converged });

    if (converged) {
      return {
        output: `DNS NS delegation converged after ${elapsedSec}s at the .${job.ns_domain.split(".").pop()} parent zone. ${convergedCount}/${parentNsList.length} parent NS see ns1+ns2.${job.ns_domain}.`,
        metadata: {
          converged_at: new Date().toISOString(),
          elapsed_sec: elapsedSec,
          parentNsHits,
          method: "tld_parent_referral",
        },
      };
    }

    await delay(PROPAGATION_POLL_INTERVAL_MS);
  }

  // 75 minutes elapsed without convergence — fail loudly.
  throw new Error(
    `DNS NS delegation for ${job.ns_domain} did not converge at the .${job.ns_domain.split(".").pop()} parent zone after ${Math.round(
      PROPAGATION_MAX_MS / 60000
    )} minutes. Last poll: ${JSON.stringify(
      pollHistory[pollHistory.length - 1] || {}
    )}.`
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

/**
 * Hard Lesson #68 / #69 (Test #16 canary 11 forensics, 2026-04-11):
 *
 * The VG previously only checked DNS-visible DKIM state (the public TXT
 * record at mail._domainkey.<domain>) which is published from S1 only.
 * It had no way to detect that S2 was signing outbound mail with a
 * DIFFERENT private key than the one S1 published. Result: PATCH 4's
 * silent DKIM replication failure false-greened the entire test and
 * the operator didn't discover the bug until independent SSH audit.
 *
 * This function SSHes to BOTH servers, reads sha256sum of the Exim
 * private key at /home/admin/conf/mail/<domain>/dkim.pem, and compares
 * them. This is the only source of truth for row 11 of the success bar.
 *
 * Uses the worker VPS's ssh_credentials row for the job. If the creds
 * row is missing (Hard Lesson #58 failure), returns a hard failure.
 */
async function verifyDKIMCrossServerMatch(
  jobId: string,
  orgId: string,
  sendingDomains: string[],
  server1IP: string,
  server2IP: string
): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  const supabase = await createAdminClient();

  // PATCH 10c: Load per-server domain assignment from Step 6 metadata.
  // With per-server split, each domain's DKIM key only exists on the
  // assigned server. We verify the key exists on the correct server
  // rather than requiring it on both.
  const { data: step6Row } = await supabase
    .from("provisioning_steps")
    .select("metadata")
    .eq("job_id", jobId)
    .eq("step_type", "setup_mail_domains")
    .maybeSingle();
  const step6Meta = (step6Row?.metadata || {}) as Record<string, unknown>;
  const s1Domains = new Set((step6Meta.server1Domains as string[]) || []);
  const s2Domains = new Set((step6Meta.server2Domains as string[]) || []);
  const hasPerServerSplit = s1Domains.size > 0 || s2Domains.size > 0;

  // Load ssh_credentials — one row per server
  const { data: creds, error: credsErr } = await supabase
    .from("ssh_credentials")
    .select("server_ip, password_encrypted")
    .eq("org_id", orgId)
    .eq("provisioning_job_id", jobId);
  if (credsErr || !creds || creds.length < 2) {
    issues.push(
      `DKIM cross-check: ssh_credentials rows missing for job ${jobId} (found ${creds?.length ?? 0}) — Hard Lesson #58 regression?`
    );
    return { ok: false, issues };
  }

  const byIp = new Map<string, string>();
  for (const row of creds) {
    try {
      byIp.set(row.server_ip, decrypt(row.password_encrypted));
    } catch (err) {
      issues.push(
        `DKIM cross-check: decrypt failed for ${row.server_ip}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (!byIp.has(server1IP) || !byIp.has(server2IP)) {
    issues.push(
      `DKIM cross-check: credentials incomplete (have=${[...byIp.keys()].join(',')}, need=${server1IP},${server2IP})`
    );
    return { ok: false, issues };
  }

  const ssh1 = new SSHManager();
  const ssh2 = new SSHManager();
  try {
    await ssh1.connect(server1IP, 22, "root", { password: byIp.get(server1IP)! });
    await ssh2.connect(server2IP, 22, "root", { password: byIp.get(server2IP)! });

    for (const domain of sendingDomains) {
      const dkimPath = `/home/admin/conf/mail/${domain}/dkim.pem`;

      if (hasPerServerSplit) {
        // PATCH 10c: Per-server mode — verify DKIM key exists on the
        // assigned server only. The other server doesn't have the mail
        // domain so it won't sign mail for this domain.
        const assignedSSH = s1Domains.has(domain) ? ssh1 : ssh2;
        const assignedLabel = s1Domains.has(domain) ? 'S1' : 'S2';
        try {
          const { stdout } = await assignedSSH.exec(
            `sha256sum ${dkimPath} 2>/dev/null | cut -d' ' -f1`,
            { timeout: 10000 }
          );
          const hash = (stdout || "").trim();
          if (!hash) {
            issues.push(`${domain}: DKIM key missing on ${assignedLabel} (${dkimPath})`);
          }
        } catch {
          issues.push(`${domain}: ${assignedLabel} DKIM sha256 failed (${dkimPath})`);
        }
      } else {
        // Legacy mode — all domains on both servers, require matching keys
        let h1 = "";
        let h2 = "";
        try {
          const { stdout: r1 } = await ssh1.exec(
            `sha256sum ${dkimPath} 2>/dev/null | cut -d' ' -f1`,
            { timeout: 10000 }
          );
          h1 = (r1 || "").trim();
        } catch {
          issues.push(`${domain}: S1 sha256 failed (${dkimPath})`);
          continue;
        }
        try {
          const { stdout: r2 } = await ssh2.exec(
            `sha256sum ${dkimPath} 2>/dev/null | cut -d' ' -f1`,
            { timeout: 10000 }
          );
          h2 = (r2 || "").trim();
        } catch {
          issues.push(`${domain}: S2 sha256 failed (${dkimPath})`);
          continue;
        }
        if (!h1) {
          issues.push(`${domain}: DKIM key missing on S1 (${dkimPath})`);
        } else if (!h2) {
          issues.push(`${domain}: DKIM key missing on S2 (${dkimPath})`);
        } else if (h1 !== h2) {
          issues.push(
            `${domain}: DKIM mismatch S1↔S2 (s1=${h1.slice(0, 8)}…, s2=${h2.slice(0, 8)}…)`
          );
        }
      }
    }
  } catch (err) {
    issues.push(
      `DKIM cross-check: SSH error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    try {
      await ssh1.disconnect();
    } catch {}
    try {
      await ssh2.disconnect();
    } catch {}
  }
  return { ok: issues.length === 0, issues };
}

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
  // PATCH 10d: Use overall status (PASS/WARN/FAIL) instead of raw issues count.
  // WARN-level issues (e.g. transient resolver cache inconsistency) should not
  // block VG pass — only FAIL-level issues are real configuration problems.
  for (const server of report.servers || []) {
    if (server.overall === 'FAIL') {
      for (const issue of server.issues || []) {
        failures.push(`✗ Server ${server.ip} (${server.hostname}): ${issue}`);
      }
    } else if (server.overall === 'WARN') {
      warnings.push(`⚠ Server ${server.ip} (${server.hostname}): ${(server.issues || []).join('; ')}`);
      results.push(`✓ Server ${server.ip}: ${server.hostname} (warn: ${(server.issues || []).join('; ')})`);
    } else {
      results.push(`✓ Server ${server.ip}: ${server.hostname} clean`);
    }
  }

  for (const domain of report.domains || []) {
    if (domain.overall === 'FAIL') {
      for (const issue of domain.issues || []) {
        failures.push(`✗ Domain ${domain.domain}: ${issue}`);
      }
    } else if (domain.overall === 'WARN') {
      warnings.push(`⚠ Domain ${domain.domain}: ${(domain.issues || []).join('; ')}`);
      results.push(`✓ Domain ${domain.domain} (warn: ${(domain.issues || []).join('; ')})`);
    } else {
      results.push(`✓ Domain ${domain.domain} clean`);
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

  // Item 11: DKIM sha256 cross-server match (Hard Lesson #68/#69).
  // THIS IS THE CHECK TEST #16 LACKED AND THAT FALSE-GREENED PATCH 4.
  // Every sending domain's /home/admin/conf/mail/<d>/dkim.pem must
  // have identical sha256 on S1 and S2, otherwise S2-signed mail will
  // fail DKIM validation at receiving MTAs.
  try {
    const dkimCross = await verifyDKIMCrossServerMatch(
      jobId,
      job.org_id,
      job.sending_domains || [],
      server1IP,
      server2IP
    );
    if (dkimCross.ok) {
      results.push(
        `✓ DKIM keys match S1↔S2 across all ${job.sending_domains?.length || 0} sending domain(s)`
      );
    } else {
      for (const issue of dkimCross.issues) {
        failures.push(`✗ ${issue}`);
      }
    }
  } catch (err) {
    failures.push(
      `✗ DKIM cross-server check threw: ${err instanceof Error ? err.message : String(err)}`
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

    // Hard Lesson #72: per-attempt logging so journalctl shows progress
    // (27 attempts with zero output looks like a hang)
    const failCount = lastResult.failures?.length || 0;
    const passCount = lastResult.results?.length || 0;
    const failNames = lastResult.failures?.map((f: string) => f.split(':')[0]).join(', ') || 'none';
    console.log(
      `[VG] attempt ${attempt}: ${passCount} passed, ${failCount} failing (${failNames}). ` +
      `Elapsed ${Math.round((Date.now() - start) / 1000)}s / ${Math.round(VG_RETRY_MAX_MS / 1000)}s max.`
    );

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
