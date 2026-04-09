// ============================================
// Worker handler for individual provisioning steps (4-7)
// Receives a single step, executes it via SSH, then
// POSTs results back to the Vercel API worker-callback endpoint.
// ============================================

import { createAdminClient } from '@/lib/supabase/server';
import { SSHManager } from '@/lib/provisioning/ssh-manager';
import { createPairProvisioningSaga } from '@/lib/provisioning/pair-provisioning-saga';
import { getVPSProvider, getDNSRegistrar } from '@/lib/provisioning/provider-registry';
import { decrypt } from '@/lib/provisioning/encryption';
import { createHmac } from 'crypto';
import type {
  ProvisioningContext,
  ProvisioningJobRow,
  StepType,
  VPSProviderType,
  DNSRegistrarType,
} from '@/lib/provisioning/types';
import type { SagaStep } from '@/lib/provisioning/saga-engine';

interface ProvisionStepPayload {
  jobId: string;
  stepType: StepType;
  stepId: string;
}

// SSH steps that this handler processes
const WORKER_STEP_TYPES: StepType[] = [
  'install_hestiacp',
  'setup_dns_zones',
  'setup_mail_domains',
  'security_hardening',
];

/**
 * Sign a callback request with HMAC-SHA256.
 */
function signCallback(
  jobId: string,
  stepType: string,
  timestamp: string
): string {
  const secret = process.env.WORKER_CALLBACK_SECRET;
  if (!secret) {
    throw new Error('WORKER_CALLBACK_SECRET not configured on worker');
  }
  const payload = `${jobId}:${stepType}:${timestamp}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * POST step results back to the Vercel API.
 */
async function postCallback(
  jobId: string,
  stepType: string,
  result: {
    status: 'completed' | 'failed';
    output?: string;
    error_message?: string;
    duration_ms?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cold-email-dashboard.vercel.app';
  const url = `${baseUrl}/api/provisioning/${jobId}/worker-callback`;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signCallback(jobId, stepType, timestamp);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Signature': signature,
      'X-Worker-Timestamp': timestamp,
    },
    body: JSON.stringify({
      stepType,
      ...result,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[ProvisionStep] Callback failed (${res.status}): ${text}`);
    throw new Error(`Worker callback failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  console.log(`[ProvisionStep] Callback accepted:`, data);
}

/**
 * Execute a single provisioning step that requires SSH.
 * Called by pg-boss when the Vercel API dispatches a step to the worker.
 */
export async function handleProvisionStep(
  data: ProvisionStepPayload
): Promise<void> {
  const { jobId, stepType, stepId } = data;

  if (!WORKER_STEP_TYPES.includes(stepType)) {
    console.error(`[ProvisionStep] Unexpected step type: ${stepType}`);
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: `Step ${stepType} should not be dispatched to worker`,
    });
    return;
  }

  console.log(`[ProvisionStep] Starting ${stepType} for job ${jobId}`);
  const startTime = Date.now();

  const supabase = await createAdminClient();

  // 1. Load job
  const { data: job, error: jobError } = await supabase
    .from('provisioning_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: `Job ${jobId} not found: ${jobError?.message}`,
    });
    return;
  }

  const provJob = job as ProvisioningJobRow;

  // 2. Load provider configs
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
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: 'VPS provider or DNS registrar not found',
    });
    return;
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

  // 3. Create providers + SSH managers
  const vpsProvider = await getVPSProvider(
    vpsProviderRow.provider_type as VPSProviderType,
    vpsConfig
  );
  const dnsRegistrar = await getDNSRegistrar(
    dnsRegistrarRow.registrar_type as DNSRegistrarType,
    dnsConfig
  );

  const ssh1 = new SSHManager((msg) =>
    console.log(`[ProvisionStep][SSH1] ${msg}`)
  );
  const ssh2 = new SSHManager((msg) =>
    console.log(`[ProvisionStep][SSH2] ${msg}`)
  );

  // 4. Build context with data from prior completed steps
  // Load all completed steps to build context metadata
  const { data: allSteps } = await supabase
    .from('provisioning_steps')
    .select('step_type, status, metadata')
    .eq('job_id', jobId)
    .order('step_order', { ascending: true });

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
    log: (msg: string) => console.log(`[ProvisionStep][${jobId}] ${msg}`),
  };

  // Merge metadata from all completed steps into context
  // (e.g., server1IP, server2IP from create_vps)
  for (const step of allSteps || []) {
    if (step.status === 'completed' && step.metadata) {
      Object.assign(context, step.metadata);
    }
  }

  // Also populate from job row (backup)
  if (provJob.server1_ip) {
    (context as unknown as Record<string, unknown>).server1IP = provJob.server1_ip;
  }
  if (provJob.server2_ip) {
    (context as unknown as Record<string, unknown>).server2IP = provJob.server2_ip;
  }

  // 5. Build saga steps and find the one we need
  const sagaSteps = createPairProvisioningSaga(
    vpsProvider,
    dnsRegistrar,
    ssh1,
    ssh2
  );

  const targetStep = sagaSteps.find((s: SagaStep) => s.type === stepType);
  if (!targetStep) {
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: `Saga step ${stepType} not found in provisioning saga`,
    });
    return;
  }

  // 6. Execute the single step
  try {
    const result = await targetStep.execute(context);
    const durationMs = Date.now() - startTime;

    if (result.success) {
      console.log(
        `[ProvisionStep] ${stepType} completed in ${durationMs}ms for job ${jobId}`
      );

      await postCallback(jobId, stepType, {
        status: 'completed',
        output: result.output || `${stepType} completed successfully`,
        duration_ms: durationMs,
        metadata: result.metadata,
      });
    } else {
      console.error(
        `[ProvisionStep] ${stepType} failed for job ${jobId}: ${result.error}`
      );

      await postCallback(jobId, stepType, {
        status: 'failed',
        output: result.output,
        error_message: result.error || 'Step execution returned failure',
        duration_ms: durationMs,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    console.error(
      `[ProvisionStep] ${stepType} threw for job ${jobId}: ${errorMsg}`
    );

    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: errorMsg,
      duration_ms: durationMs,
    });
  } finally {
    await ssh1.disconnect().catch(() => {});
    await ssh2.disconnect().catch(() => {});
  }
}
