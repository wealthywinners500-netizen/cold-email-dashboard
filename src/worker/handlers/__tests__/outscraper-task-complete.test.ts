/**
 * V8 (2026-04-30): outscraper-task-complete unit tests — rewritten for /tasks
 * API + contacts_n_leads enrichment.
 *
 * Tests the pure `buildLeadContactInserts` helper directly. No supabase, no
 * network. The handler entrypoint orchestrates supabase + fetch and is
 * exercised in production via the smoke-test plan in the deploy report.
 *
 * Run via: tsx src/worker/handlers/__tests__/outscraper-task-complete.test.ts
 */

import { buildLeadContactInserts } from '../outscraper-task-complete';
import type { OutscraperBusinessRow } from '../../../lib/outscraper/client';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
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

const taskCtx = {
  org_id: 'org_test',
  lead_list_id: 'list_uuid_123',
  outscraper_task_id: 'task_xyz',
  filters: { categories: ['dentist'], locations: ['30309'] },
};

console.log('\noutscraper-task-complete unit tests (V8)\n');

(async () => {
  await test('builds lead_contacts row from /tasks contacts_n_leads shape', () => {
    const rows: OutscraperBusinessRow[] = [
      {
        name: 'Dentistry for Midtown Atlanta',
        name_for_emails: 'Dentistry for Midtown Atlanta',
        category: 'Dentist',
        phone: '+14045551212',
        website: 'https://example.com',
        address: '229 Peachtree St NE, Atlanta, GA 30303',
        city: 'Atlanta',
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
      },
    ];
    const inserts = buildLeadContactInserts(taskCtx, rows, '2026-04-30T00:00:00Z');
    assert(inserts.length === 1, 'one insert');
    const row = inserts[0];
    assert(row.org_id === 'org_test', 'org_id scoped');
    assert(row.lead_list_id === 'list_uuid_123', 'lead_list_id set');
    assert(row.outscraper_task_id === 'task_xyz', 'outscraper_task_id set');
    assert(row.raw_payload !== null && typeof row.raw_payload === 'object', 'raw_payload is the original row');
    assert(
      (row.raw_payload as Record<string, unknown>).name === 'Dentistry for Midtown Atlanta',
      'raw_payload preserves name'
    );
    assert(row.business_name === 'Dentistry for Midtown Atlanta', 'business_name mapped');
    assert(row.email === 'beth@dentistryformidtown.com', 'email mapped from row.email');
    assert(row.first_name === 'Beth', 'first_name propagates from contact');
    assert(row.last_name === 'Butler', 'last_name propagates from contact');
    assert(row.email_status === 'pending', 'email_status defaults pending (verification gates)');
    assert(row.scrape_source === 'outscraper', 'scrape_source set');
    assert(row.address === '229 Peachtree St NE, Atlanta, GA 30303', 'address mapped from row.address');
    assert(row.state === 'GA', 'state prefers state_code');
    assert(row.scrape_query === 'dentist | 30309', 'scrape_query composed from categories+locations');
    assert(row.scraped_at === '2026-04-30T00:00:00Z', 'scraped_at uses provided nowIso');
    assert(row.country === 'US', 'country defaults');
  });

  await test('multiple rows for same place insert as separate contacts', () => {
    // Same place_id, different decision-maker emails — flat shape from /tasks
    const rows: OutscraperBusinessRow[] = [
      {
        name: 'Sage Dental of Midtown Atlanta',
        place_id: 'place_sage',
        email: 'sage704@msn.com',
        first_name: 'Sage',
        last_name: 'Pollack',
      },
      {
        name: 'Sage Dental of Midtown Atlanta',
        place_id: 'place_sage',
        email: 'mcafone@northwesternmanagement.com',
        first_name: 'Mary',
        last_name: 'Cafone',
      },
    ];
    const inserts = buildLeadContactInserts(taskCtx, rows);
    assert(inserts.length === 2, '2 rows → 2 inserts (UNIQUE(org_id,email) handles dedup)');
    assert(inserts[0].first_name === 'Sage', 'first contact');
    assert(inserts[1].first_name === 'Mary', 'second contact');
    assert(inserts[0].email !== inserts[1].email, 'different emails');
    assert(inserts[0].google_place_id === inserts[1].google_place_id, 'same place_id');
  });

  await test('skips rows with no name AND no email AND no phone', () => {
    const rows: OutscraperBusinessRow[] = [
      // Useless row
      { rating: 5, place_id: 'ChIJ_useless' },
      // Phone-only row — keep
      { phone: '555-555-1111', city: 'Atlanta' },
      // Name-only row — keep
      { name: 'Beta Living' },
    ];
    const inserts = buildLeadContactInserts(taskCtx, rows);
    assert(inserts.length === 2, `expected 2 kept, got ${inserts.length}`);
    assert(
      inserts.some((r) => r.phone === '555-555-1111'),
      'phone-only kept'
    );
    assert(
      inserts.some((r) => r.business_name === 'Beta Living'),
      'name-only kept'
    );
  });

  await test('handles empty input rows', () => {
    const inserts = buildLeadContactInserts(taskCtx, []);
    assert(inserts.length === 0, 'no inserts for no rows');
  });

  await test('legacy filters with `query` still produce scrape_query', () => {
    const inserts = buildLeadContactInserts(
      { ...taskCtx, filters: { query: 'dentist, Atlanta' } },
      [{ name: 'X', email: 'x@x.com' }]
    );
    assert(inserts[0].scrape_query === 'dentist, Atlanta', 'legacy query path');
  });

  await test('null scrape_query when filters has neither query nor categories', () => {
    const inserts = buildLeadContactInserts(
      { ...taskCtx, filters: {} },
      [{ name: 'No Query Co' }]
    );
    assert(inserts[0].scrape_query === null, 'null scrape_query when missing');
  });

  await test('phone-only row maps email to null without short-circuiting', () => {
    const inserts = buildLeadContactInserts(taskCtx, [
      { name: 'Phone Co', phone: '555-1234' },
    ]);
    assert(inserts.length === 1, 'phone-only kept');
    assert(inserts[0].email === null, 'email null on phone-only row');
    assert(inserts[0].business_name === 'Phone Co', 'name preserved');
    assert(inserts[0].first_name === null, 'first_name null when not provided');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
