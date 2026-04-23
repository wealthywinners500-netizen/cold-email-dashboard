/**
 * Canonical reader for the encrypted server password used as
 * email_accounts.smtp_pass on a given provisioning job.
 *
 * HL #132 — email_accounts.smtp_user and .smtp_pass are NOT NULL.
 * HL #133 — the root password is persisted to ssh_credentials by
 *   persistPairCredentials() inside the create_vps step (see
 *   src/lib/provisioning/persist-credentials.ts:38-74). The worker
 *   DELIBERATELY omits the password from create_vps step metadata for
 *   dashboard-UI-leak reasons (provision-step.ts:469-484).
 * HL #138 — the previous reader implementation fetched
 *   vpsMeta.serverPassword_encrypted from the step metadata, silent-
 *   fell-back to "" on miss, and propagated an empty smtp_pass into
 *   90 email_accounts across P13/P14/P16. The silent fallback masked
 *   the failure until send time. This helper throws on miss so HL #133
 *   violations are loud.
 *
 * Returns the base64-encoded AES-256-GCM ciphertext. Caller must
 * decrypt separately — keeping decryption out of this helper lets the
 * unit test inject a mock supabase without also needing ENCRYPTION_KEY.
 */
export interface SshCredRow {
  password_encrypted: string | null;
}

/**
 * Structural-typing alias intentionally loose: both the real
 * `SupabaseClient` from `@supabase/supabase-js` and test doubles satisfy
 * it. Real client's builder returns a `PostgrestBuilder` (thenable,
 * `.catch` + `.finally` + `.then`, not a plain Promise), which breaks
 * the strict-Promise narrowing; typing as a thenable-returning fluent
 * builder keeps mock parity without reaching for `any` at call sites.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLikeForSmtpPass = any;

export async function readEncryptedPasswordForJob(
  supabase: SupabaseLikeForSmtpPass,
  jobId: string,
  label: string
): Promise<string> {
  const { data: sshCred, error } = await supabase
    .from("ssh_credentials")
    .select("password_encrypted")
    .eq("provisioning_job_id", jobId)
    .limit(1)
    .maybeSingle();

  if (error || !sshCred?.password_encrypted) {
    throw new Error(
      `[${label}] ssh_credentials missing for job ${jobId} — ` +
        `step 1 (create_vps) did not persist pw (HL #133 violation). ` +
        `Cannot insert email_accounts without smtp_pass.`
    );
  }
  return sshCred.password_encrypted;
}
