// V1a: Outscraper async REST client.
//
// Used by the new /api/leads/lists/[id]/scrape route + worker handlers
// outscraper-task-poll + outscraper-task-complete. Mirrors the X-API-KEY
// header convention from src/lib/leads/outscraper-service.ts.
//
// Hard Lesson #34 — no module-scope client init. The `apiKey` arg is
// required and resolved at call time from process.env.OUTSCRAPER_API_KEY.
//
// Endpoints:
//   POST/GET https://api.app.outscraper.com/maps/search-v3?async=true
//   GET      https://api.app.outscraper.com/requests/<task_id>
//   GET      <results_location>  (returned in the success poll body)

import type { OutscraperFilters } from '@/lib/supabase/types';

const OUTSCRAPER_BASE = 'https://api.app.outscraper.com';

export interface SubmitTaskResult {
  /** Outscraper task id (UUID) returned by `?async=true`. */
  outscraperTaskId: string;
  /** Status string Outscraper returns on submit (typically 'Pending'). */
  status: string;
}

export type OutscraperPollStatus =
  | { kind: 'pending' }
  | { kind: 'success'; resultsLocation: string }
  | { kind: 'error'; message: string };

/**
 * Submit a Maps Search V3 task in async mode. Outscraper queues the task
 * and returns a task id immediately. We then poll /requests/<id> via the
 * worker cron until status='Success'.
 */
export async function submitMapsSearchTask(
  apiKey: string,
  filters: OutscraperFilters
): Promise<SubmitTaskResult> {
  if (!apiKey) {
    throw new Error('Outscraper API key is required');
  }

  const params = new URLSearchParams();
  // Outscraper supports a single combined query string. We compose
  // "<vertical>, <location>" matching the legacy sync path.
  const composedQuery = filters.query.trim();
  params.set('query', composedQuery);
  params.set('async', 'true');
  if (filters.places_per_query > 0) {
    params.set('limit', String(filters.places_per_query));
  }
  if (filters.language) params.set('language', filters.language);
  if (filters.region) params.set('region', filters.region);
  if (filters.enrichment && filters.enrichment.length > 0) {
    for (const e of filters.enrichment) params.append('enrichment', e);
  }
  if (filters.websites_only) params.set('skipPlacesWithoutWebsite', 'true');
  if (filters.operational_only) params.set('dropDuplicates', 'true');

  const url = `${OUTSCRAPER_BASE}/maps/search-v3?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Outscraper submit failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { id?: string; status?: string };
  if (!json.id) {
    throw new Error(`Outscraper submit returned no task id: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return {
    outscraperTaskId: json.id,
    status: json.status || 'Pending',
  };
}

/**
 * Poll a task by id. Returns one of three discriminated outcomes:
 *  - pending: still running
 *  - success: results are ready at `resultsLocation`
 *  - error: terminal failure with `message`
 */
export async function getTaskStatus(
  apiKey: string,
  outscraperTaskId: string
): Promise<OutscraperPollStatus> {
  if (!apiKey) {
    throw new Error('Outscraper API key is required');
  }

  const url = `${OUTSCRAPER_BASE}/requests/${encodeURIComponent(outscraperTaskId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-KEY': apiKey,
      Accept: 'application/json',
    },
  });

  if (res.status === 202) {
    return { kind: 'pending' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { kind: 'error', message: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  }

  const json = (await res.json()) as {
    id?: string;
    status?: string;
    results_location?: string;
    data?: unknown;
  };
  const status = (json.status || '').toLowerCase();

  if (status === 'success' || status === 'finished') {
    if (json.results_location) {
      return { kind: 'success', resultsLocation: json.results_location };
    }
    // Some Outscraper responses inline `data` instead of providing a URL.
    // Treat that case as success with a sentinel that the downloader honors.
    return { kind: 'success', resultsLocation: `inline:${outscraperTaskId}` };
  }
  if (status === 'pending' || status === 'in progress' || status === 'inprogress' || status === 'queued') {
    return { kind: 'pending' };
  }
  if (status === 'error' || status === 'failed') {
    return { kind: 'error', message: 'Outscraper reported task failure' };
  }
  return { kind: 'pending' };
}

export interface OutscraperBusinessRow {
  name?: string;
  type?: string;
  subtypes?: string[] | string;
  phone?: string;
  site?: string;
  full_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
  rating?: number;
  reviews?: number;
  place_id?: string;
  emails_and_contacts?: {
    emails?: string[];
    phones?: string[];
  };
  [key: string]: unknown;
}

/**
 * Download the result rows for a completed task. Accepts either a real URL
 * or the `inline:<taskId>` sentinel (in which case we re-GET /requests/<id>
 * and read `data` directly).
 */
export async function downloadResults(
  apiKey: string,
  resultsLocation: string,
  outscraperTaskId: string
): Promise<OutscraperBusinessRow[]> {
  let res: Response;
  if (resultsLocation.startsWith('inline:')) {
    const url = `${OUTSCRAPER_BASE}/requests/${encodeURIComponent(outscraperTaskId)}`;
    res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
  } else {
    // Outscraper results URLs are pre-signed and don't require auth, but we
    // still send the API key on the off chance the signature is account-bound.
    res = await fetch(resultsLocation, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Outscraper download failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: unknown;
  };

  // Outscraper schema: data is an array of arrays — outer = queries, inner = rows.
  const data = json.data;
  if (!Array.isArray(data)) return [];
  const rows: OutscraperBusinessRow[] = [];
  for (const queryGroup of data) {
    if (Array.isArray(queryGroup)) {
      for (const row of queryGroup) {
        if (row && typeof row === 'object') rows.push(row as OutscraperBusinessRow);
      }
    } else if (queryGroup && typeof queryGroup === 'object') {
      rows.push(queryGroup as OutscraperBusinessRow);
    }
  }
  return rows;
}

/**
 * Map a single raw Outscraper row to a partial lead_contacts row.
 * Mirrors the legacy outscraper-service.ts mapping; v1b will refine
 * (8-step cleaning) before this lands in production-clean state.
 */
export function mapOutscraperRowToLeadContact(row: OutscraperBusinessRow): {
  business_name: string | null;
  business_type: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  full_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  google_rating: number | null;
  google_reviews_count: number | null;
  google_place_id: string | null;
} {
  const subtypes = Array.isArray(row.subtypes)
    ? row.subtypes[0]
    : typeof row.subtypes === 'string'
      ? row.subtypes
      : undefined;
  const email =
    row.emails_and_contacts?.emails && row.emails_and_contacts.emails.length > 0
      ? row.emails_and_contacts.emails[0]
      : null;
  return {
    business_name: row.name || null,
    business_type: row.type || subtypes || null,
    email,
    phone: row.phone || null,
    website: row.site || null,
    full_address: row.full_address || null,
    city: row.city || null,
    state: row.state || null,
    zip: row.postal_code || null,
    country: row.country_code || 'US',
    google_rating: typeof row.rating === 'number' ? row.rating : null,
    google_reviews_count: typeof row.reviews === 'number' ? row.reviews : null,
    google_place_id: row.place_id || null,
  };
}
