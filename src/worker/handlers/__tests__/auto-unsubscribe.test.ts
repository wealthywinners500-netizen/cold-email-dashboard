/**
 * V1+b: handler-side auto-unsubscribe tests for the STOP classification.
 *
 * Tests `applyAutoUnsubscribe` (exported from sync-inbox.ts) directly. No
 * network — supabase is a recording mock that returns scripted shapes.
 *
 * Run: tsx src/worker/handlers/__tests__/auto-unsubscribe.test.ts
 */

import { applyAutoUnsubscribe } from '../sync-inbox';
import type { Classification } from '../../../lib/email/reply-classifier';

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

interface MockOptions {
  /** Row returned by the `lead_contacts.maybeSingle()` lookup. */
  contact?: { id: string; unsubscribed_at: string | null } | null;
}

function makeSupabaseStub(opts: MockOptions = {}) {
  const recorder = {
    selectTable: '' as string,
    contactSelectArgs: [] as Array<{ method: string; args: unknown[] }>,
    updates: [] as Array<{ table: string; payload: unknown; filters: unknown[] }>,
    inserts: [] as Array<{ table: string; row: unknown }>,
  };

  function chainForFrom(table: string) {
    const filters: Array<{ method: string; args: unknown[] }> = [];
    let pendingPayload: unknown = null;

    const obj: Record<string, unknown> = {};
    obj.select = (..._args: unknown[]) => obj;
    obj.eq = (...args: unknown[]) => {
      filters.push({ method: 'eq', args });
      if (table === 'lead_contacts') {
        recorder.contactSelectArgs.push({ method: 'eq', args });
      }
      return obj;
    };
    obj.ilike = (...args: unknown[]) => {
      filters.push({ method: 'ilike', args });
      if (table === 'lead_contacts') {
        recorder.contactSelectArgs.push({ method: 'ilike', args });
      }
      return obj;
    };
    obj.is = (...args: unknown[]) => {
      filters.push({ method: 'is', args });
      return obj;
    };
    obj.not = (...args: unknown[]) => {
      filters.push({ method: 'not', args });
      return obj;
    };
    obj.maybeSingle = async () => {
      if (table === 'lead_contacts') {
        return { data: opts.contact ?? null };
      }
      return { data: null };
    };
    obj.update = (payload: unknown) => {
      pendingPayload = payload;
      return {
        eq: (...args: unknown[]) => {
          filters.push({ method: 'eq', args });
          return {
            eq: (...args2: unknown[]) => {
              filters.push({ method: 'eq', args: args2 });
              return {
                is: async (...args3: unknown[]) => {
                  filters.push({ method: 'is', args: args3 });
                  recorder.updates.push({ table, payload: pendingPayload, filters: [...filters] });
                  return { error: null };
                },
              };
            },
          };
        },
      };
    };
    obj.insert = async (row: unknown) => {
      recorder.inserts.push({ table, row });
      return { error: null };
    };
    return obj;
  }

  const supabase = {
    from: (table: string) => chainForFrom(table),
  };

  return { supabase, recorder };
}

console.log('\nauto-unsubscribe handler tests\n');

(async () => {
  await test('classification != STOP short-circuits (no DB calls)', async () => {
    const { supabase, recorder } = makeSupabaseStub();
    for (const cls of ['INTERESTED', 'HOT_LEAD', 'OBJECTION', 'AUTO_REPLY', 'BOUNCE', 'NOT_INTERESTED', 'SPAM'] as Classification[]) {
      const result = await applyAutoUnsubscribe(
        // @ts-expect-error stub
        supabase,
        'org_test',
        'foo@bar.com',
        cls,
        42
      );
      assert(result.applied === false, `${cls} should not apply`);
      assert(result.contactId === null, `${cls} should not resolve contact`);
    }
    assert(recorder.contactSelectArgs.length === 0, 'should not query lead_contacts');
    assert(recorder.updates.length === 0, 'should not update');
    assert(recorder.inserts.length === 0, 'should not insert system_alerts');
  });

  await test('STOP with already-unsubscribed contact is idempotent', async () => {
    const { supabase, recorder } = makeSupabaseStub({
      contact: { id: 'contact_a', unsubscribed_at: '2026-04-29T00:00:00Z' },
    });
    const result = await applyAutoUnsubscribe(
      // @ts-expect-error stub
      supabase,
      'org_test',
      'foo@bar.com',
      'STOP',
      42
    );
    assert(result.applied === false, 'idempotent path must not "apply"');
    assert(result.contactId === 'contact_a', 'contactId still surfaced for caller telemetry');
    assert(recorder.updates.length === 0, 'no UPDATE on already-unsubscribed');
    assert(recorder.inserts.length === 0, 'no system_alert on idempotent');
  });

  await test('STOP with fresh contact sets unsubscribed_at + writes system_alerts', async () => {
    const { supabase, recorder } = makeSupabaseStub({
      contact: { id: 'contact_b', unsubscribed_at: null },
    });
    const result = await applyAutoUnsubscribe(
      // @ts-expect-error stub
      supabase,
      'org_test',
      'jane@example.com',
      'STOP',
      99
    );
    assert(result.applied === true, 'should report applied=true');
    assert(result.contactId === 'contact_b', 'contactId mismatch');
    assert(recorder.updates.length === 1, 'expected exactly one UPDATE');
    const update = recorder.updates[0];
    assert(update.table === 'lead_contacts', 'wrong table');
    const payload = update.payload as { unsubscribed_at: string };
    assert(typeof payload.unsubscribed_at === 'string' && payload.unsubscribed_at.length > 0, 'unsubscribed_at not set');

    assert(recorder.inserts.length === 1, 'expected exactly one system_alerts INSERT');
    const alert = recorder.inserts[0].row as {
      org_id: string;
      alert_type: string;
      severity: string;
      details: { contact_id: string; message_id: number; from_email: string };
    };
    assert(alert.org_id === 'org_test', 'org_id missing');
    assert(alert.alert_type === 'auto_unsubscribe', 'alert_type wrong');
    assert(alert.severity === 'info', 'severity wrong');
    assert(alert.details.contact_id === 'contact_b', 'contact_id missing');
    assert(alert.details.message_id === 99, 'message_id missing');
    assert(alert.details.from_email === 'jane@example.com', 'from_email wrong');
  });

  await test('STOP with no matching contact short-circuits cleanly', async () => {
    const { supabase, recorder } = makeSupabaseStub({ contact: null });
    const result = await applyAutoUnsubscribe(
      // @ts-expect-error stub
      supabase,
      'org_test',
      'unknown@example.com',
      'STOP',
      7
    );
    assert(result.applied === false, 'no contact = no apply');
    assert(result.contactId === null, 'no contact resolves to null');
    assert(recorder.updates.length === 0, 'no UPDATE');
    assert(recorder.inserts.length === 0, 'no system_alert');
  });

  await test('STOP with empty from_email never queries', async () => {
    const { supabase, recorder } = makeSupabaseStub({
      contact: { id: 'contact_c', unsubscribed_at: null },
    });
    const result = await applyAutoUnsubscribe(
      // @ts-expect-error stub
      supabase,
      'org_test',
      '',
      'STOP',
      1
    );
    assert(result.applied === false, 'empty email must not apply');
    assert(recorder.contactSelectArgs.length === 0, 'should not query lead_contacts on empty email');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('All auto-unsubscribe tests passed.\n');
})();
