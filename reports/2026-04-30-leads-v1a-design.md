# Leads V1a — Design Doc (Phase 0)

**Author:** V7 CC autonomous session — 2026-04-30
**Branch:** `claude/reverent-chaplygin-3ccb52` → push as `feat/leads-v1a-outscraper-custom-lists`
**Worktree:** `.claude/worktrees/reverent-chaplygin-3ccb52`
**Spec:** dashboard-app/.claude reverent-chaplygin authoring prompt (V7, 2026-04-30)

---

## 1. Existing `/dashboard/leads` state — extend vs replace

### File inventory (worktree)

| Path | LOC | Purpose | Decision |
|---|---|---|---|
| `src/app/dashboard/leads/page.tsx` | 122 | Server component — tabs (`contacts` / `batches`), fetches data | **MODIFY** — add 3rd `lists` tab + default to it |
| `src/app/dashboard/leads/leads-client.tsx` | 451 | "Batches" view — aggregates over legacy `leads` table (BarChart, PieChart of `total_scraped` etc.) | **KEEP UNTOUCHED** — legacy view, harmless |
| `src/app/dashboard/leads/lead-contacts-client.tsx` | 1040 | "Contacts" view — flat browse of `lead_contacts`, includes inline `LeadSearchModal` (sync Outscraper), `ContactCsvImportModal`, `AddContactModal`, `AddToCampaignModal` | **KEEP UNTOUCHED** — legacy flat-browse + sync-search path stays for cross-list browsing |
| `src/app/dashboard/leads/loading.tsx` | — | Suspense fallback | **KEEP** |

### Existing API routes (worktree)

| Path | Purpose | Decision |
|---|---|---|
| `src/app/api/leads/route.ts` | GET/POST legacy `leads` (batches) table | **KEEP** |
| `src/app/api/leads/[id]/route.ts` | DELETE legacy lead row | **KEEP** |
| `src/app/api/lead-contacts/route.ts` | GET (paginated) + POST (create single contact) | **KEEP** |
| `src/app/api/lead-contacts/[id]/route.ts` | PATCH/DELETE single contact | **KEEP** |
| `src/app/api/lead-contacts/[id]/unsubscribe/route.ts` | POST manual unsubscribe (V1+b) | **KEEP** |
| `src/app/api/lead-contacts/search/route.ts` | POST sync Outscraper search (`async=false`, ≤250 limit) | **KEEP** — legacy sync path; do NOT touch |
| `src/app/api/lead-contacts/verify/route.ts` | POST Reoon verify selected/pending | **KEEP** — already shipped |
| `src/app/api/lead-contacts/import-to-campaign/route.ts` | POST add contacts → campaign | **KEEP** — already shipped |

### Existing infrastructure already shipped (do NOT touch)

- **`src/lib/leads/outscraper-service.ts`** — sync search, uses `X-API-KEY` header + per-org integrations key
- **`src/lib/leads/verification-service.ts`** — Reoon verify
- **`src/worker/handlers/verify-new-leads.ts`** — Reoon batch worker (uses `process.env.REOON_API_KEY`)
- **`lead_contacts` schema** — fully built, includes `email_status` (the canonical verification status), `verification_result JSONB` (mig 012), `unsubscribed_at` (mig 022)

### Decision: **EXTEND, not replace**

The existing UI is shipped + working. The prompt's "v1b adds Reoon verify + import-to-campaign" line is stale relative to the worktree — those are already merged. Per Dean's locked scope ("/dashboard/leads IS the Outscraper interface ... custom lists are scoping entities ... save flow into leads + lead_contacts"), the gap is:

1. **No `lead_lists` table** — no scoping entity
2. **No async polling** — current sync path can't handle volumes >250 (Outscraper sync caps ~5 min)
3. **No skill-based defaults** — current modal is bare-bones (business_type + location + 25/50/100/250 limit)
4. **No cost preview** — no `volume × $0.0047` displayed before submit
5. **No raw_payload preservation** — current insert maps Outscraper fields directly; v1b cleaning needs the raw row

V1a closes those 5 gaps without disturbing the existing surfaces.

### Schema divergence note (deviation from prompt)

Prompt says "ADD `leads.verification_status TEXT DEFAULT 'unverified'`". The canonical column on `lead_contacts` is **`email_status`** (`pending|valid|invalid|risky|unknown`), populated by `verify-new-leads.ts` and read by `LeadContactsClient`. Adding a redundant `verification_status` column would silently divert existing UI/worker code paths. **Decision:** keep `email_status` as the verification status; do not add `verification_status`. The pre-existing `verify-new-leads.ts` worker handler at line 148 (`.eq('verification_status', 'unverified')`) is an unrelated pre-existing bug filtering on a non-existent column — leaving as-is per scope discipline.

---

## 2. Migration 023 SQL (verbatim)

`supabase/migrations/023_leads_v1a_lists.sql`:

```sql
-- Leads V1a: custom lists + async Outscraper task tracking + raw payload preservation

-- 1) lead_lists: scoping entity for region/vertical separation
CREATE TABLE IF NOT EXISTS lead_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  region VARCHAR(255),
  vertical VARCHAR(255),
  sub_vertical VARCHAR(255),
  suggested_filters JSONB DEFAULT '{}',
  total_leads INT NOT NULL DEFAULT 0,
  last_scrape_status TEXT,
  last_scrape_started_at TIMESTAMPTZ,
  last_scrape_completed_at TIMESTAMPTZ,
  last_scrape_error TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lead_lists_org_active
  ON lead_lists(org_id, created_at DESC)
  WHERE archived_at IS NULL;

-- 2) outscraper_tasks: async task tracking
CREATE TABLE IF NOT EXISTS outscraper_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_list_id UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  outscraper_task_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('submitted','polling','downloading','complete','failed')),
  filters JSONB NOT NULL DEFAULT '{}',
  estimated_count INT,
  estimated_cost_cents INT,
  actual_count INT,
  results_location TEXT,
  error_message TEXT,
  last_polled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outscraper_tasks_pending
  ON outscraper_tasks(status, created_at DESC)
  WHERE status IN ('submitted','polling','downloading');

CREATE INDEX IF NOT EXISTS idx_outscraper_tasks_list
  ON outscraper_tasks(lead_list_id, created_at DESC);

-- 3) lead_contacts: scope to a list + preserve raw Outscraper payload
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS lead_list_id UUID REFERENCES lead_lists(id) ON DELETE SET NULL;
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS outscraper_task_id TEXT;
ALTER TABLE lead_contacts
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_list
  ON lead_contacts(lead_list_id)
  WHERE lead_list_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_contacts_org_list
  ON lead_contacts(org_id, lead_list_id, created_at DESC)
  WHERE lead_list_id IS NOT NULL;

-- 4) RLS for new tables
ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON lead_lists;
CREATE POLICY "org_isolation" ON lead_lists
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

ALTER TABLE outscraper_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON outscraper_tasks;
CREATE POLICY "org_isolation" ON outscraper_tasks
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- 5) updated_at trigger for lead_lists
CREATE OR REPLACE FUNCTION update_lead_lists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_lead_lists_updated_at ON lead_lists;
CREATE TRIGGER trigger_lead_lists_updated_at
  BEFORE UPDATE ON lead_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_lists_updated_at();
```

**Migration number:** 023 (last applied: 022_unibox_v1b_soft_delete_unsubscribe.sql).
**Idempotency:** all `IF NOT EXISTS` / `DROP IF EXISTS` — safe to re-run.
**No DELETEs, no col drops** — strictly additive.

---

## 3. Outscraper API path

**Decision: Direct REST async, env-based key.**

| Aspect | Choice |
|---|---|
| Endpoint | `POST https://api.app.outscraper.com/maps/search-v3?async=true&query=…&limit=…&enrichment=emails_and_contacts` |
| Auth | `X-API-KEY: ${OUTSCRAPER_API_KEY}` (matches existing `outscraper-service.ts:39`) |
| Polling | `GET https://api.app.outscraper.com/requests/<task_id>` |
| Results | When `status='Success'`, `results_location` URL → GET to download JSON |
| Key source | `process.env.OUTSCRAPER_API_KEY` for new async path (worker + new API route) — matches `verify-new-leads.ts:134`'s `process.env.REOON_API_KEY` pattern |

**Why not MCP?** `mcp__outscraper__*` tools are available but not callable from server-side Next.js code or worker handlers (those are MCP server tools, not Outscraper SDK). The existing sync path is REST; staying with REST is consistent.

**Why env not org-scoped key?** Worker handlers run cron-driven without Clerk session; can't easily resolve `organizations.integrations.outscraper_api_key` per task. Keeping the existing org-scoped key path on the legacy `/api/lead-contacts/search` route untouched.

---

## 4. Pg-boss queue plan

| Queue | Purpose | retryLimit | expireInSeconds | Cron |
|---|---|---|---|---|
| `outscraper-task-poll-cron` | Cron trigger — scans `outscraper_tasks` where status IN ('submitted','polling') and enqueues one `outscraper-task-poll` per row | default | default | `*/2 * * * *` |
| `outscraper-task-poll` | Polls a single Outscraper task, advances status, enqueues `outscraper-task-complete` on success | 3 | 120 | — |
| `outscraper-task-complete` | Downloads results, parses, batch-inserts into `lead_contacts` | 2 | 600 | — |

`localConcurrency=1` on `outscraper-task-complete` to avoid duplicate-insert races on the same task.

---

## 5. UI component tree

```
src/app/dashboard/leads/
  page.tsx                                 (server, modified)
  leads-client.tsx                         (untouched)
  lead-contacts-client.tsx                 (untouched)
  loading.tsx                              (untouched)
  lead-lists-client.tsx                    (NEW — top-level client)
  components/                              (NEW dir)
    lead-lists-sidebar.tsx                 (left rail: lists + "+ New" button)
    new-list-modal.tsx                     (modal: name/description/region/vertical/sub-vertical)
    outscraper-search-form.tsx             (filter form w/ skill defaults)
    cost-preview.tsx                       (volume × $0.0047)
    scrape-status-badge.tsx                (status pill: submitted/polling/downloading/complete/failed)
    lead-list-table.tsx                    (browse leads in selected list)
```

URL conventions:
- `/dashboard/leads?tab=lists` → list-management primary view (NEW DEFAULT)
- `/dashboard/leads?tab=lists&list=<uuid>` → drilled into a list
- `/dashboard/leads?tab=lists&list=<uuid>&view=search|browse` → list inner view (default `search` if no leads, else `browse`)
- `/dashboard/leads?tab=contacts` → existing flat browse (preserved)
- `/dashboard/leads?tab=batches` → existing legacy (preserved)

---

## 6. API route plan

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/leads/lists` | — | `{ lists: LeadList[] }` (org-scoped) |
| POST | `/api/leads/lists` | `{ name, description?, region?, vertical?, sub_vertical?, suggested_filters? }` | `{ list: LeadList }` (201) |
| GET | `/api/leads/lists/[id]` | — | `{ list, latest_task?: OutscraperTask }` |
| PATCH | `/api/leads/lists/[id]` | partial `{ name?, description?, region?, vertical?, sub_vertical?, suggested_filters? }` | `{ list }` |
| POST | `/api/leads/lists/[id]/scrape` | `{ filters: { region, vertical, sub_vertical, location, places_per_query, websites_only, operational_only, language, max_per_query }, estimated_count, estimated_cost_cents }` | `{ task: OutscraperTask }` (201) |
| GET | `/api/leads/lists/[id]/leads?page=&perPage=&search=&email_status=` | — | `{ data: LeadContact[], total, page, totalPages }` |
| GET | `/api/leads/scrapes/[outscraperTaskId]` | — | `{ task, list_total_leads }` (UI polls this) |

**Response envelope:** Existing routes use mixed conventions (`{error}` for failures, raw object for success). New routes follow the same — no breaking change.

**Auth:** Every route resolves internal `org_id` via `auth().orgId → organizations.clerk_org_id` (matches `lead-contacts/route.ts:6-15`).

---

## 7. Worker handler signatures

### `src/worker/handlers/outscraper-task-poll.ts`

```ts
export async function handleOutscraperTaskPoll(payload: { outscraperTaskId: string }): Promise<void>
```

Behavior:
- Look up `outscraper_tasks` by `outscraper_task_id`, skip if status NOT IN ('submitted','polling')
- Call `getTaskStatus(outscraper_task_id)` against Outscraper REST
- `Pending` → update `last_polled_at`, status='polling'
- `Success` → update status='downloading', `results_location`, enqueue `outscraper-task-complete`
- `Error` / 4xx / 5xx → update status='failed', `error_message`, write `system_alerts` row (`alert_type='outscraper_error', severity='warning'`)

### `src/worker/handlers/outscraper-task-complete.ts`

```ts
export async function handleOutscraperTaskComplete(payload: { outscraperTaskId: string }): Promise<void>
```

Behavior:
- Look up `outscraper_tasks` row, must be status='downloading'
- GET `results_location` URL → parse JSON (Outscraper schema: `data: [[...rows]]`)
- For each row: build a `lead_contacts` row with:
  - `org_id, lead_list_id, outscraper_task_id`
  - Map fields per existing `outscraper-service.ts:54-72` (name → business_name, type → business_type, emails_and_contacts.emails[0] → email, etc.)
  - `raw_payload`: full row JSON (for v1b cleaning)
  - `scrape_source='outscraper'`, `email_status='pending'`
- Batch upsert with `onConflict: 'org_id,email', ignoreDuplicates: true` (preserve existing row's verification, don't overwrite)
- Update `outscraper_tasks` status='complete', `actual_count`, `completed_at`
- Update `lead_lists.total_leads` (recount via `SELECT COUNT(*) WHERE lead_list_id=...`), `last_scrape_completed_at`, `last_scrape_status='complete'`
- Write `system_alerts` row (`alert_type='outscraper_task_complete', severity='info'`) with count + list_id

Error handling: all DB failures throw → pg-boss retry (retryLimit=2). `system_alerts` row written on final failure.

### `src/worker/index.ts` registration

Adds 3 entries to `queueNames` array + `boss.work()` registrations + 1 `boss.schedule('outscraper-task-poll-cron', '*/2 * * * *')`.

---

## 8. Tests to add

`src/worker/handlers/__tests__/` and `src/lib/outscraper/__tests__/`:

| Test file | Cases | Assertions |
|---|---|---|
| `src/lib/outscraper/__tests__/client.test.ts` | submit / status / download | 6: URL formed correctly, X-API-KEY header set, async=true present, status response parsed (Pending/Success/Error), results_location returned |
| `src/lib/outscraper/__tests__/cost.test.ts` | cost preview | 3: 100 leads → $0.47, 1000 leads → $4.70, 0 leads → $0 |
| `src/worker/handlers/__tests__/outscraper-task-poll.test.ts` | Pending / Success / Error paths | 6: correct DB updates per status, enqueues complete on Success, writes system_alerts on Error |
| `src/worker/handlers/__tests__/outscraper-task-complete.test.ts` | full insert flow | 5: parses Outscraper rows, inserts with raw_payload populated, lead_list_id + outscraper_task_id set, dedupe on org_id+email, total_leads recounted |
| `src/app/api/leads/lists/__tests__/route.test.ts` | org-scoping | 4: GET returns only org's lists, POST validates name uniqueness, 401 without auth, 400 on missing name |
| `src/app/api/leads/lists/[id]/scrape/__tests__/route.test.ts` | scrape endpoint | 3: creates outscraper_tasks row + submits + returns task_id, 404 on wrong-org list, 400 on missing filters |
| `src/__tests__/migration-023.test.ts` | schema snapshot | 3: lead_lists exists with all columns, outscraper_tasks exists, lead_contacts has new 3 columns + indexes |

**Total: 7 test files, 30 assertions.**

---

## 9. Files to be touched

### NEW (15 files)

```
supabase/migrations/023_leads_v1a_lists.sql
src/lib/outscraper/client.ts
src/lib/outscraper/cost.ts
src/lib/outscraper/__tests__/client.test.ts
src/lib/outscraper/__tests__/cost.test.ts
src/worker/handlers/outscraper-task-poll.ts
src/worker/handlers/outscraper-task-complete.ts
src/worker/handlers/__tests__/outscraper-task-poll.test.ts
src/worker/handlers/__tests__/outscraper-task-complete.test.ts
src/app/api/leads/lists/route.ts
src/app/api/leads/lists/[id]/route.ts
src/app/api/leads/lists/[id]/scrape/route.ts
src/app/api/leads/lists/[id]/leads/route.ts
src/app/api/leads/scrapes/[outscraperTaskId]/route.ts
src/app/dashboard/leads/lead-lists-client.tsx
src/app/dashboard/leads/components/lead-lists-sidebar.tsx
src/app/dashboard/leads/components/new-list-modal.tsx
src/app/dashboard/leads/components/outscraper-search-form.tsx
src/app/dashboard/leads/components/cost-preview.tsx
src/app/dashboard/leads/components/scrape-status-badge.tsx
src/app/dashboard/leads/components/lead-list-table.tsx
src/app/api/leads/lists/__tests__/route.test.ts
src/__tests__/migration-023.test.ts
```

### MODIFY (3 files)

```
src/app/dashboard/leads/page.tsx                     (add 3rd "Lists" tab)
src/lib/supabase/types.ts                            (add LeadList, OutscraperTask, OutscraperFilters types)
src/lib/supabase/queries.ts                          (add getLeadLists, getLeadList, getLeadsInList)
src/worker/index.ts                                  (register 3 new queues + 1 cron)
```

**Total: 18 new + 4 modified = 22 files. Above the 8-file HALT threshold but within the design-doc list (the threshold is "more than 8 OUTSIDE the design-doc list"). All within v1a's locked scope per Dean's directive.**

---

## 10. HALT-conditions surfaced

- ✅ Existing `/dashboard/leads` has substantial functioning code → resolved with EXTEND decision (above)
- ✅ `verification_status` column not on `lead_contacts` → resolved by using existing `email_status`
- ⚠️ `verify-new-leads.ts:148` filters on non-existent `verification_status` column → pre-existing bug, **NOT FIXING** in this scope
- ✅ Outscraper REST async API documented and reachable
- ✅ Migration is purely additive
- ⚠️ Worker has no `DATABASE_URL` direct access from worktree (`.env.local` only has Supabase URL + service role) → migration applied via `psql` over SSH to the worker host (which has `/opt/dashboard-worker/.env`), or via Supabase JS admin client. Decision: SSH + psql in Phase 1.
- ✅ Lead-gen-pipeline skill not installed in this workspace → encode the documented defaults verbatim from the prompt body (140/200 places-per-query, websites_only=true, operational_only=true, language='en', max_per_query=0, $0.0047/lead) directly in `outscraper-search-form.tsx`.

No structural blocker. Proceeding to Phase 1.

---

## Suggested-defaults values (encoded in `outscraper-search-form.tsx`)

```ts
export const OUTSCRAPER_DEFAULTS = {
  places_per_query: 200,    // 200 for broad, 140 for focused — UI defaults to 200
  websites_only: true,
  operational_only: true,
  max_per_query: 0,          // 0 = unlimited per query
  language: 'en',
  format: 'json',            // we parse JSON; CSV is for manual export
  enrichment: ['emails_and_contacts'],
};

export const COST_PER_LEAD_USD = 0.0047;  // blended $0.0047/lead — Hard Lesson budget cap
```

End of design.
