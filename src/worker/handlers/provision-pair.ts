// ============================================
// B15-3: pg-boss handler for 'provision-server-pair' job
// ============================================

import { createAdminClient } from '@/lib/supabase/server';
import { SSHManager } from '@/lib/provisioning/ssh-manager';
import { SagaEngine } from '@/lib/provisioning/saga-engine';
import { createPairProvisioningSaga } from '@/lib/provisioning/pair-provisioning-saga';
import { getVPSProvider, getDNSRegistrar } from '@/lib/provisioning/provider-registry';
import { decrypt } from '@/lib/provisioning/encryption';
import { createSSHCredentials } from '@/lib/supabase/queries';
import { encrypt } from '@/lib/provisioning/encryption';
import type { ProvisioningContext, ProvisioningJobRow } from '@/lib/provisioning/types';

interface ProvisionPairPayload {
  jobId: string;
}

export async function handleProvisionPair(
  data: ProvisionPairPayload
): Promise<void> {
  const { jobId } = data;
  const supabase = await createAdminClient();

  console.log(`[Provision] Starting pair provisioning for job ${jobId}`);

  // 1. Load provisioning job from database
  const { data: job, error: jobError } = await supabase
    .from('provisioning_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to load provisioning job ${jobId}: ${jobError?.message}`);
  }

  const provJob = job as ProvisioningJobRow;

  // 2. Load provider configs and decrypt API keys
  const { data: vpsProviderRow } = await supabase
    .from('vps_providers')
    .select('*')
    .eq('id', provJob.vps_provider_id)
    .single();

  const { data: dnsRegistrarRow } = await supabase
    .from('dns_registrars')
    .select('*')
    .eq('id', provJob.dns_registrar_id)
    .single();

  if (!vpsProviderRow || !dnsRegistrarRow) {
    throw new Error('VPS provider or DNS registrar not found');
  }

  const vpsConfig: Record<string, unknown> = {
    ...vpsProviderRow.config,
    apiKey: vpsProviderRow.api_key_encrypted
      ? decrypt(vpsProviderRow.api_key_encrypted)
      : undefined,
    apiSecret: vpsProviderRow.api_secret_encrypted
      ? decrypt(vpsProviderRow.api_secret_encrypted)
      : undefined,
  };

  const dnsConfig: Record<string, unknown> = {
    ...dnsRegistrarRow.config,
    apiKey: dnsRegistrarRow.api_key_encrypted
      ? decrypt(dnsRegistrarRow.api_key_encrypted)
      : undefined,
    apiSecret: dnsRegistrarRow.api_secret_encrypted
      ? decrypt(dnsRegistrarRow.api_secret_encrypted)
      : undefined,
  };

  // 3. Instantiate providers via factory
  const vpsProvider = await getVPSProvider(
    vpsProviderRow.provider_type,
    vpsConfig
  );
  const dnsRegistrar = await getDNSRegistrar(
    dnsRegistrarRow.registrar_type,
    dnsConfig
  );

  // 4. Create SSH managers for both servers
  const ssh1 = new SSHManager((msg) =>
    console.log(`[Provision][SSH1] ${msg}`)
  );
  const ssh2 = new SSHManager((msg) =>
    console.log(`[Provision][SSH2] ${msg}`)
  );

  // 5. Build saga steps
  const sagaSteps = createPairProvisioningSaga(
    vpsProvider,
    dnsRegistrar,
    ssh1,
    ssh2
  );

  // 6. Build context
  const context: ProvisioningContext = {
    jobId,
    orgId: provJob.org_id,
    vpsProvider,
    dnsRegistrar,
    nsDomain: provJob.ns_domain,
    sendingDomains: provJob.sending_domains,
    mailAccountsPerDomain: provJob.mail_accounts_per_domain,
    mailAccountStyle: provJob.mail_account_style,
    adminEmail: provJob.admin_email,
    log: (msg: string) => console.log(`[Provision][${jobId}] ${msg}`),
  };

  // 7. Progress callback — update DB for SSE consumers
  const onProgress = async (pct: number, step: string, output: string) => {
    console.log(`[Provision] Progress: ${pct}% — ${step}: ${output}`);
    // DB update happens inside SagaEngine already
  };

  // 8. Create engine and execute
  const engine = new SagaEngine(jobId, sagaSteps, onProgress);

  try {
    const result = await engine.execute(context);

    if (result.success) {
      console.log(`[Provision] Job ${jobId} completed successfully`);

      const ctx = context as unknown as Record<string, unknown>;
      const server1IP = ctx.server1IP as string | undefined;
      const server2IP = ctx.server2IP as string | undefined;

      // Insert server_pair
      if (server1IP && server2IP) {
        const { data: serverPair } = await supabase
          .from('server_pairs')
          .insert({
            org_id: provJob.org_id,
            ns_domain: provJob.ns_domain,
            server1_ip: server1IP,
            server2_ip: server2IP,
            server1_hostname: `mail1.${provJob.ns_domain}`,
            server2_hostname: `mail2.${provJob.ns_domain}`,
            status: 'active',
            health_status: 'healthy',
          })
          .select()
          .single();

        if (serverPair) {
          // Update job with server_pair_id
          await supabase
            .from('provisioning_jobs')
            .update({ server_pair_id: serverPair.id })
            .eq('id', jobId);

          // Insert email accounts
          const allAccounts = ctx.allAccountsCreated as Record<string, string[]> | undefined;
          if (allAccounts) {
            const accountRows = [];
            for (const [domain, names] of Object.entries(allAccounts)) {
              for (const name of names) {
                accountRows.push({
                  org_id: provJob.org_id,
                  email: `${name}@${domain}`,
                  display_name: name.split('.').map(
                    (n: string) => n.charAt(0).toUpperCase() + n.slice(1)
                  ).join(' '),
                  server_pair_id: serverPair.id,
                  smtp_host: server1IP,
                  smtp_port: 587,
                  imap_host: server1IP,
                  imap_port: 993,
                  status: 'active',
                  warmup_status: 'not_started',
                  daily_send_limit: 50,
                  sends_today: 0,
                });
              }
            }

            if (accountRows.length > 0) {
              await supabase.from('email_accounts').insert(accountRows);
              console.log(
                `[Provision] Inserted ${accountRows.length} email accounts`
              );
            }
          }

          // Insert sending domains
          const sendingDomainRows = provJob.sending_domains.map(
            (domain: string) => ({
              org_id: provJob.org_id,
              domain,
              server_pair_id: serverPair.id,
              spf_status: 'valid',
              dkim_status: 'valid',
              dmarc_status: 'valid',
              blacklist_status: 'clean',
            })
          );

          if (sendingDomainRows.length > 0) {
            await supabase.from('sending_domains').insert(sendingDomainRows);
            console.log(
              `[Provision] Inserted ${sendingDomainRows.length} sending domains`
            );
          }

          // Store SSH credentials
          const password = (ctx.serverPassword as string) || 'changeme123';
          await createSSHCredentials(provJob.org_id, {
            server_ip: server1IP,
            hostname: `mail1.${provJob.ns_domain}`,
            username: 'root',
            password_encrypted: encrypt(password),
            port: 22,
            provisioning_job_id: jobId,
          });
          await createSSHCredentials(provJob.org_id, {
            server_ip: server2IP,
            hostname: `mail2.${provJob.ns_domain}`,
            username: 'root',
            password_encrypted: encrypt(password),
            port: 22,
            provisioning_job_id: jobId,
          });
        }
      }

      // Generate Snov.io CSV metadata
      const allAccounts = ctx.allAccountsCreated as Record<string, string[]> | undefined;
      if (allAccounts) {
        const csvLines: string[] = ['email,first_name,last_name,domain'];
        for (const [domain, names] of Object.entries(allAccounts)) {
          for (const name of names) {
            const [first, last] = name.split('.');
            csvLines.push(`${name}@${domain},${first},${last},${domain}`);
          }
        }

        await supabase
          .from('provisioning_jobs')
          .update({
            config: {
              ...provJob.config,
              snovio_csv: csvLines.join('\n'),
            },
          })
          .eq('id', jobId);
      }
    } else {
      console.error(
        `[Provision] Job ${jobId} failed: ${result.error}`
      );
      // Saga engine already handled rollback and status update
    }
  } finally {
    // Disconnect SSH
    await ssh1.disconnect().catch(() => {});
    await ssh2.disconnect().catch(() => {});
  }
}
