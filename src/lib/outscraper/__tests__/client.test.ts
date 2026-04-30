/**
 * V8 (2026-04-30): Outscraper async client tests — rewritten for /tasks API +
 * contacts_n_leads enrichment.
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
  categories: ['dentist'],
  locations: ['30309'],
  use_zip_codes: true,
  ignore_without_emails: true,
  drop_email_duplicates: true,
  organizations_per_query_limit: 200,
  limit: 0,
  preferred_contacts: ['decision makers', 'operations', 'marketing', 'sales'],
  language: 'en',
  region: 'US',
  vertical: 'dentist',
};

console.log('\noutscraper /tasks client tests (V8)\n');

(async () => {
  await test('submitMapsSearchTask POSTs JSON body to api.outscraper.cloud/tasks', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    withFetch(async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || '';
      capturedHeaders = (init?.headers || {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          id: 'opaque_task_id_xyz',
          ui_task_id: '20260430000000s00',
          is_first_task: false,
        }),
        { status: 200 }
      );
    });
    try {
      const result = await submitMapsSearchTask('test-key-123', baseFilters);
      assert(result.outscraperTaskId === 'opaque_task_id_xyz', 'task id passed through');
      assert(result.uiTaskId === '20260430000000s00', 'ui_task_id passed through');
      assert(capturedUrl === 'https://api.outscraper.cloud/tasks', `host/path: ${capturedUrl}`);
      assert(capturedMethod === 'POST', `method: ${capturedMethod}`);
      assert(capturedHeaders['X-API-KEY'] === 'test-key-123', 'X-API-KEY header set');
      assert(
        capturedHeaders['Content-Type'] === 'application/json',
        'Content-Type JSON'
      );
      assert(
        capturedBody.service_name === 'google_maps_service_v2',
        `service_name: ${capturedBody.service_name}`
      );
      const enrichments = capturedBody.enrichments as string[];
      assert(
        Array.isArray(enrichments) && enrichments[0] === 'contacts_n_leads',
        `enrichments=${JSON.stringify(enrichments)}`
      );
      const kwargs = capturedBody.enrichments_kwargs as {
        contacts_n_leads: { preferred_contacts: string[] };
      };
      const pc = kwargs.contacts_n_leads.preferred_contacts;
      assert(pc.length === 4, `preferred_contacts length 4 (no finance), got ${pc.length}`);
      assert(!pc.includes('finance'), 'finance dropped');
      assert(pc.includes('decision makers'), 'decision makers present');
      assert(pc.includes('operations'), 'operations present');
      assert(pc.includes('marketing'), 'marketing present');
      assert(pc.includes('sales'), 'sales present');
      assert(capturedBody.useZipCodes === true, 'useZipCodes=true');
      assert(capturedBody.ignoreWithoutEmails === true, 'ignoreWithoutEmails=true');
      assert(capturedBody.dropEmailDuplicates === true, 'dropEmailDuplicates=true');
      const filters = capturedBody.filters as Array<Record<string, unknown>>;
      assert(Array.isArray(filters) && filters.length === 2, `2 structured filters, got ${filters.length}`);
      assert(filters[0].operator === 'is not blank', 'website is-not-blank filter');
      assert(filters[1].key === 'business_status', 'business_status filter');
      assert(
        Array.isArray(capturedBody.categories) &&
          (capturedBody.categories as string[])[0] === 'dentist',
        'categories[]'
      );
      assert(
        Array.isArray(capturedBody.locations) &&
          (capturedBody.locations as string[])[0] === '30309',
        'locations[]'
      );
      assert(capturedBody.organizationsPerQueryLimit === 200, 'organizationsPerQueryLimit');
      assert(capturedBody.limit === 0, 'limit=0 (HL #25)');
    } finally {
      resetFetch();
    }
  });

  await test('submitMapsSearchTask uses caller-provided preferred_contacts when set', async () => {
    let body: Record<string, unknown> = {};
    withFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 'tid' }), { status: 200 });
    });
    await submitMapsSearchTask('k', { ...baseFilters, preferred_contacts: ['operations'] });
    resetFetch();
    const pc = (body.enrichments_kwargs as {
      contacts_n_leads: { preferred_contacts: string[] };
    }).contacts_n_leads.preferred_contacts;
    assert(pc.length === 1 && pc[0] === 'operations', `single preferred contact: ${pc}`);
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

  await test('submitMapsSearchTask throws on empty categories or locations', async () => {
    let threw1 = false;
    try {
      await submitMapsSearchTask('k', { ...baseFilters, categories: [] });
    } catch {
      threw1 = true;
    }
    assert(threw1, 'empty categories should throw');
    let threw2 = false;
    try {
      await submitMapsSearchTask('k', { ...baseFilters, locations: [] });
    } catch {
      threw2 = true;
    }
    assert(threw2, 'empty locations should throw');
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

  await test('getTaskStatus returns success with inline sentinel when results_location is null', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: '20260430225755s72',
            status: 'Success',
            results_location: null,
            data: [{ name: 'Acme', email: 'hi@acme.example' }],
          }),
          { status: 200 }
        )
    );
    const r = await getTaskStatus('k', 'opaque_task_id');
    resetFetch();
    assert(r.kind === 'success', `expected success, got ${r.kind}`);
    if (r.kind === 'success') {
      assert(
        r.resultsLocation === 'inline:opaque_task_id',
        `expected inline sentinel, got ${r.resultsLocation}`
      );
    }
  });

  await test('getTaskStatus returns success with results_location when URL provided', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 't',
            status: 'Success',
            results_location: 'https://results.outscraper.com/abc.json',
          }),
          { status: 200 }
        )
    );
    const r = await getTaskStatus('k', 't');
    resetFetch();
    assert(r.kind === 'success' && r.resultsLocation.startsWith('https://'), 'URL passed through');
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

  await test('downloadResults reads inline data from /requests/<id>', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({
            id: 't',
            status: 'Success',
            data: [
              { name: 'Acme', email: 'hi@acme.example', first_name: 'Jane', last_name: 'Doe' },
              { name: 'Beta', email: 'b@beta.example' },
            ],
          }),
          { status: 200 }
        )
    );
    const rows = await downloadResults('k', 'inline:t', 't');
    resetFetch();
    assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
    assert(rows[0].name === 'Acme', 'first row mapped');
    assert(rows[0].first_name === 'Jane', 'first_name passed through');
  });

  await test('downloadResults still flattens legacy nested-array shape', async () => {
    withFetch(
      async () =>
        new Response(
          JSON.stringify({ data: [[{ name: 'X', email: 'x@x.com' }, { name: 'Y' }]] }),
          { status: 200 }
        )
    );
    const rows = await downloadResults('k', 'inline:t', 't');
    resetFetch();
    assert(rows.length === 2, 'nested-array fallback still works');
  });

  await test('mapOutscraperRowToLeadContact extracts contact-level fields from /tasks shape', () => {
    const row = {
      name: 'Dentistry for Midtown Atlanta',
      name_for_emails: 'Dentistry for Midtown Atlanta',
      category: 'Dentist',
      subtypes: 'Dental clinic, Cosmetic dentist',
      phone: '+14045551212',
      website: 'https://example.com',
      domain: 'example.com',
      address: '229 Peachtree St NE Suite 200, Atlanta, GA 30303',
      city: 'Atlanta',
      state: 'Georgia',
      state_code: 'GA',
      postal_code: '30303',
      country_code: 'US',
      rating: 4.8,
      reviews: 121,
      place_id: 'ChIJ12345',
      email: 'beth@dentistryformidtown.com',
      first_name: 'Beth',
      last_name: 'Butler',
      full_name: 'Beth Butler',
    };
    const m = mapOutscraperRowToLeadContact(row);
    assert(m.business_name === 'Dentistry for Midtown Atlanta', 'business_name from name_for_emails');
    assert(m.business_type === 'Dentist', 'business_type from category');
    assert(m.email === 'beth@dentistryformidtown.com', 'email from row.email (not emails_and_contacts)');
    assert(m.first_name === 'Beth', 'first_name extracted');
    assert(m.last_name === 'Butler', 'last_name extracted');
    assert(m.position === null, 'position null (no clean field in /tasks shape)');
    assert(m.phone === '+14045551212', 'phone passed');
    assert(m.website === 'https://example.com', 'website from row.website');
    assert(m.full_address === '229 Peachtree St NE Suite 200, Atlanta, GA 30303', 'address from row.address');
    assert(m.city === 'Atlanta', 'city');
    assert(m.state === 'GA', 'state prefers state_code');
    assert(m.zip === '30303', 'zip from postal_code');
    assert(m.country === 'US', 'country from country_code');
    assert(m.google_rating === 4.8, 'rating');
    assert(m.google_place_id === 'ChIJ12345', 'place_id');
  });

  await test('mapOutscraperRowToLeadContact null email when row.email empty', () => {
    const m = mapOutscraperRowToLeadContact({ name: 'Empty', email: '' });
    assert(m.email === null, 'empty string → null');
  });

  await test('mapOutscraperRowToLeadContact prefers row-level over null first_name', () => {
    const m = mapOutscraperRowToLeadContact({
      name: 'X',
      email: 'x@x.com',
      first_name: null,
      last_name: undefined,
    });
    assert(m.first_name === null, 'null first_name preserved');
    assert(m.last_name === null, 'undefined last_name → null');
  });

  await test('mapOutscraperRowToLeadContact falls back to row.name when name_for_emails missing', () => {
    const m = mapOutscraperRowToLeadContact({ name: 'Fallback Co' });
    assert(m.business_name === 'Fallback Co', 'name fallback works');
  });

  await test('mapOutscraperRowToLeadContact handles missing fields', () => {
    const m = mapOutscraperRowToLeadContact({});
    assert(m.business_name === null, 'null name');
    assert(m.email === null, 'null email');
    assert(m.first_name === null, 'null first_name');
    assert(m.country === 'US', 'default country US');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
