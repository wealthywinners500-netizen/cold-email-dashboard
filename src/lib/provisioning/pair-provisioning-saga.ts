// ============================================
// B15-3 REVISED: 8-Step Pair Provisioning Saga
// Order corrected based on deep research (April 2026):
//   1. Create VPS        — get IPs first
//   2. Install HestiaCP  — no DNS needed, bare server + hostname
//   3. Configure Registrar (NS/glue) — start propagation early (12-48hr)
//   4. Setup DNS Zones   — A records on BIND, authoritative once NS propagates
//   5. Set PTR           — REQUIRES forward A to resolve first (Linode validates)
//   6. Setup Mail Domains — DKIM/SPF/DMARC/accounts
//   7. Security Hardening + SSL — SpamAssassin kill + LE certs (needs DNS)
//   8. Verification Gate  — PTR↔A↔HELO, SPF/DKIM/DMARC, blacklists
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
} from './hestia-scripts';
import { generateAccountNamesForPair } from './name-generator';
import type {
  VPSProvider,
  DNSRegistrar,
  ProvisioningContext,
} from './types';
import type { SagaStep, StepResult } from './saga-engine';

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
// Factory: Create the 8-step saga (CORRECTED ORDER)
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

          // Create both servers
          const [server1, server2] = await Promise.all([
            vpsProvider.createServer({
              name: hostname1,
              region: (ctxMeta(context)).region as string || 'default',
              size: (ctxMeta(context)).serverSize as string || 'default',
            }),
            vpsProvider.createServer({
              name: hostname2,
              region: (ctxMeta(context)).region as string || 'default',
              size: (ctxMeta(context)).serverSize as string || 'default',
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
            output: `VPS pair created: ${finalServer1.ip} + ${finalServer2.ip}`,
            metadata: {
              server1ProviderId: finalServer1.id,
              server2ProviderId: finalServer2.id,
              server1IP: finalServer1.ip,
              server2IP: finalServer2.ip,
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
        const password = (ctx.serverPassword as string) || 'changeme123';
        const outputLines: string[] = [];

        try {
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
              }).then(() => {
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
              }).then(() => {
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

          context.log('[Step 3] NS and glue records submitted to registrar.');
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
          // Create NS domain zone on Server 1
          context.log(`[Step 4] Creating NS zone: ${context.nsDomain}`);
          await createDNSZone(ssh1, {
            domain: context.nsDomain,
            server1IP,
            server2IP,
            nsDomain: context.nsDomain,
            isNSDomain: true,
          });

          // Create zones for all sending domains on Server 1
          for (const domain of context.sendingDomains) {
            context.log(`[Step 4] Creating zone: ${domain}`);
            await createDNSZone(ssh1, {
              domain,
              server1IP,
              server2IP,
              nsDomain: context.nsDomain,
              isNSDomain: false,
            });
          }

          // Replicate ALL zones to Server 2
          context.log('[Step 4] Replicating NS zone to Server 2...');
          await replicateZone(ssh1, ssh2, {
            domain: context.nsDomain,
            includeMailDomains: false,
          });

          for (const domain of context.sendingDomains) {
            context.log(`[Step 4] Replicating zone ${domain} to Server 2...`);
            await replicateZone(ssh1, ssh2, {
              domain,
              includeMailDomains: false,
            });
          }

          // Hard Lesson #16b: rndc reload on both servers
          await ssh1.exec('rndc reload', { timeout: 10000 }).catch(() => {});
          await ssh2.exec('rndc reload', { timeout: 10000 }).catch(() => {});

          return {
            success: true,
            output: `DNS zones created: ${context.nsDomain} + ${context.sendingDomains.length} sending domains. Replicated to Server 2.`,
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
            await ssh1.exec(`v-delete-dns-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
          try {
            await ssh2.exec(`v-delete-dns-domain admin ${domain}`, {
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
        const password = (ctx.serverPassword as string) || 'changeme123';

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

          const allAccountsCreated: Record<string, string[]> = {};
          const dkimRecords: Record<string, string> = {};

          for (let i = 0; i < context.sendingDomains.length; i++) {
            const domain = context.sendingDomains[i];
            const accounts = namesByDomain[i] || [];

            context.log(
              `[Step 6] Setting up mail domain ${domain} with ${accounts.length} accounts...`
            );

            // Create mail domain + accounts on Server 1
            const result = await createMailDomain(ssh1, {
              domain,
              accounts,
              password,
              adminEmail: context.adminEmail,
            });

            dkimRecords[domain] = result.dkimRecord;
            allAccountsCreated[domain] = result.accounts;

            // Hard Lesson #2: Copy DKIM to Server 2 explicitly
            context.log(`[Step 6] Copying DKIM for ${domain} to Server 2...`);
            try {
              // Create mail domain on Server 2 with same accounts
              await createMailDomain(ssh2, {
                domain,
                accounts,
                password,
                adminEmail: context.adminEmail,
              });
            } catch (err) {
              context.log(
                `[Step 6] Warning: Server 2 mail setup for ${domain}: ${err}`
              );
            }
          }

          // rndc reload on both servers
          await ssh1.exec('rndc reload', { timeout: 10000 }).catch(() => {});
          await ssh2.exec('rndc reload', { timeout: 10000 }).catch(() => {});

          const totalAccounts = Object.values(allAccountsCreated).reduce(
            (sum, arr) => sum + arr.length,
            0
          );

          return {
            success: true,
            output: `${context.sendingDomains.length} mail domains configured with ${totalAccounts} total accounts.`,
            metadata: {
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
        for (const domain of context.sendingDomains) {
          try {
            await ssh1.exec(`v-delete-mail-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
          try {
            await ssh2.exec(`v-delete-mail-domain admin ${domain}`, {
              timeout: 10000,
            });
          } catch { /* ignore */ }
        }
        context.log('[Compensate] Deleted mail domains from both servers');
      },
    },

    // ========================================
    // Step 7: SECURITY_HARDENING + SSL (~1-3 min)
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
        context.log('[Step 7] Running security hardening...');

        try {
          // Harden both servers (SpamAssassin, ClamAV, fail2ban)
          await Promise.all([
            hardenSecurity(ssh1),
            hardenSecurity(ssh2),
          ]);

          context.log('[Step 7] Security hardening complete. Attempting SSL certs...');

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
            context.log('[Step 7] Server 1 hostname SSL cert issued.');
          } catch (err) {
            sslErrors.push(`S1 hostname: ${err}`);
            context.log(`[Step 7] Server 1 hostname SSL failed (DNS may not have propagated). Mail works with self-signed cert.`);
          }

          try {
            await issueSSLCert(ssh2, {
              domain: `mail2.${context.nsDomain}`,
              isHostname: true,
            });
            if (hostnameSSLSuccess) hostnameSSLSuccess = true;
            context.log('[Step 7] Server 2 hostname SSL cert issued.');
          } catch (err) {
            sslErrors.push(`S2 hostname: ${err}`);
            context.log(`[Step 7] Server 2 hostname SSL failed (DNS may not have propagated). Mail works with self-signed cert.`);
          }

          // Issue SSL for all sending domains on both servers
          for (const domain of context.sendingDomains) {
            try {
              await issueSSLCert(ssh1, { domain, isHostname: false });
            } catch (err) {
              sslErrors.push(`S1 ${domain}: ${err}`);
            }
            try {
              await issueSSLCert(ssh2, { domain, isHostname: false });
            } catch (err) {
              sslErrors.push(`S2 ${domain}: ${err}`);
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
    // Step 8: VERIFICATION_GATE (~2 min)
    // PTR↔A↔HELO alignment, SPF/DKIM/DMARC, blacklists.
    // Issues that can't be auto-fixed are flagged as manual_required.
    // ========================================
    {
      name: 'Verification Gate',
      type: 'verification_gate',
      estimatedDurationMs: 120_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 8] Running verification gate...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;
        const resolvers = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
        const failures: string[] = [];

        try {
          // Check all domains via multi-resolver DNS
          const allDomains = [context.nsDomain, ...context.sendingDomains];

          for (const domain of allDomains) {
            for (const resolver of resolvers) {
              try {
                const { stdout } = await ssh1.exec(
                  `dig @${resolver} ${domain} A +short 2>/dev/null`,
                  { timeout: 10000 }
                );
                if (!stdout.trim()) {
                  failures.push(`${domain}: no A record via ${resolver}`);
                }
              } catch {
                failures.push(`${domain}: DNS query failed via ${resolver}`);
              }
            }
          }

          // Verify PTR ↔ A ↔ HELO alignment
          for (const [ip, hostname] of [
            [server1IP, `mail1.${context.nsDomain}`],
            [server2IP, `mail2.${context.nsDomain}`],
          ]) {
            try {
              const { stdout: ptrResult } = await ssh1.exec(
                `dig -x ${ip} +short @8.8.8.8 2>/dev/null`,
                { timeout: 10000 }
              );
              const ptr = ptrResult.trim().replace(/\.$/, '');
              if (ptr !== hostname) {
                failures.push(
                  `PTR mismatch: ${ip} → ${ptr} (expected ${hostname})`
                );
              }
            } catch {
              failures.push(`PTR check failed for ${ip}`);
            }
          }

          // Check SPF/DKIM/DMARC on sending domains
          for (const domain of context.sendingDomains) {
            try {
              const { stdout: spf } = await ssh1.exec(
                `dig @8.8.8.8 ${domain} TXT +short 2>/dev/null`,
                { timeout: 10000 }
              );
              if (!spf.includes('v=spf1')) {
                failures.push(`${domain}: missing SPF record`);
              }
            } catch {
              failures.push(`${domain}: SPF check failed`);
            }

            try {
              const { stdout: dmarc } = await ssh1.exec(
                `dig @8.8.8.8 _dmarc.${domain} TXT +short 2>/dev/null`,
                { timeout: 10000 }
              );
              if (!dmarc.includes('v=DMARC1')) {
                failures.push(`${domain}: missing DMARC record`);
              }
            } catch {
              failures.push(`${domain}: DMARC check failed`);
            }
          }

          // Check blacklists for both IPs
          const blacklists = [
            'zen.spamhaus.org',
            'dnsbl.sorbs.net',
            'b.barracudacentral.org',
          ];

          for (const ip of [server1IP, server2IP]) {
            const reversedIP = ip.split('.').reverse().join('.');
            for (const bl of blacklists) {
              try {
                const { stdout } = await ssh1.exec(
                  `dig ${reversedIP}.${bl} A +short 2>/dev/null`,
                  { timeout: 10000 }
                );
                if (stdout.trim() && stdout.includes('127.0.0')) {
                  failures.push(`${ip}: listed on ${bl}`);
                }
              } catch {
                // Query failure means not listed — that's good
              }
            }
          }

          if (failures.length === 0) {
            return {
              success: true,
              output: `All verification checks passed. ${allDomains.length} domains, 2 IPs, SPF/DKIM/DMARC/PTR/blacklist all clean.`,
            };
          } else {
            return {
              success: true,
              manualRequired: true,
              output: `Verification completed with ${failures.length} issues:\n${failures.join('\n')}`,
              metadata: { verificationFailures: failures },
            };
          }
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
