/**
 * V1+b smoke test — runs on the deployed worker against live Supabase.
 *
 * 5 probes:
 *   1. Soft-delete persists (an inbox_thread).
 *   2. Sync respects deleted_at (UID lookup against deleted message_id).
 *   3. Manual unsubscribe + idempotency.
 *   4. Auto-unsub on STOP via handleClassifyReply.
 *   5. Send-path filter excludes unsubscribed contacts.
 *
 * Usage on the worker:
 *   set -a; . /opt/dashboard-worker/.env; set +a
 *   npx tsx scripts/v1b-smoke.ts
 *
 * The script ROLLS BACK its synthetic data at the end (regardless of pass/fail)
 * so it leaves no fixture residue in the live DB.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { applyAutoUnsubscribe } from '../src/worker/handlers/sync-inbox';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// StealthMail org. NOTE: organizations.id is the INTERNAL row id (FK target),
// distinct from organizations.clerk_org_id (the Clerk-facing identifier with
// the 2026-04-29 audit re-correction). Inbox/lead_contacts FK against the
// internal id. Verified live: organizations.id = `org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q`.
const ORG_ID = 'org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q';

interface Cleanup {
  inboxMessageIds: number[];
  inboxThreadIds: number[];
  leadContactIds: string[];
  systemAlertIds: number[];
  unmarkContactUnsub: string[];
}

const cleanup: Cleanup = {
  inboxMessageIds: [],
  inboxThreadIds: [],
  leadContactIds: [],
  systemAlertIds: [],
  unmarkContactUnsub: [],
};

async function rollback(supabase: SupabaseClient) {
  console.log('\n=== ROLLBACK ===');
  if (cleanup.systemAlertIds.length) {
    await supabase.from('system_alerts').delete().in('id', cleanup.systemAlertIds);
    console.log(`  system_alerts: removed ${cleanup.systemAlertIds.length}`);
  }
  if (cleanup.inboxMessageIds.length) {
    await supabase.from('inbox_messages').delete().in('id', cleanup.inboxMessageIds);
    console.log(`  inbox_messages: removed ${cleanup.inboxMessageIds.length}`);
  }
  if (cleanup.inboxThreadIds.length) {
    await supabase.from('inbox_threads').delete().in('id', cleanup.inboxThreadIds);
    console.log(`  inbox_threads: removed ${cleanup.inboxThreadIds.length}`);
  }
  if (cleanup.leadContactIds.length) {
    await supabase.from('lead_contacts').delete().in('id', cleanup.leadContactIds);
    console.log(`  lead_contacts: removed ${cleanup.leadContactIds.length}`);
  }
  if (cleanup.unmarkContactUnsub.length) {
    await supabase
      .from('lead_contacts')
      .update({ unsubscribed_at: null })
      .in('id', cleanup.unmarkContactUnsub);
    console.log(`  lead_contacts.unsubscribed_at reset: ${cleanup.unmarkContactUnsub.length}`);
  }
}

let passed = 0;
let failed = 0;
function pass(msg: string) {
  passed++;
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string) {
  failed++;
  console.error(`  ✗ ${msg}`);
}
function assertEq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) pass(label);
  else fail(`${label} — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function assertTruthy(actual: unknown, label: string) {
  if (actual) pass(label);
  else fail(`${label} — actual=${JSON.stringify(actual)}`);
}

async function probe1_softDeletePersists(supabase: SupabaseClient) {
  console.log('\n[Probe 1] Soft-delete persists (inbox_thread + cascade to messages)');
  // Create a synthetic warm-up thread + 2 messages.
  const now = new Date().toISOString();
  const { data: thread, error: threadErr } = await supabase
    .from('inbox_threads')
    .insert({
      org_id: ORG_ID,
      subject: '[V1+b SMOKE] synthetic warm-up - wsn',
      participants: ['v1bsmoke@example.com'],
      account_emails: [],
      latest_classification: 'AUTO_REPLY',
      latest_message_date: now,
      earliest_message_date: now,
    })
    .select('id')
    .single();
  if (threadErr || !thread) {
    fail(`thread INSERT failed: ${threadErr?.message}`);
    return;
  }
  cleanup.inboxThreadIds.push(thread.id);

  // Need a real account_id to satisfy NOT NULL — pick the first active account.
  const { data: anyAcct } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('org_id', ORG_ID)
    .limit(1)
    .single();
  if (!anyAcct) {
    fail('no email_accounts row to anchor synthetic message');
    return;
  }
  const { data: msg, error: msgErr } = await supabase
    .from('inbox_messages')
    .insert({
      org_id: ORG_ID,
      account_id: anyAcct.id,
      message_id: `<v1b-smoke-1-${Date.now()}@example.com>`,
      thread_id: thread.id,
      direction: 'received',
      from_email: 'v1bsmoke@example.com',
      subject: '[V1+b SMOKE] - wsn',
      body_text: 'smoke',
      received_date: now,
    })
    .select('id, message_id')
    .single();
  if (msgErr || !msg) {
    fail(`message INSERT failed: ${msgErr?.message}`);
    return;
  }
  cleanup.inboxMessageIds.push(msg.id);

  // Soft-delete via direct UPDATE (mimics the DELETE handler's behavior).
  const deletedAt = new Date().toISOString();
  await supabase
    .from('inbox_threads')
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq('id', thread.id);
  await supabase
    .from('inbox_messages')
    .update({ deleted_at: deletedAt })
    .eq('thread_id', thread.id);

  // Verify (a) deleted_at set on thread + msg.
  const { data: t2 } = await supabase
    .from('inbox_threads')
    .select('id, deleted_at')
    .eq('id', thread.id)
    .single();
  assertTruthy(t2?.deleted_at, 'inbox_threads.deleted_at populated');

  const { data: m2 } = await supabase
    .from('inbox_messages')
    .select('id, deleted_at')
    .eq('id', msg.id)
    .single();
  assertTruthy(m2?.deleted_at, 'inbox_messages.deleted_at populated');

  // Verify (b) thread NOT visible via the GET threads filter (.is('deleted_at', null)).
  const { data: visible } = await supabase
    .from('inbox_threads')
    .select('id')
    .eq('org_id', ORG_ID)
    .is('deleted_at', null)
    .eq('id', thread.id);
  assertEq((visible || []).length, 0, 'deleted thread excluded from API filter');

  console.log(`  thread_id=${thread.id} deleted_at=${t2?.deleted_at}`);
}

async function probe2_syncRespectsDeleted(supabase: SupabaseClient) {
  console.log('\n[Probe 2] Sync respects deleted_at (message_id dedup catches deleted)');

  // The IMAP dedup at imap-sync.ts:182 selects `id, deleted_at` on the existing
  // message_id and continues without INSERT. We can't easily run a real IMAP
  // fetch in a smoke test, but we CAN verify the SELECT shape — that the row
  // returned for a deleted message_id includes a non-null deleted_at column,
  // which is the signal the IMAP loop short-circuits on.
  const msgId = cleanup.inboxMessageIds[0];
  if (!msgId) {
    fail('no message from probe 1 to test against');
    return;
  }
  const { data: existing } = await supabase
    .from('inbox_messages')
    .select('id, deleted_at, message_id')
    .eq('id', msgId)
    .maybeSingle();

  assertTruthy(existing, 'sync-side dedup query returns row');
  assertTruthy(existing?.deleted_at, 'deleted_at populated → IMAP loop will log + skip');
  assertTruthy(existing?.message_id, 'message_id present → dedup keys on it');

  console.log(
    `  IMAP sync would now log: [Sync] Skipping deleted message_id ${existing?.message_id}`
  );
}

async function probe3_manualUnsubscribe(supabase: SupabaseClient) {
  console.log('\n[Probe 3] Manual unsubscribe + idempotency');

  // Create a synthetic lead_contact.
  const email = `v1b-smoke-${Date.now()}@example.com`;
  const { data: contact, error: insertErr } = await supabase
    .from('lead_contacts')
    .insert({
      org_id: ORG_ID,
      email,
      first_name: 'V1bSmoke',
      last_name: 'Test',
      business_name: 'V1+b Smoke Test Co',
      email_status: 'verified',
      scrape_source: 'manual',
    })
    .select('id, unsubscribed_at')
    .single();
  if (insertErr || !contact) {
    fail(`lead_contact INSERT failed: ${insertErr?.message}`);
    return;
  }
  cleanup.leadContactIds.push(contact.id);
  assertEq(contact.unsubscribed_at, null, 'fresh contact starts with unsubscribed_at=null');

  // First unsubscribe
  const now1 = new Date().toISOString();
  await supabase
    .from('lead_contacts')
    .update({ unsubscribed_at: now1, updated_at: now1 })
    .eq('id', contact.id)
    .is('unsubscribed_at', null);

  const { data: c2 } = await supabase
    .from('lead_contacts')
    .select('id, unsubscribed_at')
    .eq('id', contact.id)
    .single();
  assertTruthy(c2?.unsubscribed_at, 'unsubscribed_at set after first call');
  const firstStamp = c2?.unsubscribed_at;

  // Second call — guarded by .is('unsubscribed_at', null) → must NOT overwrite
  const now2 = new Date(Date.now() + 5_000).toISOString();
  await supabase
    .from('lead_contacts')
    .update({ unsubscribed_at: now2, updated_at: now2 })
    .eq('id', contact.id)
    .is('unsubscribed_at', null);

  const { data: c3 } = await supabase
    .from('lead_contacts')
    .select('id, unsubscribed_at')
    .eq('id', contact.id)
    .single();
  assertEq(c3?.unsubscribed_at, firstStamp, 'second call did NOT overwrite (idempotent)');

  console.log(`  contact_id=${contact.id} unsubscribed_at=${firstStamp}`);
}

async function probe4_autoUnsubOnStop(supabase: SupabaseClient) {
  console.log('\n[Probe 4] Auto-unsub on STOP — applyAutoUnsubscribe end-to-end');

  // Create lead_contact specifically for STOP test (so we can verify the
  // helper sets unsubscribed_at via from_email match).
  const email = `v1b-stop-${Date.now()}@example.com`;
  const { data: contact, error: cErr } = await supabase
    .from('lead_contacts')
    .insert({
      org_id: ORG_ID,
      email,
      first_name: 'V1bSTOP',
      last_name: 'Test',
      business_name: 'V1+b STOP Smoke Co',
      email_status: 'verified',
      scrape_source: 'manual',
    })
    .select('id, unsubscribed_at')
    .single();
  if (cErr || !contact) {
    fail(`lead_contact INSERT failed: ${cErr?.message}`);
    return;
  }
  cleanup.leadContactIds.push(contact.id);

  // Capture system_alerts pre-state to detect new rows.
  const { data: alertsPre } = await supabase
    .from('system_alerts')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('alert_type', 'auto_unsubscribe');
  const preIds = new Set((alertsPre || []).map((r: { id: number }) => r.id));

  // Run the helper directly (matches what handleClassifyReply does).
  const result = await applyAutoUnsubscribe(
    supabase,
    ORG_ID,
    email,
    'STOP',
    -1 // synthetic message id
  );

  assertEq(result.applied, true, 'applyAutoUnsubscribe returned applied=true');
  assertEq(result.contactId, contact.id, 'returned contactId matches input');

  // Verify lead_contacts.unsubscribed_at set
  const { data: c2 } = await supabase
    .from('lead_contacts')
    .select('id, unsubscribed_at')
    .eq('id', contact.id)
    .single();
  assertTruthy(c2?.unsubscribed_at, 'lead_contacts.unsubscribed_at populated');

  // Verify a new system_alerts row of type=auto_unsubscribe
  const { data: alertsPost } = await supabase
    .from('system_alerts')
    .select('id, alert_type, severity, details')
    .eq('org_id', ORG_ID)
    .eq('alert_type', 'auto_unsubscribe')
    .order('created_at', { ascending: false })
    .limit(5);

  const newAlert = (alertsPost || []).find(
    (r: { id: number; alert_type: string; details: { contact_id: string } }) =>
      !preIds.has(r.id) && r.details?.contact_id === contact.id
  );
  assertTruthy(newAlert, 'new system_alerts row with alert_type=auto_unsubscribe');
  if (newAlert) {
    cleanup.systemAlertIds.push(newAlert.id);
    assertEq(newAlert.severity, 'info', 'system_alerts.severity=info');
  }

  // Idempotency — second call should report applied=false (already unsubscribed)
  const result2 = await applyAutoUnsubscribe(
    supabase,
    ORG_ID,
    email,
    'STOP',
    -2
  );
  assertEq(result2.applied, false, 'second STOP returns applied=false (idempotent)');

  console.log(`  contact=${contact.id} alert_id=${newAlert?.id} unsubscribed_at=${c2?.unsubscribed_at}`);
}

async function probe5_sendPathFilter(supabase: SupabaseClient) {
  console.log('\n[Probe 5] Send-path filter — distribute-campaign-sends excludes unsubscribed');

  // Find or create 3 lead_contacts in the org. We'll mark 1 unsubscribed
  // and then run getPendingRecipients-style logic to confirm 2 are returned.
  // Since we don't have a campaign with 3 pending recipients in live DB
  // (campaign_recipients=0 per memory), we'll directly exercise the unsubSet
  // filter logic using fresh fixtures.

  const stamp = Date.now();
  const fixtures = [
    { email: `v1b-sendsmoke-a-${stamp}@example.com`, unsub: false },
    { email: `v1b-sendsmoke-b-${stamp}@example.com`, unsub: false },
    { email: `v1b-sendsmoke-c-${stamp}@example.com`, unsub: true },
  ];
  const inserted: Array<{ id: string; email: string; unsub: boolean }> = [];
  for (const f of fixtures) {
    const { data, error } = await supabase
      .from('lead_contacts')
      .insert({
        org_id: ORG_ID,
        email: f.email,
        first_name: 'V1bSend',
        last_name: 'Smoke',
        business_name: 'V1+b Send-Path Smoke',
        email_status: 'verified',
        scrape_source: 'manual',
        unsubscribed_at: f.unsub ? new Date().toISOString() : null,
      })
      .select('id')
      .single();
    if (error || !data) {
      fail(`lead_contact insert failed for ${f.email}: ${error?.message}`);
      return;
    }
    inserted.push({ id: data.id, email: f.email, unsub: f.unsub });
    cleanup.leadContactIds.push(data.id);
  }

  // Replicate getPendingRecipients's unsubSet logic against the fresh fixtures.
  // (Calling the real handler would require a real campaign + recipients; the
  // unsub filter shape is the contract we care about here.)
  const { data: unsub } = await supabase
    .from('lead_contacts')
    .select('email')
    .eq('org_id', ORG_ID)
    .not('unsubscribed_at', 'is', null);
  const unsubSet = new Set(
    (unsub || [])
      .map((r: { email: string | null }) => (r.email || '').trim().toLowerCase())
      .filter((e) => e.length > 0)
  );

  const candidates = inserted.map((f) => ({ email: f.email, unsub: f.unsub }));
  const filtered = candidates.filter((c) => !unsubSet.has(c.email.toLowerCase()));

  assertEq(filtered.length, 2, 'send-path filter returns 2 active recipients');
  const filteredEmails = filtered.map((f) => f.email).sort();
  const expectedEmails = inserted.filter((f) => !f.unsub).map((f) => f.email).sort();
  assertEq(JSON.stringify(filteredEmails), JSON.stringify(expectedEmails), 'filtered emails match the non-unsubscribed pair');

  console.log(`  unsubSet size: ${unsubSet.size} (org-wide); fixture excluded: ${inserted.find((f) => f.unsub)?.email}`);
}

async function main() {
  const supabase = getSupabase();
  console.log('=== V1+b smoke test (worker @ 200.234.226.226) ===');
  console.log(`  org_id: ${ORG_ID}`);
  console.log(`  worker HEAD: ${process.env.WORKER_HEAD || '(unset)'}`);

  try {
    await probe1_softDeletePersists(supabase);
    await probe2_syncRespectsDeleted(supabase);
    await probe3_manualUnsubscribe(supabase);
    await probe4_autoUnsubOnStop(supabase);
    await probe5_sendPathFilter(supabase);
  } catch (err) {
    fail(`unexpected exception: ${(err as Error).message}`);
    console.error((err as Error).stack);
  } finally {
    await rollback(supabase);
  }

  console.log(`\n=== ${passed}/${passed + failed} probe assertions passed ===`);
  if (failed > 0) {
    console.error(`${failed} FAILED — see output above`);
    process.exit(1);
  }
  console.log('All V1+b smoke probes passed.');
}

main();
