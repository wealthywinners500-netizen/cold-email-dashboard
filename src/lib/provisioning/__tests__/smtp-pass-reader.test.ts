/**
 * HL #138 regression: the canonical smtp_pass source is
 * ssh_credentials.password_encrypted, NOT create_vps step metadata
 * (the worker deliberately omits the password from step metadata to
 * prevent leaks through the dashboard UI). This test locks in the
 * reader contract for src/app/api/provisioning/[jobId]/worker-callback
 * and src/app/api/provisioning/[jobId]/execute-step:
 *
 *   1. When ssh_credentials has a row for the job, the reader returns
 *      the encrypted ciphertext untouched (decryption is the caller's
 *      responsibility so tests can stay pure).
 *   2. When ssh_credentials is missing (HL #133 violation), the reader
 *      throws a clear error. Silent fallback to "" is the anti-pattern
 *      that propagated into 90 broken email_accounts on P13/P14/P16.
 *
 * No Supabase, no network. Runs standalone via `tsx`.
 */

import {
  readEncryptedPasswordForJob,
  type SupabaseLikeForSmtpPass,
  type SshCredRow,
} from "../smtp-pass-reader";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function makeMockSupabase(
  responses: {
    data: SshCredRow | null;
    error: { message: string } | null;
  }[]
): { client: SupabaseLikeForSmtpPass; calls: { table: string; cols: string; col: string; val: string }[] } {
  const calls: { table: string; cols: string; col: string; val: string }[] = [];
  let responseIdx = 0;
  const client: SupabaseLikeForSmtpPass = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          limit: (_n: number) => ({
            maybeSingle: async () => {
              calls.push({ table, cols, col, val });
              const r = responses[responseIdx++];
              return r;
            },
          }),
        }),
      }),
    }),
  };
  return { client, calls };
}

async function testHappyPath(): Promise<void> {
  console.log("\n=== smtp-pass-reader: happy path ===\n");

  const { client, calls } = makeMockSupabase([
    { data: { password_encrypted: "BASE64_CIPHERTEXT_FIXTURE" }, error: null },
  ]);

  const result = await readEncryptedPasswordForJob(
    client,
    "job-happy-path",
    "TestLabel"
  );

  assert(
    result === "BASE64_CIPHERTEXT_FIXTURE",
    `expected ciphertext verbatim, got: ${JSON.stringify(result)}`
  );
  assert(calls.length === 1, `expected 1 query, got ${calls.length}`);
  assert(
    calls[0].table === "ssh_credentials",
    `expected table ssh_credentials, got ${calls[0].table}`
  );
  assert(
    calls[0].col === "provisioning_job_id",
    `expected filter on provisioning_job_id, got ${calls[0].col}`
  );
  assert(
    calls[0].val === "job-happy-path",
    `expected job id passthrough, got ${calls[0].val}`
  );
  assert(
    calls[0].cols === "password_encrypted",
    `expected to select only password_encrypted, got ${calls[0].cols}`
  );
  console.log(
    "✓ happy path: ssh_credentials query hits the right table + filter and returns the encrypted payload"
  );
}

async function testMissingRowThrows(): Promise<void> {
  console.log("\n=== smtp-pass-reader: missing ssh_credentials → throws ===\n");

  const { client } = makeMockSupabase([{ data: null, error: null }]);

  let caught: unknown = null;
  try {
    await readEncryptedPasswordForJob(client, "job-no-credentials", "TestLabel");
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, "expected an Error to be thrown");
  const msg = (caught as Error).message;
  assert(
    /ssh_credentials missing/.test(msg),
    `expected "ssh_credentials missing" in error message, got: ${msg}`
  );
  assert(
    /HL #133/.test(msg),
    `expected reference to HL #133 in error message, got: ${msg}`
  );
  assert(
    /TestLabel/.test(msg),
    `expected caller label to appear in error message, got: ${msg}`
  );
  console.log(
    "✓ missing row: throws with ssh_credentials-missing message and HL #133 reference (loud, not silent-empty)"
  );
}

async function testNullEncryptedPasswordThrows(): Promise<void> {
  console.log(
    "\n=== smtp-pass-reader: row exists but password_encrypted is null → throws ===\n"
  );

  const { client } = makeMockSupabase([
    { data: { password_encrypted: null }, error: null },
  ]);

  let caught: unknown = null;
  try {
    await readEncryptedPasswordForJob(client, "job-null-pw", "TestLabel");
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, "expected an Error to be thrown");
  const msg = (caught as Error).message;
  assert(
    /ssh_credentials missing/.test(msg),
    `expected "ssh_credentials missing" in error message, got: ${msg}`
  );
  console.log("✓ null password_encrypted treated the same as missing row");
}

async function testSupabaseErrorThrows(): Promise<void> {
  console.log("\n=== smtp-pass-reader: supabase error → throws ===\n");

  const { client } = makeMockSupabase([
    { data: null, error: { message: "postgrest timeout" } },
  ]);

  let caught: unknown = null;
  try {
    await readEncryptedPasswordForJob(client, "job-supa-err", "TestLabel");
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof Error, "expected an Error to be thrown");
  const msg = (caught as Error).message;
  assert(
    /ssh_credentials missing/.test(msg),
    `expected graceful throw on supabase error, got: ${msg}`
  );
  console.log("✓ supabase error propagates as a loud ssh_credentials-missing throw");
}

async function main(): Promise<void> {
  await testHappyPath();
  await testMissingRowThrows();
  await testNullEncryptedPasswordThrows();
  await testSupabaseErrorThrows();
  console.log("\nALL smtp-pass-reader TESTS PASS\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
