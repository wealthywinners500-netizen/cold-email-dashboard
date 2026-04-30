/**
 * V1+b: contact-lookup helper tests.
 *
 * Pure logic + a tiny mock for the supabase chain shape. No network.
 * Run via: tsx src/lib/email/__tests__/contact-lookup.test.ts
 */

import { normalizeEmail, resolveLeadContactForEmail } from '../contact-lookup';

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

// Minimal mock that records the chain calls and returns a fixed shape.
function makeSupabaseStub(returned: unknown) {
  const chain: Record<string, unknown> = {};
  const recorder = {
    calls: [] as Array<{ method: string; args: unknown[] }>,
  };
  const handler: ProxyHandler<typeof chain> = {
    get(_t, prop: string) {
      if (prop === 'maybeSingle') {
        return async () => returned;
      }
      return (...args: unknown[]) => {
        recorder.calls.push({ method: prop, args });
        return new Proxy(chain, handler);
      };
    },
  };
  const supabase = new Proxy(chain, handler);
  return { supabase, recorder };
}

console.log('\ncontact-lookup helper tests\n');

(async () => {
  await test('normalizeEmail trims and lowercases', () => {
    assert(normalizeEmail('  Foo@Bar.COM  ') === 'foo@bar.com', 'mismatch');
    assert(normalizeEmail('foo@bar.com') === 'foo@bar.com', 'mismatch');
  });

  await test('normalizeEmail returns empty string for null/undefined/empty', () => {
    assert(normalizeEmail(null) === '', 'null');
    assert(normalizeEmail(undefined) === '', 'undefined');
    assert(normalizeEmail('') === '', 'empty');
    assert(normalizeEmail('   ') === '', 'whitespace');
  });

  await test('resolveLeadContactForEmail short-circuits null result', async () => {
    const { supabase, recorder } = makeSupabaseStub({ data: null });
    const result = await resolveLeadContactForEmail(
      // @ts-expect-error Proxy stand-in for SupabaseClient
      supabase,
      'org_test',
      ''
    );
    assert(result === null, 'expected null on empty email');
    assert(recorder.calls.length === 0, 'should not query supabase for empty email');
  });

  await test('resolveLeadContactForEmail returns row data on hit', async () => {
    const fixture = {
      id: 'contact_uuid_42',
      unsubscribed_at: null,
    };
    const { supabase, recorder } = makeSupabaseStub({ data: fixture });
    const result = await resolveLeadContactForEmail(
      // @ts-expect-error Proxy stand-in
      supabase,
      'org_test',
      '  John.Doe@Example.com  '
    );
    assert(result?.id === 'contact_uuid_42', 'wrong id returned');
    assert(result?.unsubscribed_at === null, 'unsubscribed_at not threaded');

    // Verify the chain saw a normalized email at the .ilike() step.
    const ilikeCall = recorder.calls.find((c) => c.method === 'ilike');
    assert(!!ilikeCall, 'expected an ilike() invocation');
    assert(ilikeCall!.args[1] === 'john.doe@example.com', 'ilike not normalized');

    // Verify org scoping was applied.
    const eqCall = recorder.calls.find(
      (c) => c.method === 'eq' && c.args[0] === 'org_id'
    );
    assert(!!eqCall, 'expected eq("org_id", ...)');
    assert(eqCall!.args[1] === 'org_test', 'wrong org id passed');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log('All contact-lookup tests passed.\n');
})();
