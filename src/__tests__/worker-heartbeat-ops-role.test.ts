/**
 * worker-heartbeat-ops-role (never-again 2026-05-13) test
 *
 * Pins the heartbeat-writer fix from Phase 2 of the never-again PR.
 *
 * Per `dashboard-app/audit/DASHBOARD-AUDIT-2026-05-13.md` §3, the unified
 * worker process runs both 'send' and 'ops' queue handlers from the same
 * host, but only the 'send' role row in worker_heartbeats was being
 * refreshed — the 'ops' role row was stale 25 days (last_ping
 * 2026-04-18T18:03). The fix: have the per-60s heartbeat interval issue
 * an UPDATE for every configured role.
 *
 * Plain tsx + assert(). Mocks Supabase with a minimal in-memory builder
 * supporting `from(...).update(...).eq(...)`.
 *
 * Run: tsx src/__tests__/worker-heartbeat-ops-role.test.ts
 */

import { updateWorkerRoleHeartbeats } from "../lib/email/error-handler";

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

console.log("--- worker-heartbeat-ops-role (never-again 2026-05-13) ---");

type Row = Record<string, unknown>;

interface UpdateCall {
  table: string;
  patch: Row;
  filter: { col: string; val: unknown };
}

function buildMockSupabase(opts: {
  rows: Row[];
  failForRole?: string;
}): { client: unknown; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const client = {
    from(table: string) {
      let pendingPatch: Row | null = null;
      const builder = {
        update(patch: Row) {
          pendingPatch = patch;
          return builder;
        },
        eq(col: string, val: unknown) {
          calls.push({ table, patch: pendingPatch ?? {}, filter: { col, val } });
          if (opts.failForRole && col === "worker_role" && val === opts.failForRole) {
            return Promise.resolve({
              error: { message: `simulated DB error for ${val}` },
              data: null,
            });
          }
          // Apply patch to in-memory rows that match
          for (const r of opts.rows) {
            if (r[col] === val && pendingPatch) {
              Object.assign(r, pendingPatch);
            }
          }
          return Promise.resolve({ error: null, data: null });
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

// ---------------------------------------------------------------
// Test — happy path: both 'send' and 'ops' rows get refreshed
// ---------------------------------------------------------------

async function testHappyPath(): Promise<void> {
  const rows: Row[] = [
    {
      worker_role: "send",
      host: "cold-send-worker-01",
      last_ping_at: "2026-05-13T21:48:00Z",
    },
    {
      worker_role: "ops",
      host: "mail1.partner-with-kroger.info",
      last_ping_at: "2026-04-18T18:03:00Z", // 25-day-stale
    },
  ];
  const { client, calls } = buildMockSupabase({ rows });

  const before = Date.now();
  const results = await updateWorkerRoleHeartbeats(
    ["send", "ops"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any
  );
  const after = Date.now();

  assert(results.length === 2, "Test: 2 results returned");
  assert(results[0].role === "send" && results[0].updated, "Test: send row updated");
  assert(results[1].role === "ops" && results[1].updated, "Test: ops row updated");

  assert(calls.length === 2, "Test: exactly 2 update calls issued");
  assert(
    calls[0].table === "worker_heartbeats" && calls[1].table === "worker_heartbeats",
    "Test: both updates target worker_heartbeats"
  );
  assert(
    calls[0].filter.col === "worker_role" && calls[0].filter.val === "send",
    "Test: first update filters worker_role=send"
  );
  assert(
    calls[1].filter.col === "worker_role" && calls[1].filter.val === "ops",
    "Test: second update filters worker_role=ops"
  );

  const opsRow = rows.find((r) => r.worker_role === "ops");
  assert(opsRow !== undefined, "Test: ops row still present");
  const stamp = opsRow!.last_ping_at as string;
  const parsed = Date.parse(stamp);
  assert(
    parsed >= before && parsed <= after,
    `Test: ops last_ping_at refreshed (got ${stamp}, expected within [${new Date(before).toISOString()}, ${new Date(after).toISOString()}])`
  );

  const sendRow = rows.find((r) => r.worker_role === "send");
  assert(sendRow !== undefined, "Test: send row still present");
  const sendStamp = sendRow!.last_ping_at as string;
  assert(
    Date.parse(sendStamp) >= before,
    "Test: send last_ping_at also refreshed"
  );
}

// ---------------------------------------------------------------
// Test — failure isolation: if one role's UPDATE errors, the other
//                          still gets refreshed and the function returns
// ---------------------------------------------------------------

async function testPartialFailure(): Promise<void> {
  const rows: Row[] = [
    {
      worker_role: "send",
      host: "cold-send-worker-01",
      last_ping_at: "old",
    },
    {
      worker_role: "ops",
      host: "mail1.partner-with-kroger.info",
      last_ping_at: "older",
    },
  ];
  const { client } = buildMockSupabase({ rows, failForRole: "ops" });

  let results: Array<{ role: string; updated: boolean; error?: string }> = [];
  let threw = false;
  try {
    results = await updateWorkerRoleHeartbeats(
      ["send", "ops"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any
    );
  } catch {
    threw = true;
  }
  assert(!threw, "Partial failure: function does NOT throw on per-role error");
  assert(results.length === 2, "Partial failure: 2 results returned");
  assert(results[0].role === "send" && results[0].updated, "Partial failure: send still OK");
  assert(
    results[1].role === "ops" && !results[1].updated && results[1].error,
    "Partial failure: ops marked NOT-updated with error message"
  );
}

(async () => {
  await testHappyPath();
  await testPartialFailure();
  console.log("--- worker-heartbeat-ops-role: all PASS ---");
})().catch((err) => {
  console.error("FAIL: unexpected exception", err);
  process.exit(1);
});
