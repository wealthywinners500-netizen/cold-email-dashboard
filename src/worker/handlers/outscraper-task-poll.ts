// V1a: Worker handler for polling a single Outscraper async task.
//
// Triggered by `outscraper-task-poll` jobs that the cron `outscraper-task-poll-cron`
// fans out every 2 minutes for any rows in `outscraper_tasks` with status
// IN ('submitted','polling'). On success, marks the task as `downloading`
// and enqueues `outscraper-task-complete` to download + insert results.
//
// Hard Lesson #34 — no module-scope client. Lazy supabase init.

import { createClient } from '@supabase/supabase-js';
import { getTaskStatus } from '../../lib/outscraper/client';
import type { OutscraperTaskStatus } from '../../lib/supabase/types';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export interface OutscraperTaskPollPayload {
  outscraperTaskId: string;
}

interface TaskRow {
  id: string;
  org_id: string;
  lead_list_id: string;
  outscraper_task_id: string;
  status: OutscraperTaskStatus;
}

export async function handleOutscraperTaskPoll(
  payload: OutscraperTaskPollPayload
): Promise<void> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    throw new Error('OUTSCRAPER_API_KEY environment variable not set');
  }

  const supabase = getSupabase();
  const { outscraperTaskId } = payload;

  // Atomically guard against double-processing: only proceed if the row
  // is still in (submitted, polling). The complete handler runs from the
  // 'downloading' state, so we don't want this poll racing with that.
  const { data: row, error: rowErr } = await supabase
    .from('outscraper_tasks')
    .select('id, org_id, lead_list_id, outscraper_task_id, status')
    .eq('outscraper_task_id', outscraperTaskId)
    .maybeSingle();

  if (rowErr) {
    throw new Error(`Failed to load outscraper_tasks row: ${rowErr.message}`);
  }
  if (!row) {
    console.warn(
      `[outscraper-task-poll] No row found for outscraper_task_id=${outscraperTaskId}; skipping.`
    );
    return;
  }
  const task = row as TaskRow;
  if (task.status !== 'submitted' && task.status !== 'polling') {
    console.log(
      `[outscraper-task-poll] Task ${outscraperTaskId} already in status=${task.status}; skipping.`
    );
    return;
  }

  let result;
  try {
    result = await getTaskStatus(apiKey, outscraperTaskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('outscraper_tasks')
      .update({
        last_polled_at: new Date().toISOString(),
        status: 'polling',
      })
      .eq('id', task.id);
    // Throw to let pg-boss retry
    throw new Error(`Outscraper poll transient error: ${msg}`);
  }

  if (result.kind === 'pending') {
    await supabase
      .from('outscraper_tasks')
      .update({ status: 'polling', last_polled_at: new Date().toISOString() })
      .eq('id', task.id);
    return;
  }

  if (result.kind === 'error') {
    const errorMessage = result.message || 'Unknown Outscraper failure';
    await supabase
      .from('outscraper_tasks')
      .update({
        status: 'failed',
        error_message: errorMessage,
        last_polled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    await supabase
      .from('lead_lists')
      .update({
        last_scrape_status: 'failed',
        last_scrape_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.lead_list_id);

    await supabase.from('system_alerts').insert({
      org_id: task.org_id,
      alert_type: 'outscraper_error',
      severity: 'warning',
      title: `Outscraper task failed for list ${task.lead_list_id}`,
      details: { outscraper_task_id: outscraperTaskId, error: errorMessage },
    });
    console.error(
      `[outscraper-task-poll] Task ${outscraperTaskId} failed: ${errorMessage}`
    );
    return;
  }

  // Success — mark downloading, store results_location, enqueue complete.
  await supabase
    .from('outscraper_tasks')
    .update({
      status: 'downloading',
      results_location: result.resultsLocation,
      last_polled_at: new Date().toISOString(),
    })
    .eq('id', task.id);

  await supabase
    .from('lead_lists')
    .update({
      last_scrape_status: 'downloading',
      updated_at: new Date().toISOString(),
    })
    .eq('id', task.lead_list_id);

  // Lazy import the boss to avoid module-load order issues with the worker
  // bootstrap. campaign-queue.initBoss returns the same singleton.
  const { initBoss } = await import('../../lib/email/campaign-queue');
  const boss = await initBoss();
  await boss.send('outscraper-task-complete', { outscraperTaskId });
  console.log(
    `[outscraper-task-poll] Task ${outscraperTaskId} success — enqueued complete handler.`
  );
}
