/**
 * V8 (2026-04-30): one-shot trigger for the `verify-new-leads` pg-boss queue.
 *
 * Usage on the worker host:
 *   set -a; . /opt/dashboard-worker/.env; set +a
 *   tsx scripts/trigger-reoon-verify-list.ts <orgId> [leadListId]
 *
 * The handler (src/worker/handlers/verify-new-leads.ts) does the full Reoon
 * batch + DB updates. This script just enqueues the job and exits — the
 * already-running dashboard-worker systemd service picks it up.
 *
 * Omitting <leadListId> falls back to all `email_status='pending'` rows for
 * the org. Pass a list UUID to scope a single list (preferred when re-smoking
 * a freshly scraped list).
 */

import { initBoss } from '../src/lib/email/campaign-queue';

async function main() {
  const orgId = process.argv[2];
  const leadListId = process.argv[3];

  if (!orgId) {
    console.error('Usage: tsx scripts/trigger-reoon-verify-list.ts <orgId> [leadListId]');
    process.exit(1);
  }

  const boss = await initBoss();
  const jobId = await boss.send('verify-new-leads', {
    orgId,
    lead_list_id: leadListId || undefined,
  });

  console.log(
    `[trigger-reoon-verify-list] enqueued verify-new-leads job ${jobId} for org=${orgId} list=${leadListId || '<all-pending>'}`
  );

  await boss.stop({ graceful: false, close: true });
}

main().catch((err) => {
  console.error('[trigger-reoon-verify-list] fatal:', err);
  process.exit(1);
});
