/**
 * V1a: outscraper-task-complete unit tests.
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
  filters: { query: 'senior care, Atlanta GA' },
};

console.log('\noutscraper-task-complete unit tests\n');

(async () => {
  await test('builds lead_contacts row with all expected fields', () => {
    const rows: OutscraperBusinessRow[] = [
      {
        name: 'Acme Senior Care',
        type: 'Assisted living facility',
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
      },
    ];
    const inserts = buildLeadContactInserts(taskCtx, rows, '2026-04-30T00:00:00Z');
    assert(inserts.length === 1, 'one insert');
    const row = inserts[0];
    assert(row.org_id === 'org_test', 'org_id scoped');
    assert(row.lead_list_id === 'list_uuid_123', 'lead_list_id set');
    assert(row.outscraper_task_id === 'task_xyz', 'outscraper_task_id set');
    assert(row.raw_payload !== null && typeof row.raw_payload === 'object', 'raw_payload is the original row');
    assert((row.raw_payload as Record<string, unknown>).name === 'Acme Senior Care', 'raw_payload preserves name');
    assert(row.business_name === 'Acme Senior Care', 'business_name mapped');
    assert(row.email === 'hi@acme.example', 'email mapped');
    assert(row.email_status === 'pending', 'email_status defaults pending (verification gates)');
    assert(row.scrape_source === 'outscraper', 'scrape_source set');
    assert(row.scrape_query === 'senior care, Atlanta GA', 'scrape_query carried from filters');
    assert(row.scraped_at === '2026-04-30T00:00:00Z', 'scraped_at uses provided nowIso');
    assert(row.country === 'US', 'country defaults');
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

  await test('truncates scrape_query to 500 chars', () => {
    const longQuery = 'x'.repeat(800);
    const inserts = buildLeadContactInserts(
      { ...taskCtx, filters: { query: longQuery } },
      [{ name: 'X' }]
    );
    assert(
      typeof inserts[0].scrape_query === 'string' &&
        (inserts[0].scrape_query as string).length === 500,
      'scrape_query truncated to 500'
    );
  });

  await test('uses null scrape_query when filters has no query', () => {
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
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
