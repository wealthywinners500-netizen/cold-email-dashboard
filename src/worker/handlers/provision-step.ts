// ============================================
// Worker handler for individual provisioning steps.
// Receives a single step, executes it (via SSH for Hestia steps, or
// directly via provider API for create_vps), then POSTs results back
// to the Vercel API worker-callback endpoint.
//
// Hard Lesson #59 (Test #14, 2026-04-10): `create_vps` moved here from
// the Vercel execute-step route because Linode boot polling routinely
// exceeds Vercel Hobby's 60s maxDuration, stranding Step 1 `in_progress`
// with orphan VPS + lost credentials. The worker VPS has no time cap,
// so the full createServer × 2 + poll + persistPairCredentials chain
// can run in one shot.
// ============================================

import { createAdminClient } from '@/lib/supabase/server';
import { SSHManager } from '@/lib/provisioning/ssh-manager';
import { createPairProvisioningSaga } from '@/lib/provisioning/pair-provisioning-saga';
import { getVPSProvider, getDNSRegistrar } from '@/lib/provisioning/provider-registry';
import { decrypt } from '@/lib/provisioning/encryption';
import { persistPairCredentials } from '@/lib/provisioning/persist-credentials';
import { createHmac, randomBytes } from 'crypto';
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

// All step types this handler processes. create_vps is handled by
// `handleCreateVpsStep` (provider-API path, no SSH). The rest are
// Hestia/SSH steps handled by the saga path.
const WORKER_STEP_TYPES: StepType[] = [
  'create_vps',
  'install_hestiacp',
  'setup_dns_zones',
  'setup_mail_domains',
  'security_hardening',
];

// Wizard size label → provider plan ID. Mirrors the same table that
// used to live in execute-step/route.ts (now deleted — create_vps is a
// worker step, so the map moved with it).
const PLAN_TYPE_MAP: Record<string, Record<string, string>> = {
  linode: {
    small: 'g6-nanode-1',
    medium: 'g6-standard-1',
    large: 'g6-standard-2',
  },
  digitalocean: {
    small: 's-1vcpu-2gb',
    medium: 's-2vcpu-4gb',
    large: 's-4vcpu-8gb',
  },
  hetzner: {
    small: 'cx22',
    medium: 'cx32',
    large: 'cx42',
  },
  vultr: {
    small: 'vc2-1c-2gb',
    medium: 'vc2-2c-4gb',
    large: 'vc2-4c-8gb',
  },
  clouding: {
    small: '0.5C-1G',
    medium: '1C-2G',
    large: '2C-4G',
  },
};

function resolveProviderPlan(providerType: string, sizeLabel: string): string {
  const providerPlans = PLAN_TYPE_MAP[providerType];
  if (providerPlans && providerPlans[sizeLabel]) {
    return providerPlans[sizeLabel];
  }
  // Already a provider-specific plan ID — pass through.
  return sizeLabel;
}

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
 * Handle `create_vps` specifically — the provider-API path that does
 * NOT use the saga and NOT use SSH. Generates a shared root password,
 * creates both Linodes (us-east + secondary), polls until active,
 * writes IPs back to provisioning_jobs, and persists the encrypted
 * credentials via the shared persist-credentials module before
 * calling back to Vercel.
 *
 * Hard Lesson #58: credential persistence MUST succeed before the step
 * is reported completed. If encrypt() or the Supabase insert throws,
 * we throw — the pair is not "created" if we cannot SSH back into it.
 *
 * Hard Lesson #59: this used to live on the Vercel side but boot
 * polling blew past the 60s serverless cap. The worker VPS has no
 * such cap, so the whole chain runs in one handler call.
 */
async function handleCreateVpsStep(
  jobId: string,
  stepType: StepType,
  startTime: number
): Promise<void> {
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

  // 2. Load VPS provider config
  const { data: vpsRow } = await supabase
    .from('vps_providers')
    .select('*')
    .eq('id', provJob.vps_provider_id)
    .single();

  if (!vpsRow) {
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: 'VPS provider config not found',
    });
    return;
  }

  try {
    // 3. Generate shared root password and pass it to the provider
    // so both servers accept the SAME credential. This password is
    // ONLY ever stored encrypted — never returned via step metadata
    // (the dashboard UI reads that) and never logged.
    const rootPassword = randomBytes(16).toString('base64url');

    const vpsConfig: Record<string, unknown> = {
      ...vpsRow.config,
      apiKey: vpsRow.api_key_encrypted
        ? decrypt(vpsRow.api_key_encrypted)
        : undefined,
      apiSecret: vpsRow.api_secret_encrypted
        ? decrypt(vpsRow.api_secret_encrypted)
        : undefined,
      rootPassword, // consumed by LinodeProvider.createServer as root_pass
    };
    const provider = await getVPSProvider(
      vpsRow.provider_type as VPSProviderType,
      vpsConfig
    );

    const jobConfig = (provJob.config || {}) as Record<string, string>;
    const region = jobConfig.region || 'us-east';
    const secondaryRegion = jobConfig.secondaryRegion || region;
    const sizeLabel = jobConfig.size || 'small';
    const providerPlan = resolveProviderPlan(vpsRow.provider_type, sizeLabel);

    console.log(
      `[ProvisionStep][create_vps] job=${jobId} region=${region} secondary=${secondaryRegion} size=${sizeLabel} plan=${providerPlan}`
    );

    // 4. Create both servers
    const server1 = await provider.createServer({
      name: `mail1-${provJob.ns_domain.replace(/\./g, '-')}`,
      region,
      size: providerPlan,
    });
    console.log(`[ProvisionStep][create_vps] server1 created: ${server1.id}`);

    const server2 = await provider.createServer({
      name: `mail2-${provJob.ns_domain.replace(/\./g, '-')}`,
      region: secondaryRegion,
      size: providerPlan,
    });
    console.log(`[ProvisionStep][create_vps] server2 created: ${server2.id}`);

    // 5. Poll until both are active (10 min max — worker has no 60s cap)
    const POLL_TIMEOUT = 10 * 60 * 1000;
    const pollStart = Date.now();
    let s1Active = server1.status === 'active';
    let s2Active = server2.status === 'active';

    while (
      (!s1Active || !s2Active) &&
      Date.now() - pollStart < POLL_TIMEOUT
    ) {
      await new Promise((r) => setTimeout(r, 15000));
      if (!s1Active) {
        const info = await provider.getServer(server1.id);
        s1Active = info.status === 'active' || info.status === 'running';
        if (s1Active && !server1.ip) Object.assign(server1, { ip: info.ip });
      }
      if (!s2Active) {
        const info = await provider.getServer(server2.id);
        s2Active = info.status === 'active' || info.status === 'running';
        if (s2Active && !server2.ip) Object.assign(server2, { ip: info.ip });
      }
    }

    if (!s1Active || !s2Active) {
      throw new Error(
        `Timed out waiting for VPS servers to become active (s1Active=${s1Active}, s2Active=${s2Active})`
      );
    }

    console.log(
      `[ProvisionStep][create_vps] both active: ${server1.ip} + ${server2.ip}`
    );

    // 6. Write IPs back to the job row so downstream steps can read
    // them. Do this BEFORE persistPairCredentials — if persistence
    // fails, a debugger can still cross-reference the IPs.
    await supabase
      .from('provisioning_jobs')
      .update({
        server1_ip: server1.ip,
        server2_ip: server2.ip,
        server1_provider_id: server1.id,
        server2_provider_id: server2.id,
      })
      .eq('id', provJob.id);

    // 7. Persist credentials (Hard Lesson #58). Throws on failure, and
    // the outer catch marks the step failed — the pair is NOT complete
    // if we can't SSH back into it.
    await persistPairCredentials({
      orgId: provJob.org_id,
      jobId: provJob.id,
      nsDomain: provJob.ns_domain,
      server1IP: server1.ip,
      server2IP: server2.ip,
      rootPassword,
    });

    console.log(
      `[ProvisionStep][create_vps] credentials persisted for job ${jobId}`
    );

    const durationMs = Date.now() - startTime;

    // 8. Callback success. rootPassword is NOT in metadata — the
    // dashboard UI reads step metadata JSONB and would leak it.
    await postCallback(jobId, stepType, {
      status: 'completed',
      output: `VPS pair created: ${server1.ip} (${region}) + ${server2.ip} (${secondaryRegion}) (${vpsRow.provider_type}). SSH credentials persisted.`,
      duration_ms: durationMs,
      metadata: {
        server1IP: server1.ip,
        server2IP: server2.ip,
        server1ProviderId: server1.id,
        server2ProviderId: server2.id,
        server1Region: region,
        server2Region: secondaryRegion,
        credentialsPersisted: true,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    console.error(
      `[ProvisionStep][create_vps] FAILED for job ${jobId}: ${errorMsg}`
    );
    await postCallback(jobId, stepType, {
      status: 'failed',
      error_message: errorMsg,
      duration_ms: durationMs,
    });
  }
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

  // Route create_vps to the dedicated provider-API handler — it does
  // not use the saga or SSH managers (Hard Lesson #59).
  if (stepType === 'create_vps') {
    await handleCreateVpsStep(jobId, stepType, startTime);
    return;
  }

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

  // Hard Lesson #60 (Test #14, 2026-04-11): saga steps 2 + 6 (install_hestiacp,
  // setup_mail_domains) read the root password from `ctx.serverPassword` for
  // SSH auth, but the Hard Lesson #59 refactor intentionally omits
  // `rootPassword` from create_vps step metadata ("never logged, never
  // returned via metadata"). Result: SSH falls back to 'changeme123' and
  // every step that needs SSH fails with "authentication methods failed".
  //
  // Fix: load the encrypted password from ssh_credentials (written by
  // persistPairCredentials during Step 1), decrypt via ENCRYPTION_KEY,
  // and inject into ctx.serverPassword before the saga step executes.
  // The password lives ONLY in memory for the duration of the step call
  // and is never written to metadata. (create_vps returned earlier, so
  // stepType here is narrowed to the SSH-using step set.)
  {
    const { data: sshCred } = await supabase
      .from('ssh_credentials')
      .select('password_encrypted')
      .eq('provisioning_job_id', jobId)
      .limit(1)
      .maybeSingle();
    if (sshCred?.password_encrypted) {
      try {
        const plaintext = decrypt(sshCred.password_encrypted);
        (context as unknown as Record<string, unknown>).serverPassword =
          plaintext;
      } catch (decErr) {
        const msg = decErr instanceof Error ? decErr.message : String(decErr);
        console.error(
          `[ProvisionStep] Failed to decrypt ssh_credentials password for job ${jobId}: ${msg}`
        );
      }
    } else {
      console.warn(
        `[ProvisionStep] No ssh_credentials row found for job ${jobId} — saga step will fall back to default password and likely fail`
      );
    }
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

  // Hard Lesson #61 (Test #14 attempt 2, 2026-04-11): saga steps 4, 6, 7
  // (setup_dns_zones, setup_mail_domains, security_hardening) call
  // `ssh1.exec()` / `ssh2.exec()` directly but never call `ssh1.connect()`.
  // In the pre-#59 world the whole saga ran in one process and SSH was
  // connected once at the top. After the per-step decomposition each step
  // runs with fresh SSH managers, so the driver must open the SSH sessions
  // before handing off to the step. Skipped for:
  //   - create_vps: returned earlier (no SSH needed)
  //   - install_hestiacp: has its own connect-with-backoff retry loop, must
  //     handle SSH-not-yet-ready itself
  //   - configure_registrar, set_ptr, verification_gate: never dispatched
  //     to the worker — they run serverless on Vercel (API-only / DNS-only).
  const sshRequiredSteps: StepType[] = [
    'setup_dns_zones',
    'setup_mail_domains',
    'security_hardening',
  ];
  if (sshRequiredSteps.includes(stepType)) {
    const ctxRec = context as unknown as Record<string, unknown>;
    const server1IP = ctxRec.server1IP as string | undefined;
    const server2IP = ctxRec.server2IP as string | undefined;
    const rootPassword = ctxRec.serverPassword as string | undefined;
    if (!server1IP || !server2IP) {
      await postCallback(jobId, stepType, {
        status: 'failed',
        error_message: `SSH pre-connect failed: missing server IPs in context (server1IP=${server1IP}, server2IP=${server2IP})`,
      });
      return;
    }
    if (!rootPassword) {
      await postCallback(jobId, stepType, {
        status: 'failed',
        error_message: `SSH pre-connect failed: no root password available (ssh_credentials decrypt failed?)`,
      });
      return;
    }
    try {
      console.log(
        `[ProvisionStep] Connecting SSH for ${stepType}: ${server1IP} + ${server2IP}`
      );
      await ssh1.connect(server1IP, 22, 'root', { password: rootPassword });
      await ssh2.connect(server2IP, 22, 'root', { password: rootPassword });
      console.log(`[ProvisionStep] SSH connected to both servers for ${stepType}`);
    } catch (connErr) {
      const msg = connErr instanceof Error ? connErr.message : String(connErr);
      console.error(
        `[ProvisionStep] SSH connect failed for ${stepType} job ${jobId}: ${msg}`
      );
      await postCallback(jobId, stepType, {
        status: 'failed',
        error_message: `SSH pre-connect failed: ${msg}`,
      });
      return;
    }
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
