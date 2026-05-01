/**
 * V8 (2026-04-30): verify-new-leads handler unit tests.
 *
 * Six tests:
 *   1. payload {orgId, lead_list_id} filters lead_contacts by lead_list_id
 *   2. payload {orgId} (no lead_list_id) does NOT filter by list
 *   3. mixed Reoon statuses (safe/risky/invalid) map correctly via PR #31's canonical mapper
 *   4. verification_result JSONB populated with raw Reoon response per row
 *   5. missing REOON_API_KEY throws (caught by withErrorHandling upstream)
 *   6. Reoon failure on individual email leaves that row at email_status='pending' (no overstatement to 'unknown')
 *
 * The supabase client is replaced with an in-memory recorder via env-driven
 * dependency: we use a module-scoped fetch mock + a chainable supabase stub
 * passed in via globalThis. This keeps the test tsx-runnable with no jest/vitest
 * dependency, matching the codebase pattern (verification-service.test.ts,
 * outscraper-task-complete.test.ts).
 *
 * Run via: tsx src/worker/handlers/__tests__/verify-new-leads.test.ts
 */

import {
  handleVerifyNewLeads,
  __setSupabaseFactoryForTests,
  __resetSupabaseFactoryForTests,
} from '../verify-new-leads';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

// --- supabase stub recorder ----------------------------------------------
type EqCall = { col: string; val: unknown };
type RecordedQuery = {
  table: string;
  select?: string;
  eqCalls: EqCall[];
  notCalls: { col: string; op: string; val: unknown }[];
  limit?: number;
  updates: { id: string; payload: Record<string, unknown> }[];
};

interface SupabaseStubResult {
  rows: { id: string; email: string }[];
  recorded: RecordedQuery;
}

function makeSupabaseStub(rows: { id: string; email: string }[]): {
  client: unknown;
  recorded: RecordedQuery;
} {
  const recorded: RecordedQuery = {
    table: '',
    eqCalls: [],
    notCalls: [],
    updates: [],
  };

  const queryBuilder = {
    select(cols: string) {
      recorded.select = cols;
      return queryBuilder;
    },
    eq(col: string, val: unknown) {
      recorded.eqCalls.push({ col, val });
      return queryBuilder;
    },
    not(col: string, op: string, val: unknown) {
      recorded.notCalls.push({ col, op, val });
      return queryBuilder;
    },
    limit(n: number) {
      recorded.limit = n;
      return Promise.resolve({ data: rows, error: null });
    },
    update(payload: Record<string, unknown>) {
      // Update path returns a thenable that records the eq(id) call.
      return {
        eq(col: string, val: unknown) {
          if (col === 'id') {
            recorded.updates.push({ id: String(val), payload });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const client = {
    from(table: string) {
      recorded.table = table;
      return queryBuilder;
    },
  };

  return { client, recorded };
}

// --- Reoon fetch mock ----------------------------------------------------
type ReoonReply = { ok: boolean; status: string; body?: Record<string, unknown> };
const reoonMockReplies = new Map<string, ReoonReply>();
let reoonCallLog: string[] = [];

const originalFetch = globalThis.fetch;
function installReoonMock() {
  reoonCallLog = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    reoonCallLog.push(u);
    // URL: https://emailverifier.reoon.com/api/v1/verify?email=<e>&key=…&mode=power
    const m = u.match(/[?&]email=([^&]+)/);
    const email = m ? decodeURIComponent(m[1]) : '';
    const reply = reoonMockReplies.get(email);
    if (!reply) {
      // Default unknown reply
      return {
        ok: true,
        json: async () => ({ email, status: 'unknown' }),
      } as Response;
    }
    if (!reply.ok) {
      return {
        ok: false,
        status: 500,
        text: async () => `mocked failure for ${email}`,
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ email, status: reply.status, ...(reply.body || {}) }),
    } as Response;
  }) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// --- supabase DI hook ----------------------------------------------------
function installSupabaseStub(stub: unknown) {
  __setSupabaseFactoryForTests(() => stub as SupabaseClient);
}
function restoreSupabase() {
  __resetSupabaseFactoryForTests();
}

// --- env helpers ---------------------------------------------------------
const ORIGINAL_REOON_KEY = process.env.REOON_API_KEY;
function setReoonKey(v: string | undefined) {
  if (v === undefined) delete process.env.REOON_API_KEY;
  else process.env.REOON_API_KEY = v;
}

// ── Tests ────────────────────────────────────────────────────────────────
console.log('\nverify-new-leads handler tests (V8)\n');

(async () => {
  // T1: payload with lead_list_id filters by list
  await test('payload with lead_list_id adds .eq("lead_list_id", ...) to query', async () => {
    setReoonKey('test_key_t1');
    const { client, recorded } = makeSupabaseStub([]);
    installSupabaseStub(client);
    installReoonMock();

    await handleVerifyNewLeads({ orgId: 'org_T1', lead_list_id: 'list_T1' });

    const orgEq = recorded.eqCalls.find((c) => c.col === 'org_id');
    const listEq = recorded.eqCalls.find((c) => c.col === 'lead_list_id');
    const statusEq = recorded.eqCalls.find((c) => c.col === 'email_status');
    assert(orgEq?.val === 'org_T1', 'org_id .eq present');
    assert(listEq?.val === 'list_T1', 'lead_list_id .eq present');
    assert(statusEq?.val === 'pending', 'email_status=pending .eq present');

    restoreFetch();
    restoreSupabase();
  });

  // T2: payload without lead_list_id does NOT filter by list
  await test('payload without lead_list_id omits .eq("lead_list_id", ...)', async () => {
    setReoonKey('test_key_t2');
    const { client, recorded } = makeSupabaseStub([]);
    installSupabaseStub(client);
    installReoonMock();

    await handleVerifyNewLeads({ orgId: 'org_T2' });

    const listEq = recorded.eqCalls.find((c) => c.col === 'lead_list_id');
    assert(listEq === undefined, 'no lead_list_id filter');
    const orgEq = recorded.eqCalls.find((c) => c.col === 'org_id');
    assert(orgEq?.val === 'org_T2', 'org_id .eq still present');

    restoreFetch();
    restoreSupabase();
  });

  // T3: mixed Reoon statuses map correctly via canonical mapper
  await test("mixed Reoon statuses (safe/risky/invalid) map via PR #31's canonical mapper", async () => {
    setReoonKey('test_key_t3');
    const rows = [
      { id: 'r1', email: 'safe@x.com' },
      { id: 'r2', email: 'risky@x.com' },
      { id: 'r3', email: 'invalid@x.com' },
    ];
    const { client, recorded } = makeSupabaseStub(rows);
    installSupabaseStub(client);
    installReoonMock();
    reoonMockReplies.set('safe@x.com', { ok: true, status: 'safe' });
    reoonMockReplies.set('risky@x.com', { ok: true, status: 'role_account' });
    reoonMockReplies.set('invalid@x.com', { ok: true, status: 'disabled' });

    await handleVerifyNewLeads({ orgId: 'org_T3' });

    const byId = new Map(recorded.updates.map((u) => [u.id, u.payload]));
    assert(byId.get('r1')?.email_status === 'valid', 'safe → valid (PR #31 mapper)');
    assert(byId.get('r2')?.email_status === 'risky', 'role_account → risky');
    assert(byId.get('r3')?.email_status === 'invalid', 'disabled → invalid');

    reoonMockReplies.clear();
    restoreFetch();
    restoreSupabase();
  });

  // T4: verification_result JSONB populated with raw Reoon response
  await test('verification_result JSONB populated with raw Reoon response', async () => {
    setReoonKey('test_key_t4');
    const rows = [{ id: 'r1', email: 'safe@x.com' }];
    const { client, recorded } = makeSupabaseStub(rows);
    installSupabaseStub(client);
    installReoonMock();
    reoonMockReplies.set('safe@x.com', {
      ok: true,
      status: 'safe',
      body: { is_safe_to_send: true, mx_records: ['mx1.x.com'] },
    });

    await handleVerifyNewLeads({ orgId: 'org_T4' });

    const upd = recorded.updates.find((u) => u.id === 'r1');
    assert(upd, 'r1 was updated');
    const vr = upd!.payload.verification_result as Record<string, unknown>;
    assert(vr && typeof vr === 'object', 'verification_result is an object');
    assert(vr.status === 'safe', 'raw status preserved');
    assert(vr.is_safe_to_send === true, 'extra fields preserved');
    assert(Array.isArray(vr.mx_records), 'mx_records preserved');
    assert(upd!.payload.verification_source === 'reoon', "verification_source = 'reoon'");
    assert(typeof upd!.payload.verified_at === 'string', 'verified_at is ISO timestamp');

    reoonMockReplies.clear();
    restoreFetch();
    restoreSupabase();
  });

  // T5: missing REOON_API_KEY throws
  await test('missing REOON_API_KEY throws', async () => {
    setReoonKey(undefined);
    const { client } = makeSupabaseStub([]);
    installSupabaseStub(client);
    installReoonMock();

    let caught: Error | null = null;
    try {
      await handleVerifyNewLeads({ orgId: 'org_T5' });
    } catch (err) {
      caught = err as Error;
    }
    assert(caught !== null, 'expected throw');
    assert(/REOON_API_KEY/.test(caught!.message), 'error mentions REOON_API_KEY');

    restoreFetch();
    restoreSupabase();
  });

  // T6: Reoon failure leaves row at email_status='pending'
  await test("Reoon failure on individual email leaves row at email_status='pending' (no 'unknown' overstatement)", async () => {
    setReoonKey('test_key_t6');
    const rows = [
      { id: 'r1', email: 'fails@x.com' },
      { id: 'r2', email: 'works@x.com' },
    ];
    const { client, recorded } = makeSupabaseStub(rows);
    installSupabaseStub(client);
    installReoonMock();
    reoonMockReplies.set('fails@x.com', { ok: false, status: 'should_not_be_used' });
    reoonMockReplies.set('works@x.com', { ok: true, status: 'safe' });

    await handleVerifyNewLeads({ orgId: 'org_T6' });

    // r1 failed → must NOT be in updates (handler skips failed rows; they
    // remain at email_status='pending' from the existing row state)
    const r1Update = recorded.updates.find((u) => u.id === 'r1');
    const r2Update = recorded.updates.find((u) => u.id === 'r2');
    assert(r1Update === undefined, 'failed row not updated (preserves pending; no false unknown)');
    assert(r2Update !== undefined, 'successful row updated');
    assert(r2Update!.payload.email_status === 'valid', 'successful row gets valid');

    reoonMockReplies.clear();
    restoreFetch();
    restoreSupabase();
  });

  // Cleanup
  setReoonKey(ORIGINAL_REOON_KEY);

  console.log(`\n${tests - failed}/${tests} tests passed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
