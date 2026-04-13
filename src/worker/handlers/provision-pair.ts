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
import crypto from 'crypto';

// Plan type mapping: wizard size label → provider-specific API plan ID
const PLAN_TYPE_MAP: Record<string, Record<string, string>> = {
  linode: {
    small: "g6-nanode-1",     // 1 vCPU / 1GB RAM / $5/mo
    medium: "g6-standard-1",  // 1 vCPU / 2GB RAM / $12/mo
    large: "g6-standard-2",   // 2 vCPU / 4GB RAM / $24/mo
  },
  digitalocean: {
    small: "s-1vcpu-2gb",
    medium: "s-2vcpu-4gb",
    large: "s-4vcpu-8gb",
  },
  hetzner: {
    small: "cx22",
    medium: "cx32",
    large: "cx42",
  },
  vultr: {
    small: "vc2-1c-2gb",
    medium: "vc2-2c-4gb",
    large: "vc2-4c-8gb",
  },
  clouding: {
    small: "0.5C-1G",
    medium: "1C-2G",
    large: "2C-4G",
  },
};

function resolveProviderPlan(providerType: string, sizeLabel: string): string {
  const providerPlans = PLAN_TYPE_MAP[providerType];
  if (providerPlans && providerPlans[sizeLabel]) {
    return providerPlans[sizeLabel];
  }
  return sizeLabel;
}

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

  // --- Hard lesson #13 (2026-04-10): Refuse re-entry for terminal/claimed jobs ---
  // Previously, pg-boss retry + legacy pollProvisioningJobs cron would re-deliver
  // the same job to a worker that had already completed (or rolled_back) it,
  // causing step rows to be overwritten mid-flight. Gate at the top of the handler.
  if (job.status !== 'pending') {
    console.log(
      `[Provision] Job ${jobId} not pending (status=${job.status}), skipping — already claimed by another execution path`
    );
    return;
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

  // Generate a consistent root password for BOTH servers
  // This ensures we can SSH into them after creation
  const rootPassword = crypto.randomBytes(16).toString('base64url');

  const vpsConfig: Record<string, unknown> = {
    ...vpsProviderRow.config,
    apiKey: vpsProviderRow.api_key_encrypted
      ? decrypt(vpsProviderRow.api_key_encrypted)
      : undefined,
    apiSecret: vpsProviderRow.api_secret_encrypted
      ? decrypt(vpsProviderRow.api_secret_encrypted)
      : undefined,
    rootPassword, // Pass to provider so both servers get the same password
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

  // 6. Build context — include region + mapped plan from job config
  const jobConfig = (provJob.config || {}) as Record<string, string>;
  const regionFromWizard = jobConfig.region || 'us-east';
  const secondaryRegionFromWizard = jobConfig.secondaryRegion || regionFromWizard;
  const sizeLabel = jobConfig.size || 'small';
  const providerPlan = resolveProviderPlan(vpsProviderRow.provider_type, sizeLabel);

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

  // Set region, secondaryRegion, serverSize, and rootPassword on context metadata for saga steps to read
  // The saga uses ctxMeta(context).region, ctxMeta(context).secondaryRegion, ctxMeta(context).serverSize, ctxMeta(context).serverPassword
  const ctxAny = context as unknown as Record<string, unknown>;
  ctxAny.region = regionFromWizard;
  ctxAny.secondaryRegion = secondaryRegionFromWizard;
  ctxAny.serverSize = providerPlan;
  ctxAny.serverPassword = rootPassword;

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
        // Compute next pair_number for this org (per-org sequence)
        const { data: maxPairRow } = await supabase
          .from('server_pairs')
          .select('pair_number')
          .eq('org_id', provJob.org_id)
          .order('pair_number', { ascending: false })
          .limit(1)
          .single();

        const nextPairNumber = ((maxPairRow?.pair_number as number) || 0) + 1;

        const { data: serverPair, error: insertError } = await supabase
          .from('server_pairs')
          .insert({
            org_id: provJob.org_id,
            pair_number: nextPairNumber,
            ns_domain: provJob.ns_domain,
            s1_ip: server1IP,
            s1_hostname: `mail1.${provJob.ns_domain}`,
            s2_ip: server2IP,
            s2_hostname: `mail2.${provJob.ns_domain}`,
            status: 'complete',
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(`Failed to insert server_pairs row: ${insertError.message}`);
        }

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
          const password = ctx.serverPassword as string;
          if (!password) {
            throw new Error('Server password not found in provisioning context — cannot store SSH credentials');
          }
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
