/**
 * Reoon mapping regression tests.
 * Run via: tsx src/lib/leads/__tests__/verification-service.test.ts
 *
 * Guards against the 2026-04-30 audit bug where mapReoonStatus() didn't
 * recognize Reoon's actual `status` values (safe / role_account / catch_all /
 * disabled / spamtrap / risky) and silently dropped them to 'unknown'.
 */

import { mapReoonStatus, verifyBatch } from '../verification-service';

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

console.log('\nReoon verification-service tests\n');

(async () => {
  // ── mapReoonStatus: canonical Reoon Power-mode status values ─────────────
  await test("'safe' → 'valid'", () => {
    assert(mapReoonStatus('safe') === 'valid', 'safe should map to valid');
  });
  await test("'Safe' (mixed case) → 'valid'", () => {
    assert(mapReoonStatus('Safe') === 'valid', 'case-insensitive');
  });
  await test("'invalid' → 'invalid'", () => {
    assert(mapReoonStatus('invalid') === 'invalid', '');
  });
  await test("'disabled' → 'invalid'", () => {
    assert(mapReoonStatus('disabled') === 'invalid', 'disabled mailboxes are invalid');
  });
  await test("'disposable' → 'invalid'", () => {
    assert(mapReoonStatus('disposable') === 'invalid', '');
  });
  await test("'spamtrap' → 'invalid'", () => {
    assert(mapReoonStatus('spamtrap') === 'invalid', 'spamtraps must be marked invalid');
  });
  await test("'role_account' → 'risky'", () => {
    assert(mapReoonStatus('role_account') === 'risky', 'live Reoon returns role_account, not role');
  });
  await test("'catch_all' → 'risky'", () => {
    assert(mapReoonStatus('catch_all') === 'risky', 'live Reoon returns catch_all, not accept_all');
  });
  await test("'risky' → 'risky'", () => {
    assert(mapReoonStatus('risky') === 'risky', '');
  });
  await test("'unknown' → 'unknown'", () => {
    assert(mapReoonStatus('unknown') === 'unknown', '');
  });
  await test("'timeout' → 'unknown'", () => {
    assert(mapReoonStatus('timeout') === 'unknown', '');
  });

  // ── Forward-compat aliases (Reoon may rename someday) ────────────────────
  await test("legacy 'valid' alias → 'valid'", () => {
    assert(mapReoonStatus('valid') === 'valid', 'forward-compat');
  });
  await test("legacy 'accept_all' alias → 'risky'", () => {
    assert(mapReoonStatus('accept_all') === 'risky', 'forward-compat');
  });
  await test("legacy 'role' alias → 'risky'", () => {
    assert(mapReoonStatus('role') === 'risky', 'forward-compat');
  });

  // ── Defensive defaults ───────────────────────────────────────────────────
  await test("unrecognized status → 'unknown'", () => {
    assert(mapReoonStatus('made_up_value') === 'unknown', 'default branch');
  });
  await test("empty string → 'unknown'", () => {
    assert(mapReoonStatus('') === 'unknown', '');
  });

  // ── verifyBatch end-to-end with stubbed fetch (≤50 single-call path) ─────
  await test('verifyBatch maps stubbed Reoon responses correctly', async () => {
    const realFetch = global.fetch;
    const responses: Record<string, string> = {
      'a@x.com': 'safe',
      'b@x.com': 'role_account',
      'c@x.com': 'catch_all',
      'd@x.com': 'invalid',
      'e@x.com': 'spamtrap',
    };
    global.fetch = (async (url: string) => {
      const m = url.match(/email=([^&]+)/);
      const email = decodeURIComponent(m![1]);
      const status = responses[email] || 'unknown';
      return new Response(JSON.stringify({ email, status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const out = await verifyBatch('test-key', Object.keys(responses));
      const map = new Map(out.map((r) => [r.email, r.email_status]));
      assert(map.get('a@x.com') === 'valid', `safe → expected valid, got ${map.get('a@x.com')}`);
      assert(map.get('b@x.com') === 'risky', `role_account → expected risky, got ${map.get('b@x.com')}`);
      assert(map.get('c@x.com') === 'risky', `catch_all → expected risky, got ${map.get('c@x.com')}`);
      assert(map.get('d@x.com') === 'invalid', `invalid → expected invalid, got ${map.get('d@x.com')}`);
      assert(map.get('e@x.com') === 'invalid', `spamtrap → expected invalid, got ${map.get('e@x.com')}`);
    } finally {
      global.fetch = realFetch;
    }
  });

  await test('verifyBatch returns empty array for empty input', async () => {
    const out = await verifyBatch('test-key', []);
    assert(Array.isArray(out) && out.length === 0, 'expected []');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
