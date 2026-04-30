// V1a: Worker handler for downloading + inserting results from a completed
// Outscraper task. Triggered by `outscraper-task-complete` jobs that the
// poll handler enqueues when an Outscraper task reports success.
//
// Inserts each row into lead_contacts with:
//   - org_id, lead_list_id (scope)
//   - outscraper_task_id (provenance)
//   - raw_payload (full Outscraper row JSON, for v1b 8-step cleaning)
//   - scrape_source='outscraper', email_status='pending'
//
// Dedupe via lead_contacts UNIQUE(org_id, email) — `ignoreDuplicates: true`
// keeps verification status on rows that already exist.

import { createClient } from '@supabase/supabase-js';
import {
  downloadResults,
  mapOutscraperRowToLeadContact,
  type OutscraperBusinessRow,
} from '../../lib/outscraper/client';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface OutscraperTaskCompletePayload {
  outscraperTaskId: string;
}

export interface CompletableTaskRow {
  id: string;
  org_id: string;
  lead_list_id: string;
  outscraper_task_id: string;
  status: string;
  results_location: string | null;
  filters: Record<string, unknown> | null;
}

type TaskRow = CompletableTaskRow;

/**
 * Build the lead_contacts insert rows from raw Outscraper rows. Pure — no
 * I/O, no supabase. Exposed for unit tests + isolation. Skips rows lacking
 * a business_name AND email AND phone (not addressable for outreach).
 */
export function buildLeadContactInserts(
  task: Pick<CompletableTaskRow, 'org_id' | 'lead_list_id' | 'outscraper_task_id' | 'filters'>,
  rows: OutscraperBusinessRow[],
  nowIso = new Date().toISOString()
): Record<string, unknown>[] {
  const filters = (task.filters || {}) as { query?: string };
  const scrapeQuery = (filters.query || '').slice(0, 500);
  const inserts: Record<string, unknown>[] = [];
  for (const r of rows) {
    const mapped = mapOutscraperRowToLeadContact(r);
    if (!mapped.business_name && !mapped.email && !mapped.phone) continue;
    inserts.push({
      org_id: task.org_id,
      lead_list_id: task.lead_list_id,
      outscraper_task_id: task.outscraper_task_id,
      raw_payload: r as unknown as Record<string, unknown>,
      business_name: mapped.business_name,
      business_type: mapped.business_type,
      email: mapped.email,
      phone: mapped.phone,
      website: mapped.website,
      address: mapped.full_address,
      city: mapped.city,
      state: mapped.state,
      zip: mapped.zip,
      country: mapped.country,
      google_rating: mapped.google_rating,
      google_reviews_count: mapped.google_reviews_count,
      google_place_id: mapped.google_place_id,
      scrape_source: 'outscraper',
      scrape_query: scrapeQuery || null,
      scraped_at: nowIso,
      email_status: 'pending',
    });
  }
  return inserts;
}

export async function handleOutscraperTaskComplete(
  payload: OutscraperTaskCompletePayload
): Promise<void> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    throw new Error('OUTSCRAPER_API_KEY environment variable not set');
  }

  const supabase = getSupabase();
  const { outscraperTaskId } = payload;

  const { data: row, error: rowErr } = await supabase
    .from('outscraper_tasks')
    .select('id, org_id, lead_list_id, outscraper_task_id, status, results_location, filters')
    .eq('outscraper_task_id', outscraperTaskId)
    .maybeSingle();

  if (rowErr) {
    throw new Error(`Failed to load outscraper_tasks row: ${rowErr.message}`);
  }
  if (!row) {
    console.warn(
      `[outscraper-task-complete] No row found for outscraper_task_id=${outscraperTaskId}; skipping.`
    );
    return;
  }
  const task = row as TaskRow;

  if (task.status === 'complete') {
    console.log(
      `[outscraper-task-complete] Task ${outscraperTaskId} already complete; skipping.`
    );
    return;
  }
  if (task.status !== 'downloading') {
    // Be permissive on retries — if the previous run set it to failed
    // mid-way, we don't want to double-recover. Skip.
    console.warn(
      `[outscraper-task-complete] Task ${outscraperTaskId} in unexpected status=${task.status}; skipping.`
    );
    return;
  }
  if (!task.results_location) {
    throw new Error(
      `Task ${outscraperTaskId} has no results_location — should have been set by poll handler`
    );
  }

  let rows: OutscraperBusinessRow[];
  try {
    rows = await downloadResults(apiKey, task.results_location, outscraperTaskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('outscraper_tasks')
      .update({
        status: 'failed',
        error_message: `download failed: ${msg}`.slice(0, 1000),
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);
    await supabase
      .from('lead_lists')
      .update({
        last_scrape_status: 'failed',
        last_scrape_error: `download failed: ${msg}`.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.lead_list_id);
    await supabase.from('system_alerts').insert({
      org_id: task.org_id,
      alert_type: 'outscraper_error',
      severity: 'warning',
      title: `Outscraper download failed for list ${task.lead_list_id}`,
      details: { outscraper_task_id: outscraperTaskId, error: msg },
    });
    throw err;
  }

  console.log(
    `[outscraper-task-complete] Task ${outscraperTaskId} downloaded ${rows.length} rows`
  );

  const nowIso = new Date().toISOString();
  const inserts = buildLeadContactInserts(task, rows, nowIso);

  // Two-pass insert because lead_contacts UNIQUE(org_id, email) only
  // protects against email collisions. Rows without an email need a plain
  // INSERT; rows with email use UPSERT(ignoreDuplicates) to preserve any
  // existing verification status.
  let insertedTotal = 0;

  const withEmail = inserts.filter((r) => r.email);
  const withoutEmail = inserts.filter((r) => !r.email);

  if (withEmail.length > 0) {
    // Chunk to keep request size bounded.
    for (let i = 0; i < withEmail.length; i += 200) {
      const slice = withEmail.slice(i, i + 200);
      const { data, error } = await supabase
        .from('lead_contacts')
        .upsert(slice, { onConflict: 'org_id,email', ignoreDuplicates: true })
        .select('id');
      if (error) {
        throw new Error(`lead_contacts upsert failed: ${error.message}`);
      }
      insertedTotal += data?.length || 0;
    }
  }

  if (withoutEmail.length > 0) {
    for (let i = 0; i < withoutEmail.length; i += 200) {
      const slice = withoutEmail.slice(i, i + 200);
      const { data, error } = await supabase
        .from('lead_contacts')
        .insert(slice)
        .select('id');
      if (error) {
        throw new Error(`lead_contacts insert (phone-only) failed: ${error.message}`);
      }
      insertedTotal += data?.length || 0;
    }
  }

  // Recount the list (exact count, not a delta — handles dedupes correctly)
  const { count: listCount } = await supabase
    .from('lead_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('lead_list_id', task.lead_list_id);

  await supabase
    .from('outscraper_tasks')
    .update({
      status: 'complete',
      actual_count: rows.length,
      completed_at: nowIso,
    })
    .eq('id', task.id);

  await supabase
    .from('lead_lists')
    .update({
      total_leads: listCount ?? insertedTotal,
      last_scrape_status: 'complete',
      last_scrape_completed_at: nowIso,
      last_scrape_error: null,
      updated_at: nowIso,
    })
    .eq('id', task.lead_list_id);

  await supabase.from('system_alerts').insert({
    org_id: task.org_id,
    alert_type: 'outscraper_task_complete',
    severity: 'info',
    title: `Outscraper task ${outscraperTaskId} saved ${insertedTotal} leads`,
    details: {
      outscraper_task_id: outscraperTaskId,
      lead_list_id: task.lead_list_id,
      rows_downloaded: rows.length,
      rows_inserted: insertedTotal,
    },
  });

  console.log(
    `[outscraper-task-complete] Task ${outscraperTaskId} complete: downloaded=${rows.length} inserted=${insertedTotal} list_total=${listCount}`
  );
}
