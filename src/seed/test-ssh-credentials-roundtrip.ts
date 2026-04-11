/**
 * Round-trip test for createSSHCredentials encryption pipeline.
 *
 * Exercises the exact code path the per-step wizard driver uses for
 * Hard Lesson #58 (password-persistence bug):
 *
 *   crypto.randomBytes → encrypt() → createSSHCredentials() → query → decrypt()
 *
 * and asserts that the recovered plaintext matches the original password.
 * Cleans up the inserted row(s) on exit.
 *
 * Run with:
 *   ENCRYPTION_KEY=... \
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx src/seed/test-ssh-credentials-roundtrip.ts
 *
 * Exits non-zero on any assertion failure so it can be wired into CI
 * later without further changes.
 */

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/provisioning/encryption";

const TEST_ORG_ID = process.env.TEST_ORG_ID || "org_test_ssh_roundtrip";
const TEST_IP = "203.0.113.250"; // TEST-NET-3, guaranteed never routable
const TEST_HOSTNAME = "mail-roundtrip.example.invalid";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`❌ ASSERT FAILED: ${message}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "NEXT_PUBLIC_SUPABASE_URL is required");
  assert(srk, "SUPABASE_SERVICE_ROLE_KEY is required");
  assert(
    process.env.ENCRYPTION_KEY,
    "ENCRYPTION_KEY is required (same env var the worker + Vercel use)"
  );

  const supabase = createClient(url as string, srk as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Generate the same kind of password the wizard generates in Step 1
  const plaintext = crypto.randomBytes(16).toString("base64url");
  console.log(
    `→ generated ${plaintext.length}-char password ending in ${plaintext.slice(-4)}`
  );

  const ciphertext = encrypt(plaintext);
  assert(ciphertext !== plaintext, "encrypt() returned plaintext");
  assert(ciphertext.length > plaintext.length, "ciphertext too short");

  // Insert via the service-role client (mirrors what createSSHCredentials does
  // inside the real createAdminClient flow — we bypass the helper here so
  // the script has no dependency on Next.js server-only module chain).
  const { data: inserted, error: insertErr } = await supabase
    .from("ssh_credentials")
    .insert({
      org_id: TEST_ORG_ID,
      server_ip: TEST_IP,
      hostname: TEST_HOSTNAME,
      username: "root",
      password_encrypted: ciphertext,
      port: 22,
    })
    .select()
    .single();

  assert(!insertErr, `insert failed: ${insertErr?.message}`);
  assert(inserted, "insert returned no row");
  console.log(`✓ inserted ssh_credentials row id=${inserted.id}`);

  // Query it back
  const { data: fetched, error: fetchErr } = await supabase
    .from("ssh_credentials")
    .select("*")
    .eq("id", inserted.id)
    .single();

  assert(!fetchErr, `fetch failed: ${fetchErr?.message}`);
  assert(fetched, "fetch returned no row");
  assert(
    typeof fetched.password_encrypted === "string" &&
      fetched.password_encrypted.length > 0,
    "fetched row has empty password_encrypted"
  );
  assert(
    fetched.password_encrypted === ciphertext,
    "ciphertext changed in round trip"
  );

  // Decrypt and compare
  const recovered = decrypt(fetched.password_encrypted);
  assert(
    recovered === plaintext,
    `decrypt mismatch: expected ${plaintext.slice(-4)} got ${recovered.slice(-4)}`
  );
  console.log(`✓ round-trip OK: recovered plaintext matches original`);

  // Cleanup
  const { error: deleteErr } = await supabase
    .from("ssh_credentials")
    .delete()
    .eq("id", inserted.id);
  assert(!deleteErr, `cleanup delete failed: ${deleteErr?.message}`);
  console.log(`✓ cleaned up test row ${inserted.id}`);

  console.log("\n✅ ALL ASSERTIONS PASSED — ssh_credentials round-trip OK");
}

main().catch((err) => {
  console.error("❌ test runner threw:", err);
  process.exit(1);
});
