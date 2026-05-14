// === ASSERTION: never-again 2026-05-13 ===
// Post-Step-12 invariant for the provisioning saga. Validates that
// email_accounts.smtp_pass rows freshly written by the worker-callback
// completion handler are real passwords (not placeholder strings, not
// empty, not short), and runs one live nodemailer.verify() AUTH probe
// against a randomly-chosen row before allowing the saga to mark the
// job 'completed'.
//
// Triggered by the 2026-04-24 P18 incident: the worker-callback wrote
// the literal string "PRESERVED_IN_HESTIA_PASSWD_BCRYPT" into every
// email_accounts.smtp_pass field for the pair, then marked the job
// completed. The dashboard auth-failed for 19 days before V7 found it.
// Same root-cause class as HL #138 (P13/P14/P16 empty smtp_pass).
//
// Test pin: src/__tests__/saga-assertion.test.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Patterns that flag a placeholder / sentinel / fallback string.
// Order matters: most specific first.
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^$/, // empty
  /^PRESERVED_IN_HESTIA_PASSWD_BCRYPT$/, // exact P18 placeholder
  /^[A-Z][A-Z0-9_]+$/, // ALL_CAPS literals (catches any future shouty placeholder)
  /^null$/i,
  /^undefined$/i,
];

export const MIN_PASSWORD_LENGTH = 16;

export type AccountRow = {
  id: string;
  email: string;
  smtp_pass: string | null;
  smtp_host: string;
  smtp_port: number | null;
};

export type AuthProbeFn = (account: AccountRow) => Promise<void>;

export type AssertSmtpDeps = {
  authProbe?: AuthProbeFn;
  pickProbe?: (rows: AccountRow[]) => AccountRow | null;
};

export class SagaAssertionError extends Error {
  constructor(
    message: string,
    public readonly kind: "placeholder" | "auth_probe",
    public readonly invalidCount: number,
    public readonly firstInvalidEmail?: string
  ) {
    super(message);
    this.name = "SagaAssertionError";
  }
}

/**
 * Pure-function assertion over a set of rows. Returns the invalid subset.
 * Exported for unit testing without DB.
 */
export function findInvalidPasswordRows(rows: AccountRow[]): AccountRow[] {
  return rows.filter((r) => {
    const pw = r.smtp_pass ?? "";
    if (PLACEHOLDER_PATTERNS.some((re) => re.test(pw))) return true;
    if (pw.length < MIN_PASSWORD_LENGTH) return true;
    return false;
  });
}

/**
 * Default live AUTH probe — opens a STARTTLS connection and runs
 * nodemailer.verify(). Caller can stub via deps.authProbe in tests.
 */
export async function defaultAuthProbe(account: AccountRow): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port ?? 587,
    secure: false,
    auth: {
      user: account.email,
      pass: account.smtp_pass ?? "",
    },
    tls: {
      // Production smtp_host stores the Hestia hostname for P18-style pairs;
      // older pairs (P12, P17) store IPs. The worker-callback ALWAYS writes
      // the IP into smtp_host (see route.ts:331). Cert verification needs
      // a hostname, so rejectUnauthorized stays false for this probe — the
      // probe's purpose is AUTH validation, not TLS chain validation.
      rejectUnauthorized: false,
    },
    connectionTimeout: 15000,
    socketTimeout: 15000,
  });
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

/**
 * Re-reads the email_accounts rows freshly inserted for `pairId`, runs the
 * placeholder/length assertion, then runs one live AUTH probe against a
 * random row. Throws SagaAssertionError on any failure — the caller is
 * responsible for marking the provisioning_jobs row failed.
 */
export async function assertSmtpAccountsForJob(
  supabase: SupabaseClient,
  pairId: string,
  deps: AssertSmtpDeps = {}
): Promise<{ probedEmail: string; rowsChecked: number }> {
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, email, smtp_pass, smtp_host, smtp_port")
    .eq("server_pair_id", pairId);

  if (error) {
    throw new Error(`assertSmtpAccountsForJob: read failed: ${error.message}`);
  }
  const rows = (data ?? []) as AccountRow[];
  if (rows.length === 0) {
    // Nothing inserted — the completion handler should have set
    // accountsCreated=0 and not reach the assertion path. Defensive
    // skip so we don't crash on an empty pair.
    return { probedEmail: "", rowsChecked: 0 };
  }

  const invalid = findInvalidPasswordRows(rows);
  if (invalid.length > 0) {
    throw new SagaAssertionError(
      `smtp_pass assertion failed: ${invalid.length} accounts have placeholder/empty/short smtp_pass. First: ${invalid[0].email}. Cf HL #138 + 2026-05-13 P18 incident.`,
      "placeholder",
      invalid.length,
      invalid[0].email
    );
  }

  const pick =
    deps.pickProbe ??
    ((rs: AccountRow[]) => rs[Math.floor(Math.random() * rs.length)] ?? null);
  const probe = pick(rows);
  if (!probe) return { probedEmail: "", rowsChecked: rows.length };

  const authProbe = deps.authProbe ?? defaultAuthProbe;
  try {
    await authProbe(probe);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SagaAssertionError(
      `Live AUTH probe failed for ${probe.email}: ${msg}. smtp_pass present but does not authenticate.`,
      "auth_probe",
      1,
      probe.email
    );
  }

  return { probedEmail: probe.email, rowsChecked: rows.length };
}
// === /ASSERTION ===
