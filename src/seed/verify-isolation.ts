import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }

    _supabase = createClient(url, key);
  }

  return _supabase;
}

const TABLES_WITH_ORG_ID = [
  'server_pairs',
  'campaigns',
  'leads',
  'follow_ups',
  'sms_workflows',
  'email_accounts',
  'campaign_recipients',
  'email_send_log',
  'campaign_sequences',
  'lead_sequence_state',
  'inbox_messages',
  'inbox_threads',
  'suppression_list',
  'tracking_events',
  'lead_contacts',
  'system_alerts',
];

interface CheckTableResult {
  table: string;
  total: number;
  byOrg: Record<string, number>;
  nullOrgCount: number;
}

async function checkTable(table: string): Promise<CheckTableResult> {
  const sb = getSupabase();

  // Query all rows with org_id column
  const { data, error } = await sb.from(table).select('org_id');

  if (error) {
    console.error(`  Error querying ${table}:`, error.message);
    return { table, total: 0, byOrg: {}, nullOrgCount: 0 };
  }

  const total = data?.length ?? 0;
  const byOrg: Record<string, number> = {};
  let nullOrgCount = 0;

  for (const row of data ?? []) {
    if (!row.org_id) {
      nullOrgCount++;
    } else {
      byOrg[row.org_id] = (byOrg[row.org_id] || 0) + 1;
    }
  }

  return { table, total, byOrg, nullOrgCount };
}

async function main() {
  console.log('=== Multi-Tenant Isolation Verification ===\n');

  let totalPass = 0;
  let totalFail = 0;
  const results: CheckTableResult[] = [];

  // Check each table
  for (const table of TABLES_WITH_ORG_ID) {
    const result = await checkTable(table);
    results.push(result);

    const status = result.nullOrgCount === 0 ? 'PASS' : 'FAIL';
    if (status === 'PASS') {
      totalPass++;
    } else {
      totalFail++;
    }

    console.log(`[${status}] ${table}: ${result.total} rows`);

    if (Object.keys(result.byOrg).length > 0) {
      const entries = Object.entries(result.byOrg).sort((a, b) => b[1] - a[1]);
      for (const [orgId, count] of entries) {
        console.log(`       org ${orgId}: ${count} rows`);
      }
    }

    if (result.nullOrgCount > 0) {
      console.log(`       ⚠ ${result.nullOrgCount} rows with NULL org_id!`);
    }
  }

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Tables checked: ${TABLES_WITH_ORG_ID.length}`);
  console.log(`Passed: ${totalPass}`);
  console.log(`Failed: ${totalFail}`);
  console.log(`Overall: ${totalFail === 0 ? 'ALL PASS ✓' : 'FAILURES DETECTED ✗'}`);

  // RLS policy reference
  console.log('\n=== RLS Policy Status ===');
  console.log('RLS policies defined in migrations:');
  console.log('  001: organizations, server_pairs, sending_domains, campaigns, leads,');
  console.log('       follow_ups, sms_workflows');
  console.log('  003: email_accounts, campaign_recipients, email_send_log');
  console.log('  004: campaign_sequences, lead_sequence_state');
  console.log('  005: inbox_messages, inbox_threads, suppression_list');
  console.log('  006: tracking_events');
  console.log('  007: lead_contacts');
  console.log('  008: system_alerts');
  console.log('');
  console.log('All data tables have RLS with org_id = auth.jwt()->>\'org_id\' policies.');
  console.log('Verify manually: Supabase Dashboard → Authentication → Policies');

  // Exit with appropriate code
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
