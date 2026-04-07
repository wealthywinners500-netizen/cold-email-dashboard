// ============================================
// B15-3: pg-boss handler for 'rollback-provision' job
// ============================================

import { createAdminClient } from '@/lib/supabase/server';
import { SSHManager } from '@/lib/provisioning/ssh-manager';
import { SagaEngine } from '@/lib/provisioning/saga-engine';
import { createPairProvisioningSaga } from '@/lib/provisioning/pair-provisioning-saga';
import { getVPSProvider, getDNSRegistrar } from '@/lib/provisioning/provider-registry';
import { decrypt } from '@/lib/provisioning/encryption';
import type { ProvisioningContext, ProvisioningJobRow } from '@/lib/provisioning/types';

interface RollbackProvisionPayload {
  jobId: string;
}

export async function handleRollbackProvision(
  data: RollbackProvisionPayload
): Promise<void> {
  const { jobId } = data;
  const supabase = await createAdminClient();

  console.log(`[Rollback] Starting rollback for job ${jobId}`);

  // Load provisioning job
  const { data: job, error: jobError } = await supabase
    .from('provisioning_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to load provisioning job ${jobId}: ${jobError?.message}`);
  }

  const provJob = job as ProvisioningJobRow;

  // Load provider configs
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

  // Instantiate providers
  const vpsProvider = await getVPSProvider(
    vpsProviderRow.provider_type,
    vpsConfig
  );
  const dnsRegistrar = await getDNSRegistrar(
    dnsRegistrarRow.registrar_type,
    dnsConfig
  );

  // Create SSH managers
  const ssh1 = new SSHManager((msg) =>
    console.log(`[Rollback][SSH1] ${msg}`)
  );
  const ssh2 = new SSHManager((msg) =>
    console.log(`[Rollback][SSH2] ${msg}`)
  );

  // Connect SSH if we have IPs
  if (provJob.server1_ip) {
    try {
      await ssh1.connect(provJob.server1_ip, 22, 'root', {
        password: provJob.config?.serverPassword as string | undefined,
      });
    } catch (err) {
      console.log(`[Rollback] Could not connect to server 1: ${err}`);
    }
  }

  if (provJob.server2_ip) {
    try {
      await ssh2.connect(provJob.server2_ip, 22, 'root', {
        password: provJob.config?.serverPassword as string | undefined,
      });
    } catch (err) {
      console.log(`[Rollback] Could not connect to server 2: ${err}`);
    }
  }

  // Build saga and run rollback
  const sagaSteps = createPairProvisioningSaga(
    vpsProvider,
    dnsRegistrar,
    ssh1,
    ssh2
  );

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
    log: (msg: string) => console.log(`[Rollback][${jobId}] ${msg}`),
  };

  // Merge any saved metadata from the job's steps into context
  const { data: steps } = await supabase
    .from('provisioning_steps')
    .select('*')
    .eq('job_id', jobId)
    .order('step_order', { ascending: true });

  if (steps) {
    for (const step of steps) {
      if (step.metadata && typeof step.metadata === 'object') {
        Object.assign(context, step.metadata);
      }
    }
  }

  const engine = new SagaEngine(jobId, sagaSteps);

  try {
    await engine.rollback(context);
    console.log(`[Rollback] Job ${jobId} rollback completed`);
  } finally {
    await ssh1.disconnect().catch(() => {});
    await ssh2.disconnect().catch(() => {});
  }
}
