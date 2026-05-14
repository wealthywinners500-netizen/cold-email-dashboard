/**
 * saga-assertion (never-again 2026-05-13) tests
 *
 * Pins the post-Step-12 assertion that prevents the P18 placeholder-pw
 * regression class from ever reaching production again.
 *
 * Plain tsx + assert() style — no Jest/Vitest, matches the rest of the
 * gate-0 suite. Imports the pure helpers from
 * src/lib/provisioning/smtp-pass-assertion.ts and wires a minimal in-memory
 * Supabase mock plus an injected auth-probe stub so no network is touched.
 *
 * Coverage:
 *   1. rejects insert with smtp_pass = "PRESERVED_IN_HESTIA_PASSWD_BCRYPT"
 *   2. rejects insert with smtp_pass = "" (empty)
 *   3. rejects insert with smtp_pass = "Kroger2026Send" (14 chars — short)
 *   4. rejects insert with ALL_CAPS literal
 *   5. accepts real 22-char base64-ish password when auth probe succeeds
 *
 * Run: tsx src/__tests__/saga-assertion.test.ts
 */

import {
  PLACEHOLDER_PATTERNS,
  MIN_PASSWORD_LENGTH,
  SagaAssertionError,
  assertSmtpAccountsForJob,
  findInvalidPasswordRows,
  type AccountRow,
  type AuthProbeFn,
} from "../lib/provisioning/smtp-pass-assertion";

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

console.log("--- saga-assertion (never-again 2026-05-13) ---");

// ---------------------------------------------------------------
// Mock Supabase — implements just enough of the .from(...).select(...).eq(...) chain.
// ---------------------------------------------------------------

type Row = Record<string, unknown>;

function mockSupabaseWithAccounts(rows: Row[]): {
  from: (table: string) => unknown;
} {
  return {
    from(table: string) {
      if (table !== "email_accounts") {
        throw new Error(`unexpected table: ${table}`);
      }
      const filters: Array<(r: Row) => boolean> = [];
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        then<R>(resolve: (v: { data: Row[]; error: null }) => R): Promise<R> {
          const matched = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve(resolve({ data: matched, error: null }));
        },
      };
      return builder;
    },
  };
}

function fixtureRow(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: overrides.id ?? "row_1",
    email: overrides.email ?? "fixture@example.com",
    smtp_pass: overrides.smtp_pass ?? "",
    smtp_host: overrides.smtp_host ?? "mail1.example.com",
    smtp_port: overrides.smtp_port ?? 587,
  };
}

// ---------------------------------------------------------------
// PLACEHOLDER_PATTERNS — sanity check the pattern constants
// ---------------------------------------------------------------
assert(PLACEHOLDER_PATTERNS.length >= 5, "PLACEHOLDER_PATTERNS has >= 5 entries");
assert(MIN_PASSWORD_LENGTH === 16, "MIN_PASSWORD_LENGTH locked at 16");

// ---------------------------------------------------------------
// findInvalidPasswordRows — covers each pattern in isolation
// ---------------------------------------------------------------

const directBadRows: AccountRow[] = [
  fixtureRow({
    id: "r-placeholder",
    smtp_pass: "PRESERVED_IN_HESTIA_PASSWD_BCRYPT",
  }),
  fixtureRow({ id: "r-empty", smtp_pass: "" }),
  fixtureRow({ id: "r-short", smtp_pass: "Kroger2026Send" }), // 14 chars
  fixtureRow({ id: "r-allcaps", smtp_pass: "PRESERVED" }),
  fixtureRow({ id: "r-null-literal", smtp_pass: "null" }),
  fixtureRow({ id: "r-undefined-literal", smtp_pass: "undefined" }),
];
const directBadResults = findInvalidPasswordRows(directBadRows);
assert(
  directBadResults.length === directBadRows.length,
  `findInvalidPasswordRows rejects all 6 bad rows (got ${directBadResults.length})`
);

const realPwRows: AccountRow[] = [
  fixtureRow({ id: "r-ok", smtp_pass: "a8Kq2-Xz_pP1RmYvBcDg5w" }), // 22 chars
];
const realPwResults = findInvalidPasswordRows(realPwRows);
assert(
  realPwResults.length === 0,
  "findInvalidPasswordRows accepts real 22-char password"
);

// ---------------------------------------------------------------
// Test 1 — rejects PRESERVED_IN_HESTIA_PASSWD_BCRYPT (the actual P18 placeholder)
// ---------------------------------------------------------------

async function test1_placeholder(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r1",
      email: "chase.cruz@krogerretailpartners.info",
      smtp_pass: "PRESERVED_IN_HESTIA_PASSWD_BCRYPT",
      smtp_host: "mail1.example.com",
      smtp_port: 587,
      server_pair_id: "pair-p18",
    },
  ]);
  let caught: SagaAssertionError | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertSmtpAccountsForJob(sb as any, "pair-p18");
  } catch (err) {
    if (err instanceof SagaAssertionError) caught = err;
    else throw err;
  }
  assert(caught !== null, "Test 1: throws SagaAssertionError");
  assert(caught?.kind === "placeholder", "Test 1: kind=placeholder");
  assert(
    caught?.firstInvalidEmail === "chase.cruz@krogerretailpartners.info",
    "Test 1: firstInvalidEmail is the P18 row"
  );
}

// ---------------------------------------------------------------
// Test 2 — rejects empty smtp_pass (HL #138 class)
// ---------------------------------------------------------------

async function test2_empty(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r2",
      email: "kimberly.powell@slause.info",
      smtp_pass: "",
      smtp_host: "mail2.example.com",
      smtp_port: 587,
      server_pair_id: "pair-p12",
    },
  ]);
  let caught: SagaAssertionError | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertSmtpAccountsForJob(sb as any, "pair-p12");
  } catch (err) {
    if (err instanceof SagaAssertionError) caught = err;
    else throw err;
  }
  assert(caught !== null, "Test 2: throws on empty smtp_pass");
  assert(caught?.kind === "placeholder", "Test 2: kind=placeholder");
}

// ---------------------------------------------------------------
// Test 3 — rejects short (< 16 chars) smtp_pass (forces real entropy)
// ---------------------------------------------------------------

async function test3_short(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r3",
      email: "ella.collins@krogerretailpartners.info",
      smtp_pass: "Kroger2026Send", // 14 chars
      smtp_host: "mail1.example.com",
      smtp_port: 587,
      server_pair_id: "pair-x",
    },
  ]);
  let caught: SagaAssertionError | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertSmtpAccountsForJob(sb as any, "pair-x");
  } catch (err) {
    if (err instanceof SagaAssertionError) caught = err;
    else throw err;
  }
  assert(caught !== null, "Test 3: throws on 14-char smtp_pass");
  assert(caught?.kind === "placeholder", "Test 3: kind=placeholder");
}

// ---------------------------------------------------------------
// Test 4 — rejects ALL_CAPS literal (catches any future shouty placeholder)
// ---------------------------------------------------------------

async function test4_allcaps(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r4",
      email: "noah.edwards@example.com",
      smtp_pass: "PRESERVED",
      smtp_host: "mail1.example.com",
      smtp_port: 587,
      server_pair_id: "pair-y",
    },
  ]);
  let caught: SagaAssertionError | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertSmtpAccountsForJob(sb as any, "pair-y");
  } catch (err) {
    if (err instanceof SagaAssertionError) caught = err;
    else throw err;
  }
  assert(caught !== null, "Test 4: throws on ALL_CAPS literal");
  assert(caught?.kind === "placeholder", "Test 4: kind=placeholder");
}

// ---------------------------------------------------------------
// Test 5 — accepts real 22-char password when auth probe succeeds
// ---------------------------------------------------------------

async function test5_happy(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r5a",
      email: "liam.parker@example.com",
      smtp_pass: "a8Kq2-Xz_pP1RmYvBcDg5w", // 22 chars
      smtp_host: "mail1.example.com",
      smtp_port: 587,
      server_pair_id: "pair-good",
    },
    {
      id: "r5b",
      email: "maya.gomez@example.com",
      smtp_pass: "p9Lr3-Yz_qQ2SnZwCdEh6x", // 22 chars
      smtp_host: "mail2.example.com",
      smtp_port: 587,
      server_pair_id: "pair-good",
    },
  ]);
  let probedEmails: string[] = [];
  const stubAuthProbe: AuthProbeFn = async (account) => {
    probedEmails.push(account.email);
  };
  let result: { probedEmail: string; rowsChecked: number } | null = null;
  let threw = false;
  try {
    result = await assertSmtpAccountsForJob(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb as any,
      "pair-good",
      {
        authProbe: stubAuthProbe,
        pickProbe: (rs) => rs[0],
      }
    );
  } catch {
    threw = true;
  }
  assert(!threw, "Test 5: real pw + auth probe success does NOT throw");
  assert(result?.rowsChecked === 2, "Test 5: rowsChecked=2");
  assert(
    result?.probedEmail === "liam.parker@example.com",
    "Test 5: probedEmail matches pickProbe selection"
  );
  assert(probedEmails.length === 1, "Test 5: exactly 1 auth probe attempted");
}

// ---------------------------------------------------------------
// Test 6 — auth probe failure surfaces as SagaAssertionError kind='auth_probe'
//   (Defensive — the prompt's tests pin 5 cases; this 6th pins the other branch)
// ---------------------------------------------------------------

async function test6_auth_probe_fail(): Promise<void> {
  const sb = mockSupabaseWithAccounts([
    {
      id: "r6",
      email: "donna.edwards@example.com",
      smtp_pass: "z9Lr3-Yz_qQ2SnZwCdEh6x", // 22 chars — passes placeholder check
      smtp_host: "mail1.example.com",
      smtp_port: 587,
      server_pair_id: "pair-auth-fail",
    },
  ]);
  const failingProbe: AuthProbeFn = async () => {
    throw new Error("535 Authentication failed");
  };
  let caught: SagaAssertionError | null = null;
  try {
    await assertSmtpAccountsForJob(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sb as any,
      "pair-auth-fail",
      {
        authProbe: failingProbe,
        pickProbe: (rs) => rs[0],
      }
    );
  } catch (err) {
    if (err instanceof SagaAssertionError) caught = err;
    else throw err;
  }
  assert(caught !== null, "Test 6: AUTH probe failure throws");
  assert(caught?.kind === "auth_probe", "Test 6: kind=auth_probe");
}

(async () => {
  await test1_placeholder();
  await test2_empty();
  await test3_short();
  await test4_allcaps();
  await test5_happy();
  await test6_auth_probe_fail();
  console.log("--- saga-assertion: all PASS ---");
})().catch((err) => {
  console.error("FAIL: unexpected exception", err);
  process.exit(1);
});
