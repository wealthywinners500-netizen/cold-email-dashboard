/**
 * V1+a system_alerts window check.
 *
 * Counts new system_alerts rows since a cutoff timestamp, broken down by
 * alert_type. Used by the V1+a deploy report §5.
 *
 * Usage:
 *   set -a; . /opt/dashboard-worker/.env; set +a
 *   npx tsx scripts/v1a-system-alerts.ts <iso-cutoff-timestamp>
 *
 * Example:
 *   npx tsx scripts/v1a-system-alerts.ts 2026-04-30T15:50:00Z
 */

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function main() {
  const cutoff = process.argv[2];
  if (!cutoff) {
    console.error('Usage: tsx scripts/v1a-system-alerts.ts <iso-timestamp>');
    process.exit(1);
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('system_alerts')
    .select('alert_type, severity, title, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('FAIL:', error.message);
    process.exit(1);
  }

  console.log(`system_alerts since ${cutoff}: ${data?.length ?? 0} rows`);

  const byType: Record<string, number> = {};
  for (const r of data || []) {
    const k = String(r.alert_type ?? '(null)');
    byType[k] = (byType[k] ?? 0) + 1;
  }
  console.log('breakdown by alert_type:');
  for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }

  // Spotlight: classifier_error rows
  const classifierErrors = (data || []).filter((r) => r.alert_type === 'classifier_error');
  if (classifierErrors.length) {
    console.log(`\nclassifier_error rows (${classifierErrors.length}):`);
    for (const r of classifierErrors) {
      console.log(`  [${r.created_at}] ${r.severity} :: ${r.title}`);
    }
  } else {
    console.log('\nclassifier_error rows: 0 ✓');
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
