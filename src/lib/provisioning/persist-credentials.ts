// ============================================
// Shared SSH credential persistence for Step 1 (create_vps).
//
// Hard Lesson #58 (2026-04-10): credential persistence MUST live in the
// canonical per-step driver, not the legacy provision-pair.ts handler.
//
// Hard Lesson #59 (2026-04-10, Test #14): the `create_vps` step was also
// being killed by Vercel's 60s serverless maxDuration while Linode was
// still booting, so persistPairCredentials() never ran even though the
// driver tried to call it. Fix: move `create_vps` entirely to the worker
// (which has no time cap), and share a single implementation of the
// credential-persistence logic between the Vercel route (dry-run,
// regression test) and the worker handler (real execution).
// ============================================
import { encrypt } from "./encryption";
import { createSSHCredentials } from "@/lib/supabase/queries";

export interface PersistPairCredentialsParams {
  orgId: string;
  jobId: string;
  nsDomain: string;
  server1IP: string;
  server2IP: string;
  rootPassword: string;
}

/**
 * Encrypt the shared root password and insert two `ssh_credentials` rows
 * (one per server) linked to the provisioning job via
 * `provisioning_job_id`. Throws on encryption or insert failure so the
 * caller can fail the step — a pair is NOT complete if we cannot SSH
 * back into it.
 *
 * encrypt() is AES-256-GCM over the ENCRYPTION_KEY env var — it will
 * throw "ENCRYPTION_KEY environment variable is not set" if the key is
 * missing on Vercel or on the worker VPS. Lazy-init per Hard Lesson #34.
 */
export async function persistPairCredentials(
  params: PersistPairCredentialsParams
): Promise<void> {
  const { orgId, jobId, nsDomain, server1IP, server2IP, rootPassword } =
    params;

  const passwordEncrypted = encrypt(rootPassword);

  await createSSHCredentials(orgId, {
    server_ip: server1IP,
    hostname: `mail1.${nsDomain}`,
    username: "root",
    password_encrypted: passwordEncrypted,
    port: 22,
    provisioning_job_id: jobId,
  });

  await createSSHCredentials(orgId, {
    server_ip: server2IP,
    hostname: `mail2.${nsDomain}`,
    username: "root",
    password_encrypted: passwordEncrypted,
    port: 22,
    provisioning_job_id: jobId,
  });
}
