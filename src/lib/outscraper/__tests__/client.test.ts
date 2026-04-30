/**
 * V1a: Outscraper async client tests.
 *
 * fetch is monkey-patched globally per-test. No real network.
 * Run via: tsx src/lib/outscraper/__tests__/client.test.ts
 */

import {
  submitMapsSearchTask,
  getTaskStatus,
  downloadResults,
  mapOutscraperRowToLeadContact,
} from '../client';
import type { OutscraperFilters } from '../../supabase/types';

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

const originalFetch = globalThis.fetch;
function withFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  globalThis.fetch = impl as typeof fetch;
}
function resetFetch() {
  globalThis.fetch = originalFetch;
}

const baseFilters: OutscraperFilters = {
  query: 'senior care, Atlanta GA',
  location: 'Atlanta GA',
  places_per_query: 200,
  websites_only: true,
  operational_only: true,
  language: 'en',
  max_per_query: 0,
  enrichment: ['emails_and_contacts'],
};

console.log('\noutscraper async client tests\n');

(async () => {
  await test('submitMapsSearchTask sets X-API-KEY + async=true + query in URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    withFetch(async (input, init) => {
      capturedUrl = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      capturedHeaders = headers;
      return new Response(JSON.stringify({ id: 'task_xyz', status: 'Pending' }), {
        status: 200,
      });
    });
    try {
      const result = await submitMapsSearchTask('test-key-123', baseFilters);
      assert(result.outscraperTaskId === 'task_xyz', 'task id passed through');
      assert(capturedUrl.startsWith('https://api.app.outscraper.com/maps/search-v3?'), 'URL prefix');
      assert(capturedUrl.includes('async=true'), 'async=true present');
      // URLSearchParams encodes space as '+' (form-urlencoded), comma as %2C.
      assert(
        capturedUrl.includes('senior+care%2C+Atlanta+GA'),
        `query encoded: ${capturedUrl}`
      );
      assert(capturedUrl.includes('limit=200'), 'limit reflects places_per_query');
      assert(capturedUrl.includes('language=en'), 'language passed');
      assert(capturedUrl.includes('enrichment=emails_and_contacts'), 'enrichment passed');
      assert(capturedUrl.includes('skipPlacesWithoutWebsite=true'), 'websites_only flag');
      assert(capturedHeaders['X-API-KEY'] === 'test-key-123', 'X-API-KEY header set');
    } finally {
      resetFetch();
    }
  });

  await test('submitMapsSearchTask throws if no api key', async () => {
    let threw = false;
    try {
      await submitMapsSearchTask('', baseFilters);
    } catch {
      threw = true;
    }
    assert(threw, 'expected throw on empty key');
  });

  await test('submitMapsSearchTask throws on non-2xx response', async () => {
    withFetch(async () => new Response('rate limited', { status: 429 }));
    let threw = false;
    try {
      await submitMapsSearchTask('k', baseFilters);
    } catch {
      threw = true;
    }
    resetFetch();
    assert(threw, 'expected throw on 429');
  });

  await test('getTaskStatus returns pending for HTTP 202', async () => {
    withFetch(async () => new Response('', { status: 202 }));
    const r = await getTaskStatus('k', 'task_abc');
    resetFetch();
    assert(r.kind === 'pending', `expected pending, got ${r.kind}`);
  });

  await test('getTaskStatus returns success with results_location on Success', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 'task_abc',
            status: 'Success',
            results_location: 'https://results.outscraper.com/abc.json',
          }),
          { status: 200 }
        )
    );
    const r = await getTaskStatus('k', 'task_abc');
    resetFetch();
    assert(r.kind === 'success', `expected success, got ${r.kind}`);
    if (r.kind === 'success') {
      assert(
        r.resultsLocation === 'https://results.outscraper.com/abc.json',
        'results_location passed through'
      );
    }
  });

  await test('getTaskStatus returns error on Outscraper failure status', async () => {
    withFetch(
      async () =>
        new Response(JSON.stringify({ id: 't', status: 'Error' }), { status: 200 })
    );
    const r = await getTaskStatus('k', 't');
    resetFetch();
    assert(r.kind === 'error', `expected error, got ${r.kind}`);
  });

  await test('downloadResults flattens nested data arrays', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              [
                { name: 'Acme Senior Care', emails_and_contacts: { emails: ['hi@acme.com'] } },
                { name: 'Beta Living', phone: '555-555-1212' },
              ],
            ],
          }),
          { status: 200 }
        )
    );
    const rows = await downloadResults(
      'k',
      'https://results.example/r.json',
      'task_abc'
    );
    resetFetch();
    assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
    assert(rows[0].name === 'Acme Senior Care', 'first row mapped');
  });

  await test('mapOutscraperRowToLeadContact extracts canonical fields', () => {
    const row = {
      name: 'Acme Senior Care',
      type: 'Assisted living facility',
      subtypes: ['Senior care', 'Health'],
      phone: '+14045551212',
      site: 'https://acme.example',
      city: 'Atlanta',
      state: 'GA',
      postal_code: '30301',
      country_code: 'US',
      rating: 4.6,
      reviews: 88,
      place_id: 'ChIJ12345',
      emails_and_contacts: { emails: ['hi@acme.example'] },
    };
    const m = mapOutscraperRowToLeadContact(row);
    assert(m.business_name === 'Acme Senior Care', 'business_name from name');
    assert(m.business_type === 'Assisted living facility', 'business_type from type');
    assert(m.email === 'hi@acme.example', 'email from emails_and_contacts');
    assert(m.phone === '+14045551212', 'phone passed');
    assert(m.website === 'https://acme.example', 'website from site');
    assert(m.city === 'Atlanta', 'city');
    assert(m.zip === '30301', 'zip from postal_code');
    assert(m.country === 'US', 'country');
    assert(m.google_rating === 4.6, 'rating');
    assert(m.google_place_id === 'ChIJ12345', 'place_id');
  });

  await test('mapOutscraperRowToLeadContact handles missing fields', () => {
    const m = mapOutscraperRowToLeadContact({});
    assert(m.business_name === null, 'null name');
    assert(m.email === null, 'null email');
    assert(m.country === 'US', 'default country US');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
