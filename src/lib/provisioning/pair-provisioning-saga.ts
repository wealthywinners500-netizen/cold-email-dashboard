// ============================================
// B15-3 REVISED: 11-Step Pair Provisioning Saga (Self-Healing)
// Order corrected based on deep research (April 2026):
//   1. Create VPS        — get IPs first
//   2. Install HestiaCP  — no DNS needed, bare server + hostname
//   3. Configure Registrar (NS/glue) — start propagation early (12-48hr)
//   4. Setup DNS Zones   — A records on BIND, authoritative once NS propagates
//   5. Set PTR           — REQUIRES forward A to resolve first (Linode validates)
//   6. Setup Mail Domains — DKIM/SPF/DMARC/accounts + mail/webmail A fix for S2
//   7. Await S2 DNS      — poll resolvers for S2 domain A records before SSL
//   8. Security Hardening + SSL — SpamAssassin kill + LE certs (needs DNS)
//   9. Verification Gate 1 — categorized checks (auto_fixable vs manual_required)
//  10. Auto-Fix          — attempt automated fixes for all auto_fixable issues
//  11. Verification Gate 2 — re-run checks, pass = done
//
// WHY THIS ORDER:
// - Linode/Hetzner/Vultr PTR APIs validate forward DNS resolves BEFORE accepting rDNS
//   (returns 400: "Unable to perform lookup" if A record doesn't exist)
// - HestiaCP install needs NO DNS — just bare server + --hostname flag (local only)
// - NS/glue set early to start propagation clock (registrars don't validate if NS is running)
// - DNS zones created after HestiaCP (BIND available) but before PTR (A records needed)
// - Let's Encrypt HTTP-01 requires A record to resolve globally
// ============================================

import type { SSHManager } from './ssh-manager';
import {
  installHestiaCP,
  createDNSZone,
  createMailDomain,
  extractDKIM,
  replicateZone,
  hardenSecurity,
  issueSSLCert,
  setHostname,
  unmaskExim4,
  syncZoneFiles,
  replicateSSLCertToSecondary,
  computeZonePartition,
  setGlobalZoneTransferPolicy,
  installSlaveZones,
  openBindFirewall,
  HESTIA_PATH_PREFIX,
} from './hestia-scripts';
import { generateAccountNamesForPair } from './name-generator';
import type {
  VPSProvider,
  DNSRegistrar,
  ProvisioningContext,
} from './types';
import type { SagaStep, StepResult } from './saga-engine';
import { checkSubnetDiversity } from './verification';
import { checkDomainsBlacklistBatch } from './domain-blacklist';
import { runVerificationChecks } from './verification-checks';
import { runAutoFixes } from './auto-fix';
import { runAwaitAuthDns } from './steps/await-auth-dns';
import { buildDmarcAddCommand } from './dns-templates';

// Helper to access dynamic metadata on context safely
function ctxMeta(context: ProvisioningContext): Record<string, unknown> {
  return context as unknown as Record<string, unknown>;
}

// ============================================
// Helper: poll until condition or timeout
// ============================================

async function pollUntil(
  fn: () => Promise<boolean>,
  intervalMs: number,
  timeoutMs: number,
  label: string
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const done = await fn();
    if (done) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label} (${timeoutMs}ms)`);
}

// ============================================
// Helper: DNS propagation check via external resolvers
// ============================================

async function checkDNSPropagation(
  ssh: SSHManager,
  domain: string,
  recordType: string,
  resolvers: string[]
): Promise<boolean> {
  for (const resolver of resolvers) {
    try {
      const { stdout } = await ssh.exec(
        `dig @${resolver} ${domain} ${recordType} +short 2>/dev/null`,
        { timeout: 10000 }
      );
      if (!stdout.trim()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ============================================
// Helper: Check if forward A record resolves to expected IP
// Used by PTR step to verify readiness before calling VPS provider API
// ============================================

async function checkForwardDNSResolves(
  ssh: SSHManager,
  hostname: string,
  expectedIP: string,
  resolvers: string[]
): Promise<boolean> {
  for (const resolver of resolvers) {
    try {
      const { stdout } = await ssh.exec(
        `dig @${resolver} ${hostname} A +short 2>/dev/null`,
        { timeout: 10000 }
      );
      const resolvedIP = stdout.trim().split('\n')[0];
      if (resolvedIP !== expectedIP) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ============================================
// Factory: Create the 11-step saga (SELF-HEALING)
// ============================================

export function createPairProvisioningSaga(
  vpsProvider: VPSProvider,
  dnsRegistrar: DNSRegistrar,
  ssh1: SSHManager,
  ssh2: SSHManager
): SagaStep[] {
  return [
    // ========================================
    // Step 1: CREATE_VPS_PAIR (~5 min)
    // Get IPs first — everything else depends on them
    // ========================================
    {
      name: 'Create VPS Pair',
      type: 'create_vps',
      estimatedDurationMs: 300_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 1] Creating VPS pair...');

        try {
          const hostname1 = `mail1.${context.nsDomain}`;
          const hostname2 = `mail2.${context.nsDomain}`;

          // --- Hard lesson #44: Region diversity for subnet isolation ---
          // secondaryRegion (optional) controls mail2's region separately from
          // mail1. Defaults to the primary region if unset — caller should
          // pick a different region for real production pairs to guarantee
          // different /24 networks.
          const primaryRegion = (ctxMeta(context).region as string) || 'default';
          const secondaryRegion =
            (ctxMeta(context).secondaryRegion as string) || primaryRegion;
          const serverSize = (ctxMeta(context).serverSize as string) || 'default';
          context.log(
            `[Step 1] mail1 region=${primaryRegion}, mail2 region=${secondaryRegion}, size=${serverSize}`
          );

          // Create both servers
          const [server1, server2] = await Promise.all([
            vpsProvider.createServer({
              name: hostname1,
              region: primaryRegion,
              size: serverSize,
            }),
            vpsProvider.createServer({
              name: hostname2,
              region: secondaryRegion,
              size: serverSize,
            }),
          ]);

          context.log(`[Step 1] Server 1 created: ${server1.id} (${server1.ip})`);
          context.log(`[Step 1] Server 2 created: ${server2.id} (${server2.ip})`);

          // Poll until both are active
          await Promise.all([
            pollUntil(
              async () => {
                const s = await vpsProvider.getServer(server1.id);
                return s.status === 'active';
              },
              10_000,
              300_000,
              `Server 1 (${server1.id}) to become active`
            ),
            pollUntil(
              async () => {
                const s = await vpsProvider.getServer(server2.id);
                return s.status === 'active';
              },
              10_000,
              300_000,
              `Server 2 (${server2.id}) to become active`
            ),
          ]);

          // Re-fetch to get final IPs
          const finalServer1 = await vpsProvider.getServer(server1.id);
          const finalServer2 = await vpsProvider.getServer(server2.id);

          context.server1 = finalServer1;
          context.server2 = finalServer2;

          return {
            success: true,
            output: `VPS pair created: ${finalServer1.ip} (${primaryRegion}) + ${finalServer2.ip} (${secondaryRegion})`,
            metadata: {
              server1ProviderId: finalServer1.id,
              server2ProviderId: finalServer2.id,
              server1IP: finalServer1.ip,
              server2IP: finalServer2.ip,
              server1Region: primaryRegion,
              server2Region: secondaryRegion,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(context: ProvisioningContext): Promise<void> {
        const ctx = ctxMeta(context);
        const s1Id = ctx.server1ProviderId as string | undefined;
        const s2Id = ctx.server2ProviderId as string | undefined;

        if (s1Id) {
          try {
            await vpsProvider.deleteServer(s1Id);
            context.log('[Compensate] Deleted server 1');
          } catch (err) {
            context.log(`[Compensate] Failed to delete server 1: ${err}`);
          }
        }
        if (s2Id) {
          try {
            await vpsProvider.deleteServer(s2Id);
            context.log('[Compensate] Deleted server 2');
          } catch (err) {
            context.log(`[Compensate] Failed to delete server 2: ${err}`);
          }
        }
      },
    },

    // ========================================
    // Step 2: INSTALL_HESTIACP (~15 min)
    // No DNS required — bare server + hostname flag (local only)
    // Research confirms: --hostname only sets /etc/hostname locally,
    // does NOT validate DNS resolution
    // ========================================
    {
      name: 'Install HestiaCP',
      type: 'install_hestiacp',
      estimatedDurationMs: 900_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 2] Installing HestiaCP on both servers...');
        const ctx = ctxMeta(context);
        const password = ctx.serverPassword as string;
        if (!password) {
          return { success: false, error: 'Server password not found in provisioning context — cannot SSH' };
        }
        const outputLines: string[] = [];

        try {
          // Connect SSH to both servers using IPs from Step 1
          const server1IP = (ctx.server1IP as string) || context.server1?.ip;
          const server2IP = (ctx.server2IP as string) || context.server2?.ip;

          if (!server1IP || !server2IP) {
            return {
              success: false,
              error: `Missing server IPs: server1=${server1IP}, server2=${server2IP}`,
            };
          }

          context.log(`[Step 2] Connecting SSH to ${server1IP} and ${server2IP}...`);

          // Wait for cloud-init to finish and SSH to become ready
          // Linode cloud-init takes 60-90s to set root password after API reports "active"
          const maxSSHWait = 180000; // 3 minutes max
          const backoffMs = [30000, 45000, 60000, 90000]; // Retry intervals
          context.log('[Step 2] Waiting for cloud-init to complete and SSH to become ready...');
          let sshReady = false;
          const sshStartTime = Date.now();
          for (const delay of backoffMs) {
            if (Date.now() - sshStartTime > maxSSHWait) break;
            await new Promise((r) => setTimeout(r, delay));
            const elapsed = Math.round((Date.now() - sshStartTime) / 1000);
            context.log(`[Step 2] SSH readiness check at ${elapsed}s...`);
            try {
              await Promise.all([
                ssh1.connect(server1IP, 22, 'root', { password }),
                ssh2.connect(server2IP, 22, 'root', { password }),
              ]);
              sshReady = true;
              context.log(`[Step 2] SSH connected to both servers after ${elapsed}s`);
              break;
            } catch (sshErr) {
              const msg = sshErr instanceof Error ? sshErr.message : String(sshErr);
              context.log(`[Step 2] SSH not ready yet (${elapsed}s): ${msg}`);
              // Disconnect any partial connections before retry
              try { ssh1.disconnect(); } catch { /* ignore */ }
              try { ssh2.disconnect(); } catch { /* ignore */ }
            }
          }
          if (!sshReady) {
            return {
              success: false,
              error: `SSH not ready after ${Math.round((Date.now() - sshStartTime) / 1000)}s. Cloud-init may still be running. Retry this step.`,
            };
          }

          // Check if already installed (idempotent)
          let s1Installed = false;
          let s2Installed = false;

          try {
            await ssh1.exec('v-list-sys-config 2>/dev/null', { timeout: 10000 });
            s1Installed = true;
            context.log('[Step 2] Server 1: HestiaCP already installed');
          } catch {
            // Not installed
          }

          try {
            await ssh2.exec('v-list-sys-config 2>/dev/null', { timeout: 10000 });
            s2Installed = true;
            context.log('[Step 2] Server 2: HestiaCP already installed');
          } catch {
            // Not installed
          }

          const installPromises: Promise<void>[] = [];

          if (!s1Installed) {
            installPromises.push(
              installHestiaCP(ssh1, {
                hostname: `mail1.${context.nsDomain}`,
                email: context.adminEmail || 'admin@example.com',
                password,
                onProgress: (line) => {
                  outputLines.push(`[S1] ${line}`);
                  context.log(`[Step 2][S1] ${line}`);
                },
              }).then((result) => {
                if (!result.success) {
                  throw new Error('HestiaCP install failed on Server 1 (non-zero exit)');
                }
                context.log('[Step 2] Server 1: HestiaCP installed');
              })
            );
          }

          if (!s2Installed) {
            installPromises.push(
              installHestiaCP(ssh2, {
                hostname: `mail2.${context.nsDomain}`,
                email: context.adminEmail || 'admin@example.com',
                password,
                onProgress: (line) => {
                  outputLines.push(`[S2] ${line}`);
                  context.log(`[Step 2][S2] ${line}`);
                },
              }).then((result) => {
                if (!result.success) {
                  throw new Error('HestiaCP install failed on Server 2 (non-zero exit)');
                }
                context.log('[Step 2] Server 2: HestiaCP installed');
              })
            );
          }

          if (installPromises.length > 0) {
            await Promise.all(installPromises);
          }

          // Set hostnames
          await setHostname(ssh1, `mail1.${context.nsDomain}`);
          await setHostname(ssh2, `mail2.${context.nsDomain}`);

          return {
            success: true,
            output: `HestiaCP installed on both servers. ${outputLines.length} log lines captured.`,
            metadata: {
              hestiaCPInstalled: true,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            output: outputLines.join('\n'),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // VPS deletion from Step 1 handles cleanup
      },
    },

    // ========================================
    // Step 3: CONFIGURE_REGISTRAR_DNS (~1 min + propagation)
    // Set NS/glue EARLY to start the 12-48hr propagation clock.
    // Research: Registrars (IONOS) don't validate if NS is running.
    // RFC 2308: Resolvers cache SERVFAIL for max 5 min — no permanent damage.
    // Propagation runs in parallel with steps 4-6.
    // ========================================
    {
      name: 'Configure Registrar DNS',
      type: 'configure_registrar',
      estimatedDurationMs: 60_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 3] Configuring registrar DNS (NS + glue records)...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;

        try {
          // Set nameservers
          await dnsRegistrar.setNameservers(context.nsDomain, [
            `ns1.${context.nsDomain}`,
            `ns2.${context.nsDomain}`,
          ]);

          // Set glue records
          await dnsRegistrar.setGlueRecords(context.nsDomain, [
            { hostname: `ns1.${context.nsDomain}`, ip: server1IP },
            { hostname: `ns2.${context.nsDomain}`, ip: server2IP },
          ]);

          // Hard lesson #53: sending domains must be delegated to the new pair's NS too,
          // otherwise mail from the new pair fails SPF/reverse-DNS alignment at recipient MTAs.
          // The ns_domain glue records above are necessary but not sufficient — each sending
          // domain is its own registered name at the registrar and carries its own NS records.
          const ns1Host = `ns1.${context.nsDomain}`;
          const ns2Host = `ns2.${context.nsDomain}`;
          const sendingDomainDelegation: Array<{ domain: string; ok: boolean; error?: string }> = [];
          for (const sendingDomain of context.sendingDomains ?? []) {
            try {
              await dnsRegistrar.updateNameserversOnly(sendingDomain, [ns1Host, ns2Host]);
              sendingDomainDelegation.push({ domain: sendingDomain, ok: true });
              context.log(`[Step 3] Delegated ${sendingDomain} → ${ns1Host}, ${ns2Host}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              sendingDomainDelegation.push({ domain: sendingDomain, ok: false, error: msg });
              context.log(`[Step 3] FAILED to delegate ${sendingDomain}: ${msg}`);
            }
          }
          const failedDelegations = sendingDomainDelegation.filter((d) => !d.ok);
          if (failedDelegations.length > 0) {
            return {
              success: false,
              error: `Sending domain NS delegation failed for: ${failedDelegations.map((d) => `${d.domain} (${d.error})`).join('; ')}`,
            };
          }

          context.log('[Step 3] NS and glue records submitted to registrar.');
          context.log(`[Step 3] ${sendingDomainDelegation.length} sending domains delegated to new pair.`);
          context.log('[Step 3] Propagation started — will take 12-48 hours globally.');
          context.log('[Step 3] Continuing setup in parallel (no need to wait for full propagation).');

          // Brief propagation check — but DON'T block on it
          // NS propagation takes hours; we just verify the registrar accepted the records
          let earlyPropagation = false;
          try {
            await pollUntil(
              async () => {
                return await checkDNSPropagation(
                  ssh1,
                  context.nsDomain,
                  'NS',
                  ['8.8.8.8', '1.1.1.1']
                );
              },
              15_000,
              120_000, // 2 min quick check — don't block longer
              'NS record early propagation check'
            );
            earlyPropagation = true;
          } catch {
            // Expected — propagation takes time. Not a failure.
          }

          return {
            success: true,
            output: earlyPropagation
              ? `DNS configured: ns1/ns2.${context.nsDomain} → ${server1IP}/${server2IP}. Early propagation confirmed.`
              : `DNS configured: ns1/ns2.${context.nsDomain} → ${server1IP}/${server2IP}. Propagation in progress (expected 12-48hr).`,
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(context: ProvisioningContext): Promise<void> {
        // Best-effort: try to revert nameservers to defaults
        try {
          await dnsRegistrar.setNameservers(context.nsDomain, []);
          context.log('[Compensate] Reverted nameservers');
        } catch (err) {
          context.log(`[Compensate] Could not revert nameservers: ${err}`);
        }
      },
    },

    // ========================================
    // Step 4: SETUP_DNS_ZONES (~2 min)
    // Creates A records on HestiaCP's BIND server.
    // These become globally authoritative once NS propagation completes.
    // Must come before PTR (Step 5) because Linode validates forward DNS.
    // ========================================
    {
      name: 'Setup DNS Zones',
      type: 'setup_dns_zones',
      estimatedDurationMs: 120_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 4] Setting up DNS zones...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;

        try {
          // Session 04d Option A (HL #101): zone-ownership partition + AXFR/NOTIFY.
          // Old dual-primary flow (createDNSZone on S1 for every zone + replicateZone
          // to S2 as another master) diverged SOA serials and never propagated DKIM.
          // New flow: each zone has exactly one primary; the peer is a BIND slave.
          const { s1Primary, s2Primary } = computeZonePartition(
            context.nsDomain,
            context.sendingDomains
          );
          context.log(
            `[Step 4] Zone partition: S1 primary=${s1Primary.length} (NS + ${s1Primary.length - 1} sending), S2 primary=${s2Primary.length} sending`
          );
          context.log(`[Step 4] S1 primary zones: ${s1Primary.join(', ')}`);
          context.log(`[Step 4] S2 primary zones: ${s2Primary.join(', ')}`);

          // Create S1-primary zones on S1 (NS + alphabetically-first half of sending domains)
          for (const domain of s1Primary) {
            const isNS = domain === context.nsDomain;
            context.log(`[Step 4] Creating S1-primary zone: ${domain}${isNS ? ' (NS)' : ''}`);
            await createDNSZone(ssh1, {
              domain,
              server1IP,
              server2IP,
              nsDomain: context.nsDomain,
              isNSDomain: isNS,
              primaryIP: server1IP,
            });
          }

          // Create S2-primary zones on S2 (alphabetically-last half of sending domains)
          for (const domain of s2Primary) {
            context.log(`[Step 4] Creating S2-primary zone: ${domain}`);
            await createDNSZone(ssh2, {
              domain,
              server1IP,
              server2IP,
              nsDomain: context.nsDomain,
              isNSDomain: false,
              primaryIP: server2IP,
            });
          }

          // Open peer-scoped port 53 firewall (no-op on current infra — port 53
          // is already world-open for authoritative DNS — but keeps contract
          // explicit for future tighter firewalls).
          await openBindFirewall(ssh1, server2IP);
          await openBindFirewall(ssh2, server1IP);

          // Configure allow-transfer + also-notify globally in named.conf.options.
          // Per-zone edits (HL #105) are not durable — Hestia regenerates zone
          // stanzas from its template on v-add-letsencrypt-domain / v-add-dns-record
          // and wipes per-zone options. named.conf.options is untouched.
          await setGlobalZoneTransferPolicy(ssh1, server2IP);
          await setGlobalZoneTransferPolicy(ssh2, server1IP);

          // Install slave zones on peer via /etc/bind/named.conf.cluster include.
          // S2 slaves S1's primary zones; S1 slaves S2's primary zones.
          await installSlaveZones(ssh2, s1Primary, server1IP);
          await installSlaveZones(ssh1, s2Primary, server2IP);

          // Hard Lesson #16b: rndc reload on both servers (already done inside
          // installSlaveZones and configureZoneTransferPolicy, but belt-and-suspenders).
          await ssh1.exec('rndc reload', { timeout: 10000 }).catch(() => {});
          await ssh2.exec('rndc reload', { timeout: 10000 }).catch(() => {});

          return {
            success: true,
            output: `DNS zones partitioned: S1 primary=${s1Primary.length} (incl. NS), S2 primary=${s2Primary.length}. Peers configured as slaves via AXFR/NOTIFY.`,
            metadata: {
              s1PrimaryZones: s1Primary,
              s2PrimaryZones: s2Primary,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(context: ProvisioningContext): Promise<void> {
        // Delete zones from both servers
        const allDomains = [context.nsDomain, ...context.sendingDomains];
        for (const domain of allDomains) {
          try {
            await ssh1.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
          try {
            await ssh2.exec(`${HESTIA_PATH_PREFIX}v-delete-dns-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
        }
        context.log('[Compensate] Deleted DNS zones from both servers');
      },
    },

    // ========================================
    // Step 5: SET_PTR_RECORDS (~30s-30min)
    // CRITICAL: Linode/Hetzner/Vultr validate that forward A record
    // resolves to the IP BEFORE accepting rDNS. Must come AFTER DNS zones.
    // Implements exponential backoff retry because DNS propagation
    // from HestiaCP's BIND → global resolvers takes time.
    // ========================================
    {
      name: 'Set PTR Records',
      type: 'set_ptr',
      estimatedDurationMs: 300_000, // Up to 5 min with retries

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 5] Setting PTR records...');
        context.log('[Step 5] Waiting for forward DNS (A records) to propagate before setting rDNS...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;

        try {
          // Wait for forward DNS to resolve before attempting PTR
          // Linode validates forward A → IP match before accepting rDNS
          const resolvers = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];

          // Poll until A records resolve (with 10-minute timeout)
          let forwardDNSReady = false;
          try {
            await pollUntil(
              async () => {
                const mail1Resolves = await checkForwardDNSResolves(
                  ssh1,
                  `mail1.${context.nsDomain}`,
                  server1IP,
                  ['8.8.8.8'] // Check at least one resolver
                );
                const mail2Resolves = await checkForwardDNSResolves(
                  ssh1,
                  `mail2.${context.nsDomain}`,
                  server2IP,
                  ['8.8.8.8']
                );
                return mail1Resolves && mail2Resolves;
              },
              30_000, // Check every 30 seconds
              600_000, // 10 minute timeout
              'Forward DNS A records to resolve'
            );
            forwardDNSReady = true;
            context.log('[Step 5] Forward DNS confirmed — A records resolving correctly.');
          } catch {
            context.log('[Step 5] Forward DNS not yet propagated after 10 minutes.');
            context.log('[Step 5] Attempting PTR anyway (provider may have internal resolution)...');
          }

          // Attempt to set PTR with exponential backoff retry
          const retryDelays = [0, 60_000, 180_000, 300_000]; // 0s, 1min, 3min, 5min
          let ptrSuccess = false;
          let lastError = '';

          for (let attempt = 0; attempt < retryDelays.length; attempt++) {
            if (attempt > 0) {
              context.log(`[Step 5] PTR retry ${attempt}/${retryDelays.length - 1} — waiting ${retryDelays[attempt] / 1000}s...`);
              await new Promise((r) => setTimeout(r, retryDelays[attempt]));
            }

            try {
              await Promise.all([
                vpsProvider.setPTR({
                  ip: server1IP,
                  hostname: `mail1.${context.nsDomain}`,
                }),
                vpsProvider.setPTR({
                  ip: server2IP,
                  hostname: `mail2.${context.nsDomain}`,
                }),
              ]);
              ptrSuccess = true;
              context.log(`[Step 5] PTR records set successfully on attempt ${attempt + 1}.`);
              break;
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);

              // If provider doesn't support PTR API (e.g., Clouding), mark as manual
              if (
                lastError.includes('not yet implemented') ||
                lastError.includes('not supported')
              ) {
                return {
                  success: true,
                  manualRequired: true,
                  output: `PTR records require manual setup. Set: ${server1IP} → mail1.${context.nsDomain}, ${server2IP} → mail2.${context.nsDomain}`,
                };
              }

              // If it's a DNS lookup failure, retry (propagation not complete yet)
              if (
                lastError.includes('unable to perform a lookup') ||
                lastError.includes('Unable to look up') ||
                lastError.includes('400')
              ) {
                context.log(`[Step 5] PTR attempt ${attempt + 1} failed: forward DNS not yet visible to provider. Will retry...`);
                continue;
              }

              // Unknown error — don't retry
              context.log(`[Step 5] PTR attempt ${attempt + 1} failed with unexpected error: ${lastError}`);
              break;
            }
          }

          if (ptrSuccess) {
            return {
              success: true,
              output: `PTR records set: ${server1IP} → mail1.${context.nsDomain}, ${server2IP} → mail2.${context.nsDomain}`,
            };
          }

          // All retries exhausted — mark as manual required (don't fail the whole saga)
          return {
            success: true,
            manualRequired: true,
            output: `PTR records could not be set automatically (DNS propagation pending). Last error: ${lastError}. Manual setup required: ${server1IP} → mail1.${context.nsDomain}, ${server2IP} → mail2.${context.nsDomain}`,
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // PTR deletion is harmless — no rollback needed
      },
    },

    // ========================================
    // Step 6: SETUP_MAIL_DOMAINS (~3 min × 10 domains)
    // DKIM, SPF, DMARC, mail accounts on all sending domains.
    // Must come after DNS zones (Step 4) — needs zones to add records.
    // ========================================
    {
      name: 'Setup Mail Domains',
      type: 'setup_mail_domains',
      estimatedDurationMs: 180_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 6] Setting up mail domains...');
        const ctx = ctxMeta(context);
        const password = ctx.serverPassword as string;
        if (!password) {
          return { success: false, error: 'Server password not found in provisioning context — cannot create mail accounts' };
        }

        try {
          // Generate account names
          let namesByDomain: string[][];

          if (context.mailAccountStyle === 'custom') {
            const customNames = (ctx.customAccountNames as string[][]) || [];
            namesByDomain = customNames;
          } else {
            namesByDomain = generateAccountNamesForPair(
              context.sendingDomains.length,
              context.mailAccountsPerDomain
            );
          }

          // PATCH 10 (Session 04d update): deterministic alphabetical partition
          // shared with setup_dns_zones (step 4) via computeZonePartition. This
          // guarantees the server that hosts the DNS zone also hosts the mail
          // domain — required for DKIM: Hestia writes the DKIM TXT into the
          // domain's zone file on whichever server created the mail domain,
          // and slave AXFR propagates it to the peer.
          //
          // HL #111 (2026-04-20): NS apex is INCLUDED in the S1 loop — it is the
          // first element of partition.s1Primary. Pre-HL-#111 saga filtered the NS
          // apex out of the mail-domain loop, leaving the NS apex without DKIM.
          // P11 shipped with no `mail._domainkey.<ns-domain>` TXT and had to be
          // backfilled manually. The loop now iterates [ns_domain, ...s1 sending
          // domains] on S1 so `createMailDomain` generates a DKIM key for the NS
          // apex at saga time, published from the S1-mastered zone and slaved to
          // S2 via AXFR. NS apex has no sending accounts (the `dmarc@<ns>` mailbox
          // is created separately below for DMARC rua/ruf reporting).
          const partition = computeZonePartition(context.nsDomain, context.sendingDomains);
          const server1Domains = partition.s1Primary;
          const server2Domains = partition.s2Primary;
          // `namesByDomain` is indexed by sending_domains position; NS apex gets no
          // sending accounts, so compute the per-server-sending midpoint excluding it.
          const server1SendingDomains = server1Domains.filter((d) => d !== context.nsDomain);
          const midpoint = server1SendingDomains.length;

          context.log(`[Step 6] Domain split: S1 gets ${server1Domains.length} zones including NS apex (${server1Domains.join(', ')})`);
          context.log(`[Step 6] Domain split: S2 gets ${server2Domains.length} domains (${server2Domains.join(', ')})`);

          const allAccountsCreated: Record<string, string[]> = {};
          const dkimRecords: Record<string, string> = {};

          // Set up S1 domains (mail accounts + DKIM on server 1 only).
          // NS apex runs createMailDomain with an empty accounts list — we only
          // need the DKIM key and SPF/DMARC baseline; the `dmarc@<ns>` mailbox is
          // created further down in the DMARC reporting mailbox block.
          for (let i = 0; i < server1Domains.length; i++) {
            const domain = server1Domains[i];
            const isNsApex = domain === context.nsDomain;
            const sendingIdx = isNsApex ? -1 : server1SendingDomains.indexOf(domain);
            const accounts = isNsApex ? [] : (namesByDomain[sendingIdx] || []);

            context.log(
              `[Step 6] Setting up mail domain ${domain} on S1 with ${accounts.length} accounts` +
                (isNsApex ? ' (NS apex — DKIM only, DMARC mailbox created later)' : '') +
                '...'
            );

            const result = await createMailDomain(ssh1, {
              domain,
              accounts,
              password,
              adminEmail: context.adminEmail,
            });

            dkimRecords[domain] = result.dkimRecord;
            allAccountsCreated[domain] = result.accounts;
          }

          // Set up S2 domains (mail accounts + DKIM on server 2 only)
          for (let i = 0; i < server2Domains.length; i++) {
            const domain = server2Domains[i];
            // namesByDomain index for S2 domains starts at midpoint (S1 sending count,
            // excluding NS apex).
            const accounts = namesByDomain[midpoint + i] || [];

            context.log(`[Step 6] Setting up mail domain ${domain} on S2 with ${accounts.length} accounts...`);

            const result = await createMailDomain(ssh2, {
              domain,
              accounts,
              password,
              adminEmail: context.adminEmail,
            });

            dkimRecords[domain] = result.dkimRecord;
            allAccountsCreated[domain] = result.accounts;
          }

          // PATCH 10: Fix SPF records to use explicit server IP
          const server1IP = (ctxMeta(context).server1IP as string);
          const server2IP = (ctxMeta(context).server2IP as string);

          // Hard Lesson #82: HestiaCP v-add-mail-domain creates default SPF and DMARC.
          // createMailDomain in hestia-scripts.ts also adds its own SPF/DMARC.
          // Result: duplicate records. Clean up ALL existing SPF/DMARC, then add the correct ones.
          const adminEmailForDmarc = context.adminEmail || 'dean.hofer@thestealthmail.com';

          for (const domain of server1Domains) {
            try {
              const { stdout: records } = await ssh1.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const lines = records.split('\n');
              for (const line of lines) {
                const cols = line.trim().split(/\s+/);
                if (cols.length < 3) continue;
                const recordId = cols[0];
                if (!/^\d+$/.test(recordId)) continue;
                // Delete ALL SPF records (HestiaCP default + createMailDomain's)
                if (line.includes('TXT') && line.includes('spf1')) {
                  await ssh1.exec(
                    `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`,
                    { timeout: 10000 }
                  ).catch(() => {});
                }
                // Delete ALL DMARC records (HestiaCP default + createMailDomain's)
                if (line.includes('TXT') && line.includes('_dmarc')) {
                  await ssh1.exec(
                    `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`,
                    { timeout: 10000 }
                  ).catch(() => {});
                }
              }
              // Add correct SPF with explicit IP
              await ssh1.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ TXT '"v=spf1 ip4:${server1IP} -all"'`,
                { timeout: 10000 }
              );
              // HL #109 canonical DMARC (see dns-templates.ts).
              await ssh1.exec(
                `${HESTIA_PATH_PREFIX}${buildDmarcAddCommand(domain)}`,
                { timeout: 10000 }
              );
              // Add BIMI record
              await ssh1.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} default._bimi TXT '"v=BIMI1; l=; a="'`,
                { timeout: 10000 }
              );
              context.log(`[Step 6] SPF+DMARC+BIMI fixed for ${domain} on S1`);
            } catch (err) {
              context.log(`[Step 6] Warning: SPF/DMARC fix for ${domain}: ${err}`);
            }
          }

          for (const domain of server2Domains) {
            try {
              const { stdout: records } = await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const lines = records.split('\n');
              for (const line of lines) {
                const cols = line.trim().split(/\s+/);
                if (cols.length < 3) continue;
                const recordId = cols[0];
                if (!/^\d+$/.test(recordId)) continue;
                if (line.includes('TXT') && line.includes('spf1')) {
                  await ssh2.exec(
                    `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`,
                    { timeout: 10000 }
                  ).catch(() => {});
                }
                if (line.includes('TXT') && line.includes('_dmarc')) {
                  await ssh2.exec(
                    `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${recordId}`,
                    { timeout: 10000 }
                  ).catch(() => {});
                }
              }
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ TXT '"v=spf1 ip4:${server2IP} -all"'`,
                { timeout: 10000 }
              );
              // HL #109 canonical DMARC (see dns-templates.ts).
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}${buildDmarcAddCommand(domain)}`,
                { timeout: 10000 }
              );
              // Add BIMI record
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} default._bimi TXT '"v=BIMI1; l=; a="'`,
                { timeout: 10000 }
              );
              context.log(`[Step 6] SPF+DMARC+BIMI fixed for ${domain} on S2`);
            } catch (err) {
              context.log(`[Step 6] Warning: SPF/DMARC fix for ${domain}: ${err}`);
            }
          }

          // PATCH 10c: Fix @ A record and MX for S2 domains.
          // ensureDNSRecords (Step 5) sets ALL domains' @ A → server1IP.
          // S2 domains need @ A → server2IP so LE HTTP-01 validation hits S2
          // (where the ACME challenge file lives). MX also needs to point to
          // mail.{domain} (HL #106 per-domain convention).
          //
          // PATCH 10d (HL #101 / post-PR #4): run only on ssh2. Post-AXFR, S2
          // is the sole Hestia DNS master for server2Domains zones; ssh1 holds
          // them as BIND slaves (via installSlaveZones). `v-list-dns-records
          // admin <s2-primary-zone> plain` on ssh1 returns exit 3 "dns domain
          // doesn't exist" and crashes the saga (P14 2026-04-21). AXFR+NOTIFY
          // propagates the ssh2 writes to the ssh1 slave automatically.
          //
          // Hard Lesson #89: Delete ALL stale @ A records before adding correct
          // one — never use .catch(() => {}) on DNS record deletes (masks failures
          // that leave dual A records, breaking LE SSL and deliverability).
          context.log('[Step 6] Fixing @ A and MX records for S2 domains on owning server (S2)...');
          for (const domain of server2Domains) {
            try {
              const { stdout: records } = await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const lines = records.split('\n');

              // Collect ALL @ A and @ MX record IDs to delete
              const aRecordIds: string[] = [];
              const mxRecordIds: string[] = [];
              for (const line of lines) {
                const cols = line.trim().split(/\s+/);
                if (cols.length < 4) continue;
                // Hard Lesson #105: v-list-dns-records plain column order is ID HOST TYPE [PRIORITY] VALUE
                // NEVER use [recordId, type, host] — that has type and host SWAPPED
                const [recordId, host, type] = cols;
                if (!/^\d+$/.test(recordId)) continue;

                // Delete ALL @ A records (not just server1IP) — we'll add the correct one after
                if (type === 'A' && host === '@') {
                  aRecordIds.push(recordId);
                }
                // Delete ALL @ MX records — we'll add the correct one after
                if (type === 'MX' && host === '@') {
                  mxRecordIds.push(recordId);
                }
              }

              // Delete old @ A records with explicit error logging (no silent catch)
              for (const rid of aRecordIds) {
                const delResult = await ssh2.exec(
                  `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${rid}`,
                  { timeout: 10000 }
                );
                if (delResult.code !== 0) {
                  context.log(`[Step 6] WARNING: Failed to delete A record ${rid} for ${domain} on S2: exit ${delResult.code} ${delResult.stderr}`);
                }
              }

              // Delete old @ MX records with explicit error logging
              for (const rid of mxRecordIds) {
                const delResult = await ssh2.exec(
                  `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${rid}`,
                  { timeout: 10000 }
                );
                if (delResult.code !== 0) {
                  context.log(`[Step 6] WARNING: Failed to delete MX record ${rid} for ${domain} on S2: exit ${delResult.code} ${delResult.stderr}`);
                }
              }

              // Verify no @ A records remain before adding
              const { stdout: postDeleteRecords } = await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const remainingARecords = postDeleteRecords.split('\n').filter(l => {
                const c = l.trim().split(/\s+/);
                // Hard Lesson #105: column order is ID HOST TYPE — c[1]=HOST, c[2]=TYPE
                return c.length >= 4 && c[1] === '@' && c[2] === 'A';
              });
              if (remainingARecords.length > 0) {
                context.log(`[Step 6] ERROR: ${remainingARecords.length} stale @ A record(s) still present for ${domain} on S2 after delete — LE SSL will likely fail`);
              }

              // Add correct @ A → server2IP
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ A ${server2IP}`,
                { timeout: 10000 }
              );
              // Add correct MX → mail.{domain}  (HL #106: per-domain, HestiaCP default.
              // Supersedes HL #100 Option A. Each sending domain keeps its own mail
              // hostname, its own LE SAN cert [mail.{d}, webmail.{d}], and its own
              // reputation profile — required for cold-email deliverability.)
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} @ MX mail.${domain} 10`,
                { timeout: 10000 }
              );
            } catch (err) {
              context.log(`[Step 6] ERROR: A/MX fix for ${domain} on S2 FAILED: ${err}`);
              // Re-throw — dual A records break SSL and deliverability, this must not be silent
              throw new Error(`Failed to fix @ A/MX for S2 domain ${domain} on S2: ${err}`);
            }
            context.log(`[Step 6] A/MX fixed for ${domain}: @ A → ${server2IP}, MX → mail.${domain} (AXFR propagates to S1 slave)`);
          }

          // (HL #106 revert) S1 domains: Hestia's default `@ MX mail.{domain}` already
          // matches the per-domain invariant. No rewrite needed — the former PATCH 11d
          // that flipped S1 MX to `mail1.{nsDomain}` (Option A, HL #100) has been deleted.

          // PATCH 15: Fix mail/webmail A records for S2 domains.
          // Hard Lesson #90: HestiaCP's v-add-letsencrypt-domain includes mail.domain
          // and webmail.domain in the SAN cert. If these subdomains don't resolve to
          // the correct server (NXDOMAIN from either ns1 or ns2), LE validation fails
          // with exit 15. ensureDNSRecords in Step 4 creates mail A → server1IP for ALL
          // domains. For S2 domains, we must delete the stale record and add the correct one.
          //
          // PATCH 10d (HL #101 / post-PR #4): run only on ssh2. Same reasoning as
          // the PATCH 10c block above — S2-primary zones are BIND slaves on S1 and
          // Hestia CLI on ssh1 returns exit 3. AXFR propagates mail/webmail A writes
          // from ssh2 to the ssh1 slave.
          context.log('[Step 6] Fixing mail/webmail A records for S2 domains on owning server (S2)...');
          for (const domain of server2Domains) {
            try {
              const { stdout: records } = await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const lines = records.split('\n');

              // Collect mail A and webmail A record IDs to delete
              const mailAIds: string[] = [];
              for (const line of lines) {
                const cols = line.trim().split(/\s+/);
                if (cols.length < 4) continue;
                const [recordId, host, type] = cols;
                if (!/^\d+$/.test(recordId)) continue;
                if (type === 'A' && (host === 'mail' || host === 'webmail')) {
                  mailAIds.push(recordId);
                }
              }

              // Delete old mail/webmail A records with explicit error logging
              for (const rid of mailAIds) {
                const delResult = await ssh2.exec(
                  `${HESTIA_PATH_PREFIX}v-delete-dns-record admin ${domain} ${rid}`,
                  { timeout: 10000 }
                );
                if (delResult.code !== 0) {
                  context.log(`[Step 6] WARNING: Failed to delete mail/webmail A record ${rid} for ${domain} on S2: exit ${delResult.code} ${delResult.stderr}`);
                }
              }

              // Verify no stale mail/webmail A records remain
              const { stdout: postDeleteRecords } = await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-list-dns-records admin ${domain} plain`,
                { timeout: 15000 }
              );
              const remainingMailA = postDeleteRecords.split('\n').filter(l => {
                const c = l.trim().split(/\s+/);
                return c.length >= 4 && c[2] === 'A' && (c[1] === 'mail' || c[1] === 'webmail');
              });
              if (remainingMailA.length > 0) {
                context.log(`[Step 6] ERROR: ${remainingMailA.length} stale mail/webmail A record(s) still present for ${domain} on S2`);
              }

              // Add correct mail A → server2IP and webmail A → server2IP
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} mail A ${server2IP}`,
                { timeout: 10000 }
              );
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-dns-record admin ${domain} webmail A ${server2IP}`,
                { timeout: 10000 }
              );
            } catch (err) {
              context.log(`[Step 6] ERROR: mail/webmail A fix for ${domain} on S2 FAILED: ${err}`);
              throw new Error(`Failed to fix mail/webmail A for S2 domain ${domain} on S2: ${err}`);
            }
            context.log(`[Step 6] mail/webmail A fixed for ${domain}: mail A → ${server2IP}, webmail A → ${server2IP} (AXFR propagates to S1 slave)`);
          }

          // PATCH 10d-2 (HL #101 / post-PR #4): the previous cross-server SPF/DKIM/
          // DMARC/BIMI TXT replication block was from the dual-primary era. Each
          // auth record was written to its owning zone above, then mirrored to the
          // peer via `v-add-dns-record` on the peer's Hestia. Post-PR #4, the peer
          // holds these zones as BIND slaves only (installSlaveZones); `v-add-dns-
          // record` on the peer returns exit 3/4 and the block's .catch(() => {})
          // silently swallowed it. AXFR/NOTIFY (set up by PR #4 + reinforced by
          // PR #8's named.conf.options) propagates SPF/DKIM/DMARC/BIMI TXT from
          // the owning primary to the peer slave automatically.
          //
          // Removed: the cross-server replication loop that wrote to the non-owning
          // Hestia (now obsolete; AXFR handles it).
          context.log('[Step 6] Auth records (SPF/DKIM/DMARC/BIMI) propagate owner→peer via AXFR/NOTIFY — no cross-server write needed.');

          // DMARC rua/ruf reporting mailbox — collects aggregate reports from Gmail,
          // Microsoft, Yahoo, etc. The rua/ruf tags in the DMARC TXT records point
          // here. Nothing consumes the mailbox automatically yet; reports can be
          // reviewed manually or wired to an aggregator later.
          //
          // HL #111: S1 already has the NS apex mail domain (createMailDomain ran it
          // above as part of server1Domains), so v-add-mail-domain on S1 exits 3/4
          // ("already exists", non-fatal per HL #97). On S2 the NS apex is NOT in
          // server2Domains (per the alphabetical partition), so v-add-mail-domain on
          // S2 is a genuine create — needed for the dmarc@<ns_domain> mailbox to
          // receive rua/ruf reports regardless of which server resolves first.
          context.log(`[Step 6] Creating DMARC reporting mailbox dmarc@${context.nsDomain} on both servers...`);
          try {
            const escapedDmarcPassword = password.replace(/'/g, "'\\''");
            for (const [mailboxSSH, mailboxLabel] of [[ssh1, 'S1'] as const, [ssh2, 'S2'] as const]) {
              // Ensure NS domain is registered as a mail domain on this server
              const addMailDomainResult = await mailboxSSH.exec(
                `${HESTIA_PATH_PREFIX}v-add-mail-domain admin ${context.nsDomain}`,
                { timeout: 15000 }
              );
              if (addMailDomainResult.code !== 0 && addMailDomainResult.code !== 3 && addMailDomainResult.code !== 4) {
                context.log(`[Step 6] Warning: v-add-mail-domain ${context.nsDomain} on ${mailboxLabel}: exit ${addMailDomainResult.code} — ${addMailDomainResult.stderr}`);
              }
              // Create the dmarc@<ns_domain> mailbox
              const addMailAccountResult = await mailboxSSH.exec(
                `${HESTIA_PATH_PREFIX}v-add-mail-account admin ${context.nsDomain} dmarc '${escapedDmarcPassword}'`,
                { timeout: 15000 }
              );
              if (addMailAccountResult.code !== 0 && addMailAccountResult.code !== 3 && addMailAccountResult.code !== 4) {
                context.log(`[Step 6] Warning: v-add-mail-account dmarc@${context.nsDomain} on ${mailboxLabel}: exit ${addMailAccountResult.code} — ${addMailAccountResult.stderr}`);
              } else {
                context.log(`[Step 6] DMARC reporting mailbox ready on ${mailboxLabel}: dmarc@${context.nsDomain}`);
              }
            }
          } catch (mailboxErr) {
            // Non-fatal: reports won't land, but sending still works
            context.log(`[Step 6] Warning: DMARC reporting mailbox setup failed: ${mailboxErr instanceof Error ? mailboxErr.message : String(mailboxErr)}`);
          }

          // HL #112: Sync zone files from S1 → S2 so SOA serials match.
          // HestiaCP DNS cluster is non-functional (#16a), and all v-add-dns-record
          // commands above only modified S1's zone files. Without this sync, S2's
          // zones are stale, causing MXToolbox "Serial numbers do not match" warning.
          context.log('[Step 6] Syncing zone files from S1 → S2...');
          const allDomainsForSync = [context.nsDomain, ...context.sendingDomains];
          const s2IP = (ctx.server2IP as string) || context.server2?.ip || '';
          const syncResult = await syncZoneFiles(
            ssh1,
            s2IP,
            password,
            allDomainsForSync,
          );
          if (syncResult.failed.length > 0) {
            context.log(`[Step 6] Zone sync: ${syncResult.synced.length} synced, ${syncResult.failed.length} failed: ${syncResult.failed.join(', ')}`);
          } else {
            context.log(`[Step 6] Zone sync: all ${syncResult.synced.length} zones synced to S2`);
          }

          // --- PATCH 14: Unmask Exim4 now that all auth records are in place ---
          // Exim4 was masked in Step 2 (installHestiaCP) to prevent unauthenticated
          // SMTP traffic. Now that SPF/DKIM/DMARC are correct and replicated on both
          // servers, we can safely start the mail service.
          context.log('[Step 6] Unmasking Exim4 on both servers (auth records ready)...');
          try {
            await Promise.all([
              unmaskExim4(ssh1),
              unmaskExim4(ssh2),
            ]);
            context.log('[Step 6] Exim4 started on both servers');
          } catch (unmaskErr) {
            // This IS fatal — if Exim4 can't start, mail won't work
            context.log(`[Step 6] FATAL: Exim4 failed to start: ${unmaskErr instanceof Error ? unmaskErr.message : String(unmaskErr)}`);
            return {
              success: false,
              error: `Exim4 failed to start after auth record setup: ${unmaskErr instanceof Error ? unmaskErr.message : String(unmaskErr)}`,
            };
          }

          const totalAccounts = Object.values(allAccountsCreated).reduce(
            (sum, arr) => sum + arr.length,
            0
          );

          return {
            success: true,
            output: `${context.sendingDomains.length} mail domains configured (${server1Domains.length} on S1, ${server2Domains.length} on S2) with ${totalAccounts} total accounts.`,
            metadata: {
              server1Domains,
              server2Domains,
              allAccountsCreated,
              dkimRecords,
              namesByDomain,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(context: ProvisioningContext): Promise<void> {
        // --- PATCH 14: Re-mask Exim4 on rollback ---
        // If Step 6 unmasked Exim4 but subsequent steps failed, we need to stop
        // the mail service to prevent unauthenticated traffic.
        try {
          await ssh1.exec('systemctl stop exim4 && systemctl mask exim4 && systemctl stop dovecot && systemctl mask dovecot', { timeout: 15000 }).catch(() => {});
          await ssh2.exec('systemctl stop exim4 && systemctl mask exim4 && systemctl stop dovecot && systemctl mask dovecot', { timeout: 15000 }).catch(() => {});
          context.log('[Compensate Step 6] Exim4 re-masked on both servers');
        } catch {
          // Best-effort
        }

        for (const domain of context.sendingDomains) {
          try {
            await ssh1.exec(`${HESTIA_PATH_PREFIX}v-delete-mail-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
          try {
            await ssh2.exec(`${HESTIA_PATH_PREFIX}v-delete-mail-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
        }
        context.log('[Compensate] Deleted mail domains from both servers');
      },
    },

    // ========================================
    // Step 7: AWAIT_S2_DNS_PROPAGATION (~5-120s)
    // Poll public resolvers to confirm S2 domain A records propagated
    // before SSL cert issuance in Step 8. Zone changes typically
    // propagate in 5-60 seconds. If timeout: warn but don't block —
    // LE queries authoritative NS directly.
    // ========================================
    {
      name: 'Await S2 DNS Propagation',
      type: 'await_s2_dns' as const,
      estimatedDurationMs: 120_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 7] Awaiting S2 DNS propagation...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;
        const server2Domains = (ctx.server2Domains as string[]) || [];

        if (server2Domains.length === 0) {
          context.log('[Step 7] No S2 domains to check. Skipping.');
          return { success: true, output: 'No S2 domains — skipped.' };
        }

        // PHASE 1: Verify OUR OWN authoritative NS return correct @ A for S2 domains.
        // This is instantaneous — no propagation needed. If our own NS are wrong,
        // LE will definitely fail. FAIL FAST here.
        context.log('[Step 7] Phase 1: Verifying authoritative NS (our own servers)...');
        const authFailures: string[] = [];
        for (const domain of server2Domains) {
          for (const [sshConn, label] of [
            [ssh1, 'ns1/S1'],
            [ssh2, 'ns2/S2'],
          ] as [typeof ssh1, string][]) {
            try {
              const { stdout } = await sshConn.exec(
                `dig +short ${domain} A @127.0.0.1 2>/dev/null`,
                { timeout: 10000 }
              );
              const ips = stdout.trim().split('\n').map((s: string) => s.trim()).filter(Boolean);
              if (ips.length !== 1 || ips[0] !== server2IP) {
                authFailures.push(`${domain} on ${label}: expected [${server2IP}], got [${ips.join(',')}]`);
              }
            } catch (err) {
              authFailures.push(`${domain} on ${label}: dig failed — ${err}`);
            }
          }
        }

        if (authFailures.length > 0) {
          const msg = `FATAL: Our own authoritative NS return wrong A records for S2 domains. LE will fail.\n${authFailures.join('\n')}`;
          context.log(`[Step 7] ${msg}`);
          return {
            success: false,
            error: msg,
          };
        }
        context.log('[Step 7] Phase 1 PASSED: All S2 domains resolve correctly on both ns1 and ns2.');

        // PHASE 2: Wait for public resolvers to see correct A records.
        // LE walks the authoritative chain (Phase 1 is sufficient), but waiting
        // for public resolvers provides extra confidence. Timeout at 5 min.
        // WARN but don't block — LE should work via authoritative chain.
        context.log('[Step 7] Phase 2: Waiting for public resolver propagation (up to 5 min)...');
        const resolvers = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
        const requiredResolvers = 2;
        const pollIntervalMs = 15_000;
        const timeoutMs = 300_000; // 5 minutes
        const results: Array<{ domain: string; propagated: boolean }> = [];

        for (const domain of server2Domains) {
          const start = Date.now();
          let propagated = false;

          while (Date.now() - start < timeoutMs) {
            let confirmCount = 0;
            for (const resolver of resolvers) {
              try {
                const { stdout } = await ssh1.exec(
                  `dig +short ${domain} A @${resolver} 2>/dev/null`,
                  { timeout: 10000 }
                );
                const ips = stdout.trim().split('\n').map((s: string) => s.trim()).filter(Boolean);
                // Must resolve to ONLY server2IP (no dual A records)
                if (ips.length === 1 && ips[0] === server2IP) confirmCount++;
              } catch {
                // Resolver timeout
              }
            }

            if (confirmCount >= requiredResolvers) {
              propagated = true;
              context.log(`[Step 7] ${domain} propagated (${confirmCount}/${resolvers.length} resolvers confirm only ${server2IP})`);
              break;
            }

            context.log(`[Step 7] ${domain}: ${confirmCount}/${resolvers.length} resolvers see only ${server2IP} — waiting ${pollIntervalMs / 1000}s...`);
            await new Promise((r) => setTimeout(r, pollIntervalMs));
          }

          if (!propagated) {
            context.log(`[Step 7] WARNING: ${domain} not fully propagated after ${timeoutMs / 1000}s. LE may still work via authoritative NS.`);
          }
          results.push({ domain, propagated });
        }

        const propagatedCount = results.filter(r => r.propagated).length;
        const output = `S2 DNS: Phase 1 PASS (authoritative). Phase 2: ${propagatedCount}/${server2Domains.length} on public resolvers.`;
        context.log(`[Step 7] ${output}`);

        return {
          success: true,
          output,
          metadata: { s2DnsPropagation: results },
        };
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Informational step — nothing to rollback
      },
    },

    // ========================================
    // Step 7b: AWAIT_AUTH_DNS — 10-resolver consensus gate (HL #R3)
    // Session 04b: LE burned 9 failed validations in ~2 min against
    // un-propagated DNS, tripping the 5/hour/hostname rate limit.
    // This step verifies A/MX/SPF/DKIM/DMARC for the NS domain + all
    // sending domains have converged on ≥7 of 10 geographically
    // diverse resolvers before security_hardening issues LE certs.
    // Hard-fails the saga on 30-min timeout — no LE attempts against
    // DNS that hasn't propagated to Quad9/DNS.WATCH/etc.
    // ========================================
    {
      name: 'Await Authoritative DNS Propagation',
      type: 'await_auth_dns' as const,
      estimatedDurationMs: 600_000, // 10 min typical; 30 min hard cap inside the runner

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 7b] Awaiting authoritative DNS propagation (10-resolver consensus)...');
        const ctx = ctxMeta(context);
        const server1IP = (ctx.server1IP as string) || context.server1?.ip || '';
        const server2IP = (ctx.server2IP as string) || context.server2?.ip || '';
        const server1Domains = (ctx.server1Domains as string[]) || [];
        const server2Domains = (ctx.server2Domains as string[]) || [];

        if (!server1IP || !server2IP) {
          return {
            success: false,
            error: 'await_auth_dns: server IPs not found in provisioning context',
          };
        }

        const result = await runAwaitAuthDns({
          ssh1,
          nsDomain: context.nsDomain,
          server1IP,
          server2IP,
          server1Domains,
          server2Domains,
          log: context.log,
        });

        return {
          success: result.success,
          output: result.output,
          error: result.error,
          metadata: {
            authDnsConsensus: result.metadata,
          },
        };
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Informational step — nothing to rollback
      },
    },

    // ========================================
    // Step 8: SECURITY_HARDENING + SSL (~1-3 min)
    // SpamAssassin/ClamAV/fail2ban kill + Let's Encrypt certs.
    // LE HTTP-01 requires A record to resolve globally.
    // If LE fails (DNS not propagated), hardening still succeeds —
    // mail works with self-signed certs. LE can be retried later.
    // ========================================
    {
      name: 'Security Hardening',
      type: 'security_hardening',
      estimatedDurationMs: 180_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 8] Running security hardening...');

        try {
          // Harden both servers (SpamAssassin, ClamAV, fail2ban)
          await Promise.all([
            hardenSecurity(ssh1),
            hardenSecurity(ssh2),
          ]);

          context.log('[Step 8] Security hardening complete. Attempting SSL certs...');

          // Track SSL results — LE may fail if DNS hasn't propagated globally yet
          const sslErrors: string[] = [];
          let hostnameSSLSuccess = false;

          // Issue hostname SSL certs (requires DNS to resolve)
          try {
            await issueSSLCert(ssh1, {
              domain: `mail1.${context.nsDomain}`,
              isHostname: true,
            });
            hostnameSSLSuccess = true;
            context.log('[Step 8] Server 1 hostname SSL cert issued.');
          } catch (err) {
            sslErrors.push(`S1 hostname: ${err}`);
            context.log(`[Step 8] Server 1 hostname SSL failed (DNS may not have propagated). Mail works with self-signed cert.`);
          }

          try {
            await issueSSLCert(ssh2, {
              domain: `mail2.${context.nsDomain}`,
              isHostname: true,
            });
            if (hostnameSSLSuccess) hostnameSSLSuccess = true;
            context.log('[Step 8] Server 2 hostname SSL cert issued.');
          } catch (err) {
            sslErrors.push(`S2 hostname: ${err}`);
            context.log(`[Step 8] Server 2 hostname SSL failed (DNS may not have propagated). Mail works with self-signed cert.`);
          }

          // Issue SSL for NS domain on S1, replicate to S2
          // Hard Lesson #96: NS domain needs its own web domain + LE cert
          try {
            await issueSSLCert(ssh1, { domain: context.nsDomain, isHostname: false });
            context.log(`[Step 8] NS domain SSL issued on S1: ${context.nsDomain}`);
            try {
              await replicateSSLCertToSecondary(ssh1, ssh2, context.nsDomain);
              context.log(`[Step 8] NS domain SSL replicated to S2`);
            } catch (repErr) {
              context.log(`[Step 8] NS domain cert replication warning: ${repErr}`);
            }
          } catch (err) {
            sslErrors.push(`NS ${context.nsDomain}: ${err}`);
            context.log(`[Step 8] NS domain SSL failed: ${err}`);
          }

          // Issue SSL for sending domains
          // Read domain assignment from Step 6 metadata
          const ctx7 = ctxMeta(context);
          const server1Domains = (ctx7.server1Domains as string[]) || [];
          const server2Domains = (ctx7.server2Domains as string[]) || [];
          context.log(`[Step 8] SSL per-server split: S1=${server1Domains.length} domains, S2=${server2Domains.length} domains`);

          // Helper: tail the LE log after a failure so the operator sees LE's
          // actual "detail" message (429 rateLimited, DNS mismatch, etc.) instead
          // of just the HestiaCP exit code.
          const enrichLEError = async (ssh: typeof ssh1, domain: string, err: unknown): Promise<string> => {
            let detail = err instanceof Error ? err.message : String(err);
            try {
              const { stdout } = await ssh.exec(
                `tail -40 /var/log/hestia/LE-admin-${domain}.log 2>/dev/null | grep -oE '"detail": *"[^"]+"' | tail -1 || echo ""`,
                { timeout: 5000 }
              );
              const match = stdout.match(/"detail": *"([^"]+)"/);
              if (match) detail += ` | LE: ${match[1]}`;
            } catch {
              // Swallow — the base error message is still informative.
            }
            return detail;
          };

          // Pacing: LE's public ACME endpoint has per-account rate limits and
          // internal request queuing. Firing 10+ cert requests back-to-back
          // from the same IP can trigger "too many currently pending
          // authorizations" or the 300-orders/3hr account limit. A short pause
          // between domains spreads the load. The timeout per cert is still
          // 120s, so total added time is ~10s × N, not 10s × N + validation.
          const CERT_PACING_MS = 10_000;

          // SSL for S1's assigned sending domains (issued on S1, no replication needed)
          for (let i = 0; i < server1Domains.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, CERT_PACING_MS));
            const domain = server1Domains[i];
            try {
              await issueSSLCert(ssh1, { domain, isHostname: false });
              context.log(`[Step 8] S1 SSL issued for ${domain} (${i + 1}/${server1Domains.length})`);
            } catch (err) {
              const detail = await enrichLEError(ssh1, domain, err);
              sslErrors.push(`S1 ${domain}: ${detail}`);
              context.log(`[Step 8] S1 SSL failed for ${domain}: ${detail}`);
            }
          }

          // Pace before switching to S2 — S2 uses a different ACME account but
          // the same LE servers, so the global 300-orders/3hr limit still applies.
          if (server2Domains.length > 0) {
            await new Promise((r) => setTimeout(r, CERT_PACING_MS));
          }

          // SSL for S2's assigned sending domains — issue directly on S2 since
          // S2 domains' A records now correctly point to S2's IP (Fix 1A/1B).
          // Old approach (issue on S1 + replicate) failed when LE multi-vantage
          // validation hit S2's IP and couldn't find the challenge file on S1.
          for (let i = 0; i < server2Domains.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, CERT_PACING_MS));
            const domain = server2Domains[i];
            try {
              // Ensure web domain exists on S2 before issuing cert
              await ssh2.exec(
                `${HESTIA_PATH_PREFIX}v-add-web-domain admin ${domain} 2>/dev/null || true`,
                { timeout: 30000 }
              );
              await issueSSLCert(ssh2, { domain, isHostname: false });
              context.log(`[Step 8] S2 SSL issued directly on S2: ${domain} (${i + 1}/${server2Domains.length})`);
            } catch (err) {
              const detail = await enrichLEError(ssh2, domain, err);
              sslErrors.push(`S2 ${domain}: ${detail}`);
              context.log(`[Step 8] S2 SSL failed for ${domain}: ${detail}`);
            }
          }

          // HL #112: Sync zone files after LE cert issuance
          // LE ACME challenges modify zone serials on both servers
          {
            const ctx8 = ctxMeta(context);
            const pw = ctx8.serverPassword as string;
            const s2ip = (ctx8.server2IP as string) || context.server2?.ip || '';
            if (pw && s2ip) {
              context.log('[Step 8] Syncing zone files S1→S2 after LE certs...');
              try {
                await syncZoneFiles(ssh1, s2ip, pw, [context.nsDomain, ...context.sendingDomains]);
                context.log('[Step 8] Zone sync complete after LE certs');
              } catch (syncErr) {
                // Zone sync failure after LE is non-fatal (certs are already issued)
                // but log it loudly for diagnostics — Hard Lesson #89: never .catch(() => {})
                context.log(`[Step 8] WARNING: Post-LE zone sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}. SOA serials may mismatch.`);
              }
            }
          }

          if (sslErrors.length > 0) {
            return {
              success: true,
              manualRequired: true,
              output: `Hardened successfully. ${sslErrors.length} SSL certs failed (DNS propagation likely pending — mail works with self-signed certs, retry LE later): ${sslErrors.join('; ')}`,
            };
          }

          return {
            success: true,
            output: `Hardened + SSL issued for ${context.sendingDomains.length + 1} domains on both servers.`,
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Security changes are fine to leave
      },
    },

    // ========================================
    // Step 9: VERIFICATION_GATE_1 (~2-5 min)
    // Enhanced verification with categorized results:
    // auto_fixable vs manual_required. Feeds Step 10 (Auto-Fix).
    // ========================================
    {
      name: 'Verification Gate 1',
      type: 'verification_gate',
      estimatedDurationMs: 300_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 9] Running Verification Gate 1...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;
        const s1Domains = (ctx.server1Domains as string[]) || [];
        const s2Domains = (ctx.server2Domains as string[]) || [];

        // --- Hard lesson #43/#47/#83: Domain blacklist defense-in-depth ---
        // Domain blacklist hits are FATAL. Check BEFORE running full VG.
        try {
          const allSagaDomains = [context.nsDomain, ...context.sendingDomains];
          const blResults = await checkDomainsBlacklistBatch(allSagaDomains, { concurrency: 5 });
          const listed = blResults.filter((r) => r.status === 'listed');

          if (listed.length > 0) {
            const listedDomains = listed.map((r) => `${r.domain} (${r.blacklists.join(', ')})`).join('; ');
            context.log(`[Step 9] FATAL: ${listed.length} domain(s) blacklisted — ${listedDomains}`);
            return {
              success: false,
              error: `FATAL: ${listed.length} domain(s) blacklisted — ${listedDomains}. Pair cannot be used for cold email.`,
            };
          }

          const unknown = blResults.filter((r) => r.status === 'unknown');
          if (unknown.length > 0) {
            context.log(`[Step 9] WARNING: Blacklist service unavailable for: ${unknown.map((r) => r.domain).join(', ')}`);
          } else {
            context.log(`[Step 9] OK: all ${allSagaDomains.length} domains clean on DNSBLs`);
          }
        } catch (err) {
          context.log(`[Step 9] Domain blacklist check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          // Run comprehensive verification checks
          const verificationResults = await runVerificationChecks(ssh1, ssh2, {
            nsDomain: context.nsDomain,
            sendingDomains: context.sendingDomains,
            server1IP,
            server2IP,
            server1Domains: s1Domains,
            server2Domains: s2Domains,
            log: context.log,
          });

          // Categorize results
          const passing = verificationResults.filter(r => r.status === 'pass');
          const autoFixable = verificationResults.filter(r => r.status === 'auto_fixable');
          const manualRequired = verificationResults.filter(r => r.status === 'manual_required');

          context.log(`[Step 9] VG1 results: ${passing.length} pass, ${autoFixable.length} auto-fixable, ${manualRequired.length} manual-required`);

          // Store results in context for Step 10 (Auto-Fix) to read
          const outputSummary = [
            `VG1: ${verificationResults.length} checks total`,
            `  ${passing.length} passed`,
            `  ${autoFixable.length} auto-fixable`,
            `  ${manualRequired.length} manual-required`,
          ].join('\n');

          if (autoFixable.length > 0) {
            context.log(`[Step 9] Auto-fixable issues:\n${autoFixable.map(r => `  - ${r.check} on ${r.domain}: ${r.details} [fix: ${r.fixAction}]`).join('\n')}`);
          }
          if (manualRequired.length > 0) {
            context.log(`[Step 9] Manual-required issues:\n${manualRequired.map(r => `  - ${r.check} on ${r.domain}: ${r.details}`).join('\n')}`);
          }

          const vgMetadata = {
            verificationResults,
            autoFixableCount: autoFixable.length,
            manualRequiredCount: manualRequired.length,
            passCount: passing.length,
          };

          if (manualRequired.length > 0) {
            return {
              success: false,
              error: `VG1: ${manualRequired.length} hard failures: ${manualRequired.map(r => r.check + ':' + r.domain).join(', ')}`,
              metadata: vgMetadata,
            };
          }

          if (autoFixable.length > 0) {
            return {
              success: true,
              manualRequired: true,
              output: `${outputSummary}\n\n${autoFixable.length} auto_fixable items for auto-fix step`,
              metadata: vgMetadata,
            };
          }

          return {
            success: true,
            output: outputSummary,
            metadata: vgMetadata,
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Informational step — nothing to rollback
      },
    },

    // ========================================
    // Step 10: AUTO_FIX (~1-5 min)
    // Reads VG1 results and attempts automated fixes for all
    // auto_fixable issues. Skipped entirely if VG1 found zero
    // auto_fixable issues.
    // ========================================
    {
      name: 'Auto-Fix Issues',
      type: 'auto_fix' as const,
      estimatedDurationMs: 300_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 10] Running Auto-Fix...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;
        const s1Domains = (ctx.server1Domains as string[]) || [];
        const s2Domains = (ctx.server2Domains as string[]) || [];

        // Read VG1 results from context
        const verificationResults = (ctx.verificationResults as import('./types').VerificationResult[]) || [];
        const autoFixableCount = (ctx.autoFixableCount as number) || 0;

        if (autoFixableCount === 0) {
          context.log('[Step 10] No auto-fixable issues from VG1. Skipping.');
          return {
            success: true,
            output: 'No auto-fixable issues — skipped.',
            metadata: { fixedCount: 0, failedCount: 0 },
          };
        }

        context.log(`[Step 10] ${autoFixableCount} auto-fixable issues to attempt...`);

        try {
          const { fixed, failed } = await runAutoFixes(
            ssh1,
            ssh2,
            vpsProvider,
            verificationResults,
            {
              nsDomain: context.nsDomain,
              server1IP,
              server2IP,
              server1Domains: s1Domains,
              server2Domains: s2Domains,
              log: context.log,
            }
          );

          // HL #112: Sync zone files after auto-fix modifies DNS records
          if (fixed.length > 0) {
            context.log('[Step 10] Syncing zone files from S1 → S2 after auto-fix...');
            const password = ctx.serverPassword as string;
            if (password) {
              const allDomainsForSync = [context.nsDomain, ...context.sendingDomains];
              await syncZoneFiles(ssh1, server2IP, password, allDomainsForSync);
              context.log('[Step 10] Zone sync complete');
            }
          }

          const output = `Auto-Fix: ${fixed.length} fixed, ${failed.length} failed.${
            failed.length > 0 ? `\nFailed: ${failed.join('; ')}` : ''
          }`;
          context.log(`[Step 10] ${output}`);

          return {
            success: true,
            output,
            metadata: {
              fixedCount: fixed.length,
              failedCount: failed.length,
              fixedActions: fixed,
              failedActions: failed,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Auto-fix changes are DNS records — compensate would mean reverting
        // to broken state, which is worse. No-op.
      },
    },

    // ========================================
    // Step 11: VERIFICATION_GATE_2 (~2-5 min)
    // Re-runs the same checks as VG1 to confirm fixes worked.
    // Pass = done. ANY failure = hard fail (success: false).
    // Max 2 passes total (VG1 + VG2), never loop.
    // ========================================
    {
      name: 'Verification Gate 2',
      type: 'verification_gate_2' as const,
      estimatedDurationMs: 300_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 11] Running Verification Gate 2 (post-fix verification)...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;
        const s1Domains = (ctx.server1Domains as string[]) || [];
        const s2Domains = (ctx.server2Domains as string[]) || [];

        try {
          const verificationResults = await runVerificationChecks(ssh1, ssh2, {
            nsDomain: context.nsDomain,
            sendingDomains: context.sendingDomains,
            server1IP,
            server2IP,
            server1Domains: s1Domains,
            server2Domains: s2Domains,
            log: context.log,
          });

          const passing = verificationResults.filter(r => r.status === 'pass');
          const autoFixable = verificationResults.filter(r => r.status === 'auto_fixable');
          const manualRequired = verificationResults.filter(r => r.status === 'manual_required');

          context.log(`[Step 11] VG2 results: ${passing.length} pass, ${autoFixable.length} auto-fixable, ${manualRequired.length} manual-required`);

          const outputSummary = [
            `VG2: ${verificationResults.length} checks total`,
            `  ${passing.length} passed`,
            `  ${autoFixable.length} still auto-fixable (could not be fixed)`,
            `  ${manualRequired.length} manual-required`,
          ].join('\n');

          const failedChecks = [...autoFixable, ...manualRequired];

          if (failedChecks.length > 0) {
            context.log(`[Step 11] VG2 FAILED: ${failedChecks.length} unresolved after auto-fix.`);
            for (const r of failedChecks) {
              context.log(`[Step 11]   ✗ ${r.check} on ${r.domain}: ${r.details}`);
            }
            return {
              success: false,
              error: `VG2: ${failedChecks.length} unresolved after auto-fix: ${failedChecks.map(r => r.check + ':' + r.domain).join(', ')}`,
              metadata: {
                verificationResults,
                finalStatus: 'failed',
              },
            };
          }

          context.log('[Step 11] ALL checks passed. Pair is fully operational.');
          return {
            success: true,
            output: `All ${verificationResults.length} verification checks passed. Pair is fully operational.`,
            metadata: {
              verificationResults,
              finalStatus: 'clean',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // Informational step — nothing to rollback
      },
    },
  ];
}
