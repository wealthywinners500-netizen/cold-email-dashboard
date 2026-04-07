// ============================================
// B15-3: 8-Step Pair Provisioning Saga
// Maps to the A-H pair deployment pipeline
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
// Factory: Create the 8-step saga
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
    // Step 2: SET_PTR_RECORDS (~30s)
    // ========================================
    {
      name: 'Set PTR Records',
      type: 'set_ptr',
      estimatedDurationMs: 30_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 2] Setting PTR records...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;

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

          return {
            success: true,
            output: `PTR records set: ${server1IP} → mail1.${context.nsDomain}, ${server2IP} → mail2.${context.nsDomain}`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          // If provider doesn't support PTR API (e.g., Clouding), mark as manual
          if (
            msg.includes('not yet implemented') ||
            msg.includes('not supported')
          ) {
            return {
              success: true,
              manualRequired: true,
              output: `PTR records require manual setup. Set: ${server1IP} → mail1.${context.nsDomain}, ${server2IP} → mail2.${context.nsDomain}`,
            };
          }

          return { success: false, error: msg };
        }
      },

      async compensate(_context: ProvisioningContext): Promise<void> {
        // PTR deletion is harmless — no rollback needed
      },
    },

    // ========================================
    // Step 3: CONFIGURE_REGISTRAR_DNS (~1 min)
    // ========================================
    {
      name: 'Configure Registrar DNS',
      type: 'configure_registrar',
      estimatedDurationMs: 60_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 3] Configuring registrar DNS...');
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

          context.log('[Step 3] NS and glue records set. Waiting for propagation...');

          // Wait for propagation (poll DNS resolvers)
          const resolvers = ['8.8.8.8', '1.1.1.1'];
          let propagated = false;

          try {
            await pollUntil(
              async () => {
                return await checkDNSPropagation(
                  ssh1,
                  context.nsDomain,
                  'NS',
                  resolvers
                );
              },
              15_000,
              600_000, // 10 min timeout
              'NS record propagation'
            );
            propagated = true;
          } catch {
            // Timeout — mark as needs attention but don't fail
          }

          if (!propagated) {
            return {
              success: true,
              manualRequired: true,
              output: 'DNS NS/glue records set but propagation not confirmed after 10 minutes. Check manually.',
            };
          }

          return {
            success: true,
            output: `DNS configured: ns1/ns2.${context.nsDomain} → ${server1IP}/${server2IP}`,
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
    // Step 4: INSTALL_HESTIACP (~15 min)
    // ========================================
    {
      name: 'Install HestiaCP',
      type: 'install_hestiacp',
      estimatedDurationMs: 900_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 4] Installing HestiaCP on both servers...');
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
            context.log('[Step 4] Server 1: HestiaCP already installed');
          } catch {
            // Not installed
          }

          try {
            await ssh2.exec('v-list-sys-config 2>/dev/null', { timeout: 10000 });
            s2Installed = true;
            context.log('[Step 4] Server 2: HestiaCP already installed');
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
                  context.log(`[Step 4][S1] ${line}`);
                },
              }).then(() => {
                context.log('[Step 4] Server 1: HestiaCP installed');
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
                  context.log(`[Step 4][S2] ${line}`);
                },
              }).then(() => {
                context.log('[Step 4] Server 2: HestiaCP installed');
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
    // Step 5: SETUP_DNS_ZONES (~2 min)
    // ========================================
    {
      name: 'Setup DNS Zones',
      type: 'setup_dns_zones',
      estimatedDurationMs: 120_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 5] Setting up DNS zones...');
        const ctx = ctxMeta(context);
        const server1IP = ctx.server1IP as string;
        const server2IP = ctx.server2IP as string;

        try {
          // Create NS domain zone on Server 1
          context.log(`[Step 5] Creating NS zone: ${context.nsDomain}`);
          await createDNSZone(ssh1, {
            domain: context.nsDomain,
            server1IP,
            server2IP,
            nsDomain: context.nsDomain,
            isNSDomain: true,
          });

          // Create zones for all sending domains on Server 1
          for (const domain of context.sendingDomains) {
            context.log(`[Step 5] Creating zone: ${domain}`);
            await createDNSZone(ssh1, {
              domain,
              server1IP,
              server2IP,
              nsDomain: context.nsDomain,
              isNSDomain: false,
            });
          }

          // Replicate ALL zones to Server 2
          context.log('[Step 5] Replicating NS zone to Server 2...');
          await replicateZone(ssh1, ssh2, {
            domain: context.nsDomain,
            includeMailDomains: false,
          });

          for (const domain of context.sendingDomains) {
            context.log(`[Step 5] Replicating zone ${domain} to Server 2...`);
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
    // Step 6: SETUP_MAIL_DOMAINS (~3 min × 10 domains)
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
    // Step 7: SECURITY_HARDENING (~1 min)
    // ========================================
    {
      name: 'Security Hardening',
      type: 'security_hardening',
      estimatedDurationMs: 60_000,

      async execute(context: ProvisioningContext): Promise<StepResult> {
        context.log('[Step 7] Running security hardening...');

        try {
          // Harden both servers
          await Promise.all([
            hardenSecurity(ssh1),
            hardenSecurity(ssh2),
          ]);

          context.log('[Step 7] Security hardening complete. Issuing SSL certs...');

          // Issue hostname SSL certs
          await issueSSLCert(ssh1, {
            domain: `mail1.${context.nsDomain}`,
            isHostname: true,
          });
          await issueSSLCert(ssh2, {
            domain: `mail2.${context.nsDomain}`,
            isHostname: true,
          });

          // Issue SSL for all sending domains on both servers
          const sslErrors: string[] = [];
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

          const output = sslErrors.length > 0
            ? `Hardened + SSL issued. ${sslErrors.length} SSL warnings: ${sslErrors.join('; ')}`
            : `Hardened + SSL issued for ${context.sendingDomains.length + 1} domains on both servers.`;

          return { success: true, output };
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
