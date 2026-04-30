// V8 fix (2026-04-30): rewritten to Outscraper's proven async /tasks API after
// V1a's wrong host/path/method (api.app.outscraper.com /maps/search-v3 GET) returned
// 0/45 emails across three smokes. Ground-truth probe at
// reports/2026-04-30-outscraper-tasks-api-design.md §2 — replicating Dean's verbatim
// "Atlanta Medical Practices v2" curl (16,824 leads) at smoke scale produced 23/23
// rows with email and 12/23 with first_name+last_name. preferred_contacts dropped
// "finance" per Dean 2026-04-30 (4 types instead of the historical 5).
//
// Endpoints:
//   POST  https://api.outscraper.cloud/tasks            (submit, JSON body)
//   GET   https://api.outscraper.cloud/requests/<id>    (poll; returns inline `data` on success)
//
// Hard Lesson #34 — no module-scope client init. The `apiKey` arg is required and
// resolved at call time from process.env.OUTSCRAPER_API_KEY by the caller.

import type { OutscraperFilters } from '@/lib/supabase/types';

const OUTSCRAPER_BASE = 'https://api.outscraper.cloud';

export interface SubmitTaskResult {
  /** Outscraper task id (opaque string). */
  outscraperTaskId: string;
  /** UI task id (short YYYYMMDDHHMMSS<rand>) — kept for traceability. */
  uiTaskId?: string;
  /** Status string Outscraper returns on submit (typically 'Pending' or absent). */
  status: string;
}

export type OutscraperPollStatus =
  | { kind: 'pending' }
  | { kind: 'success'; resultsLocation: string }
  | { kind: 'error'; message: string };

/**
 * Submit a Maps task in async mode. Outscraper queues the task and returns an
 * opaque task id; the worker cron polls /requests/<id> every 2 minutes until
 * status='Success'. The body is the proven shape from Dean's verbatim curl —
 * see file header.
 */
export async function submitMapsSearchTask(
  apiKey: string,
  filters: OutscraperFilters
): Promise<SubmitTaskResult> {
  if (!apiKey) {
    throw new Error('Outscraper API key is required');
  }

  const categories = filters.categories.filter((c) => c.trim().length > 0);
  const locations = filters.locations.filter((l) => l.trim().length > 0);
  if (categories.length === 0) {
    throw new Error('filters.categories must be a non-empty string array');
  }
  if (locations.length === 0) {
    throw new Error('filters.locations must be a non-empty string array');
  }

  const preferredContacts =
    filters.preferred_contacts && filters.preferred_contacts.length > 0
      ? filters.preferred_contacts
      : ['decision makers', 'operations', 'marketing', 'sales'];

  const nowSecondsId = `v8-${Date.now()}`;
  const queriesAmount = categories.length * locations.length;

  const body = {
    UISettings: {
      isCustomCategories: false,
      isCustomLocations: true,
      isCustomQueries: false,
    },
    categories,
    customer_email: 'dean@thestealthmail.com',
    dropDuplicates: 'true',
    dropEmailDuplicates: filters.drop_email_duplicates !== false,
    enrich: false,
    enrichLocations: false,
    enrichments: ['contacts_n_leads'],
    enrichments_kwargs: {
      contacts_n_leads: { preferred_contacts: preferredContacts },
    },
    est: queriesAmount * Math.max(1, filters.organizations_per_query_limit),
    exactMatch: false,
    filters: [
      {
        exclusiveGroup: 'site_existence',
        key: 'website',
        labelKey: 'title.onlyWithWebsite',
        operator: 'is not blank',
        value: null,
      },
      {
        key: 'business_status',
        labelKey: 'title.operationalOnly',
        operator: 'equals',
        value: ['operational'],
      },
    ],
    id: nowSecondsId,
    ignoreWithoutEmails: filters.ignore_without_emails !== false,
    language: filters.language || 'en',
    limit: typeof filters.limit === 'number' ? filters.limit : 0,
    locations,
    org: 'os',
    organizationsPerQueryLimit:
      filters.organizations_per_query_limit > 0
        ? filters.organizations_per_query_limit
        : 200,
    queries_amount: queriesAmount,
    region: filters.region || 'US',
    service_name: 'google_maps_service_v2',
    settings: { output_columns: [], output_extension: 'json' },
    tags: filters.vertical || categories.join(','),
    title:
      filters.vertical && filters.region
        ? `${filters.vertical} - ${filters.region}`
        : `Outscraper task ${nowSecondsId}`,
    useZipCodes: filters.use_zip_codes !== false,
  };

  const url = `${OUTSCRAPER_BASE}/tasks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Outscraper submit failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    id?: string;
    status?: string;
    ui_task_id?: string;
  };
  if (!json.id) {
    throw new Error(`Outscraper submit returned no task id: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return {
    outscraperTaskId: json.id,
    uiTaskId: json.ui_task_id,
    status: json.status || 'Pending',
  };
}

/**
 * Poll a task by id. Returns one of three discriminated outcomes:
 *  - pending: still running
 *  - success: results are ready (possibly inline — see `inline:` sentinel)
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
    results_location?: string | null;
    data?: unknown;
  };
  const status = (json.status || '').toLowerCase();

  if (status === 'success' || status === 'finished') {
    if (json.results_location) {
      return { kind: 'success', resultsLocation: json.results_location };
    }
    // Outscraper /tasks API returns data inline on the poll response. The
    // downloader honors the `inline:<taskId>` sentinel by re-GETting /requests.
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

/**
 * One business × decision-maker row from the /tasks contacts_n_leads response.
 * The API already flattens — a place with 3 matched decision-makers appears
 * as 3 rows with the same place_id and different email/first_name/last_name.
 */
export interface OutscraperBusinessRow {
  /** Business name. */
  name?: string;
  /** Deduplicated business name (used for outreach personalization, HL #40). */
  name_for_emails?: string;
  /** Top-level place email. Mapper uses this directly. */
  email?: string | null;
  /** Decision-maker first name (when matched). */
  first_name?: string | null;
  /** Decision-maker last name (when matched). */
  last_name?: string | null;
  /** Decision-maker full name (alternative). */
  full_name?: string | null;
  /** Primary Google Maps category. */
  category?: string;
  /** Secondary categories — comma-separated string in the new shape. */
  subtypes?: string | string[];
  type?: string;
  phone?: string;
  website?: string;
  domain?: string;
  /** Full street address (V1a's `full_address` is gone in this shape). */
  address?: string;
  city?: string;
  state?: string;
  state_code?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  rating?: number;
  reviews?: number;
  place_id?: string;
  business_status?: string;
  /** Place's owner-title (always equals business name in the proven shape — NOT a contact title). */
  owner_title?: string;
  [key: string]: unknown;
}

/**
 * Download the result rows for a completed task. Honors the `inline:<taskId>`
 * sentinel set by `getTaskStatus` when the poll body inlines `data`.
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
    // Pre-signed URL — auth header is harmless if signature is account-bound.
    res = await fetch(resultsLocation, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Outscraper download failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: unknown };

  // /tasks contacts_n_leads returns a flat array of row objects (one per
  // place×decision-maker). Defensively also accept the legacy nested-array
  // shape in case Outscraper toggles it.
  const data = json.data;
  if (!Array.isArray(data)) return [];
  const rows: OutscraperBusinessRow[] = [];
  for (const item of data) {
    if (Array.isArray(item)) {
      for (const inner of item) {
        if (inner && typeof inner === 'object') rows.push(inner as OutscraperBusinessRow);
      }
    } else if (item && typeof item === 'object') {
      rows.push(item as OutscraperBusinessRow);
    }
  }
  return rows;
}

/**
 * Map a single raw Outscraper /tasks row to a partial lead_contacts row.
 * V8 shape: row-level `email`, `first_name`, `last_name`, `address` (not
 * the legacy `emails_and_contacts.emails[]` / `full_address`).
 */
export function mapOutscraperRowToLeadContact(row: OutscraperBusinessRow): {
  business_name: string | null;
  business_type: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
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
  const businessType = row.category || row.type || subtypes || null;
  const businessName = row.name_for_emails || row.name || null;
  const email = typeof row.email === 'string' && row.email.length > 0 ? row.email : null;
  const firstName =
    typeof row.first_name === 'string' && row.first_name.length > 0 ? row.first_name : null;
  const lastName =
    typeof row.last_name === 'string' && row.last_name.length > 0 ? row.last_name : null;
  return {
    business_name: businessName,
    business_type: businessType,
    email,
    first_name: firstName,
    last_name: lastName,
    // No clean contact-title field in /tasks contacts_n_leads response;
    // owner_title equals business name. Leave null for v1b cleaning.
    position: null,
    phone: row.phone || null,
    website: row.website || null,
    full_address: row.address || null,
    city: row.city || null,
    state: row.state_code || row.state || null,
    zip: row.postal_code || null,
    country: row.country_code || 'US',
    google_rating: typeof row.rating === 'number' ? row.rating : null,
    google_reviews_count: typeof row.reviews === 'number' ? row.reviews : null,
    google_place_id: row.place_id || null,
  };
}
