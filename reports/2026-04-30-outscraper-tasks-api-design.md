# Outscraper /tasks API rewrite — Design Doc (Phase 0)

**Author:** V8 CC autonomous session — 2026-04-30
**Branch:** `claude/nice-cerf-f10787` → push as `fix/outscraper-tasks-api-contacts-n-leads-2026-04-30`
**Worktree:** `dashboard-app/.claude/worktrees/nice-cerf-f10787`
**Pre-state SHA:** `032d084` (post Reoon merge, main)

---

## 1. Why this rewrite

V1a (PR #30, merged `d6021a0`) shipped `src/lib/outscraper/client.ts` calling `GET https://api.app.outscraper.com/maps/search-v3?async=true&enrichment=emails_and_contacts`. **Three smokes returned 0/45 emails.** Dean produced the proven curl from "Atlanta Medical Practices v2" (16,824 leads) — the proven shape is `POST https://api.outscraper.cloud/tasks` with `service_name=google_maps_service_v2` + `enrichments=["contacts_n_leads"]`. V1a chose the wrong host, wrong path, wrong method, wrong enrichment id, and a parser keyed off `emails_and_contacts.emails[]` (not present on the proven response).

This session ports the Outscraper subsystem to the proven shape end-to-end and re-smokes against `30309 dentist` for direct comparability with V1a's 0/10.

## 2. Live-API probe (Phase 0a–0c, 2026-04-30 ~22:57Z)

### 2a. Submit

```
POST https://api.outscraper.cloud/tasks
X-API-KEY: <redacted>
Content-Type: application/json

body: trimmed-to-smoke-scale of Dean's verbatim curl
  - categories=["dentist"]
  - locations=["30309"]
  - useZipCodes=true
  - organizationsPerQueryLimit=10
  - limit=0
  - ignoreWithoutEmails=true
  - dropEmailDuplicates=true
  - enrichments=["contacts_n_leads"]
  - enrichments_kwargs.contacts_n_leads.preferred_contacts=["decision makers","operations","marketing","sales"]  (4 — finance dropped per Dean 2026-04-30)
  - filters=[{exclusiveGroup:"site_existence",key:"website",operator:"is not blank",value:null},{key:"business_status",operator:"equals",value:["operational"]}]
  - settings.output_extension="json"
  - service_name="google_maps_service_v2"
  - customer_email/id/tags/title/region/language/queries_amount/est all populated
  - user_id OMITTED (prompt said use OUTSCRAPER_API_KEY prefix-before-pipe but our key has no pipe; API derived user_id from X-API-KEY)
```

**Response (HTTP 200):**

```json
{
  "id": "YmE4MTAwZTdkYmVjNGQ0ODg5NjAzN2IwYWJjODAyYmMsMjAyNjA0MzAyMjU3NTVzNzI",
  "is_first_task": false,
  "ui_task_id": "20260430225755s72"
}
```

The opaque `id` decodes from base64 to `<user_id>,<ui_task_id>` — confirms Dean's user_id `ba8100e7dbec4d48896037b0abc802bc` is bound to our API key (we don't need to send it).

### 2b. Poll

```
GET https://api.outscraper.cloud/requests/<id>
X-API-KEY: <redacted>
```

**Response (HTTP 200, immediate):**

```json
{
  "id": "20260430225755s72",
  "status": "Success",
  "results_location": null,
  "data": [ /* 23 flat row objects */ ]
}
```

`/requests/<id>` works on first try — no need to fall back to `/tasks/<id>`. Task completed sub-second; one poll was enough at smoke scale (production volume tasks will need the existing 2-minute cron). `results_location` is `null` — **data is INLINE** in the poll body; the existing `inline:<taskId>` sentinel in `downloadResults` already covers this.

### 2c. Fill rate (Phase 0e gate)

| Metric | Count | % |
|---|---|---|
| Rows total | 23 | 100% |
| Rows with `email` | **23** | **100%** |
| Rows with `first_name + last_name` | 12 | 52% |
| Rows with `full_name` | 12 | 52% |
| Rows with `owner_title` (business owner role title — populated for ALL rows but always equals the business name, not a real title) | 23 | 100% |

**Phase 0e gate:** ≥30% email-fill required. **HARD PASS — 100%.** PROCEED.

## 3. Critical shape finding (deviates from prompt's assumption)

The prompt assumed each business row would have a `contacts[]` array of decision-makers. **Reality: the API returns one already-flattened row per (place × matched contact).** A place with 3 matched decision-makers appears as 3 separate rows (same `place_id`, different `email/first_name/last_name`).

Example — "Dentistry for Midtown Atlanta" appears as 3 consecutive rows with emails `jmotherhsed@aol.com / beth@dentistryformidtown.com / laura@dentistryformidtown.com` and matching first/last names. This means:

- **No `contacts[]` array to iterate.** The mapper reads `row.email`, `row.first_name`, `row.last_name` directly.
- **Place-level dedup happens via `lead_contacts UNIQUE(org_id, email)`.** Multiple rows for the same place insert as separate contacts (different emails). This is the desired behavior — we want every decision-maker for outreach.
- **The `dropEmailDuplicates=true` flag** is what guarantees email uniqueness within a single task.

## 4. Verbatim row shape (Phase 0d)

86 keys per row (full list in §4a). Fields material to the mapper:

| Field | Type | Sample value | Maps to lead_contacts |
|---|---|---|---|
| `name` | string | "Dentistry for Midtown Atlanta" | `business_name` |
| `name_for_emails` | string | "Dentistry for Midtown Atlanta" | (audit; HL #40) |
| `email` | string \| null | "beth@dentistryformidtown.com" | `email` |
| `first_name` | string \| null | "Beth" | `first_name` (NEW) |
| `last_name` | string \| null | "Butler" | `last_name` (NEW) |
| `full_name` | string \| null | "Beth Butler" | (fallback) |
| `category` | string | "Dentist" | `business_type` |
| `subtypes` | string | "Dental clinic, Cosmetic dentist" | `business_type` (fallback) |
| `phone` | string \| null | "+1 404-872-6242" | `phone` |
| `website` | string \| null | "https://dentistryformidtown.com/" | `website` |
| `domain` | string | "dentistryformidtown.com" | (audit) |
| `address` | string | "229 Peachtree St NE Suite 200, Atlanta, GA 30303" | `full_address` (was `full_address` in old shape) |
| `city`, `state`, `state_code`, `postal_code`, `country`, `country_code` | string | — | `city/state/zip/country` |
| `rating`, `reviews` | number | — | `google_rating/google_reviews_count` |
| `place_id` | string | "ChIJ..." | `google_place_id` |
| `business_status` | string | "OPERATIONAL" | (filter check) |

**Position field:** No clean "contact title" field exists. `owner_title` always equals the business name (not a job title). Decision: **`position = null`** in the mapper; v1b cleaning may derive from email-username heuristics. Not in scope here.

### 4a. Full key list (86)
`about, address, area_service, booking_appointment_link, business_status, category, cid, city, company_facebook, company_instagram, company_linkedin, company_name, company_phone, company_phones, company_x, company_youtube, contact_facebook, contact_instagram, contact_linkedin, contact_phone, contact_phones, contact_x, country, country_code, county, description, domain, email, first_name, full_name, google_id, h3, kgmid, last_name, latitude, located_google_id, located_in, location_link, location_reviews_link, logo, longitude, menu_link, name, name_for_emails, order_links, other_hours, owner_id, owner_link, owner_title, phone, photo, photos_count, place_id, plus_code, popular_times, postal_code, posts, prices, query, range, rating, reservation_links, reviews, reviews_id, reviews_link, reviews_per_score, reviews_per_score_1..5, reviews_tags, source, state, state_code, street, street_view, subtypes, time_zone, title, type, typical_time_spent, verified, website, website_description, website_generator, website_has_fb_pixel, website_has_gtm, website_title, working_hours, working_hours_csv_compatible`

(Field `full_address` from V1a's old shape is **gone** — replaced by `address`. Mapper updated.)

## 5. Before/after request shape

| Aspect | V1a (was) | V8 (now) |
|---|---|---|
| Host | `api.app.outscraper.com` | `api.outscraper.cloud` |
| Path | `/maps/search-v3?async=true` | `/tasks` |
| Method | GET | POST |
| Body | URL query params | JSON |
| Auth header | `X-API-KEY` | `X-API-KEY` (unchanged) |
| Enrichment id | `emails_and_contacts` (URL param) | `contacts_n_leads` (in `enrichments[]`) |
| Service name | n/a | `google_maps_service_v2` |
| Decision-maker contacts filter | n/a | `enrichments_kwargs.contacts_n_leads.preferred_contacts=["decision makers","operations","marketing","sales"]` |
| Operational/website filters | URL params `dropDuplicates`, `skipPlacesWithoutWebsite` | structured `filters[]` array |
| Geographic input | `query="dentist, Atlanta GA"` | `categories=["dentist"]` + `locations=["30309",...]` + `useZipCodes=true` |
| Per-place cap | `limit=200` | `organizationsPerQueryLimit=200`, `limit=0` |
| Submit response | `{id, status:"Pending"}` | `{id, is_first_task, ui_task_id}` |

## 6. Before/after parser shape

| Layer | V1a (was) | V8 (now) |
|---|---|---|
| Poll URL | `/requests/<id>` (HTTP 202 = pending; JSON `{status, results_location}` on success) | `/requests/<id>` (returns `{status, data, results_location:null}` immediately when complete) |
| Status string | `"Success" / "Pending" / "Error"` | `"Success" / "Pending" / "Error"` (verified `Success`; pending/error to be confirmed in production runs) |
| Results location | `https://results.outscraper.com/abc.json` URL | `null` — data inline in poll body |
| Inline sentinel | `inline:<taskId>` already implemented | re-uses same sentinel; `downloadResults` re-GETs and reads `data` directly |
| Data shape | nested: `data: [[row,row,...],[row,row,...]]` (outer=queries, inner=rows) | flat: `data: [row,row,...]` (one row per place×contact) |
| Email path | `row.emails_and_contacts.emails[0]` | `row.email` |
| Contact name | n/a | `row.first_name`, `row.last_name` |
| Address path | `row.full_address` | `row.address` |
| Subtypes | `row.subtypes: string[] \| string` | `row.subtypes: string` (single comma-separated) |

The existing `downloadResults` flattening loop (`if Array.isArray(queryGroup)... else if object`) already handles BOTH legacy nested shape AND new flat shape. We simplify to just-flat in V8 since the legacy code path is being deleted.

## 7. UI form changes

| Field | V1a (was) | V8 (now) |
|---|---|---|
| "Search query" (free text) | combined `"vertical, location"` string | **REMOVED** |
| "Location" (free text) | combined w/ query | **REMOVED** |
| **Categories** (NEW) | n/a | comma-split string → `string[]` (e.g. `"dentist, doctor"` → `["dentist","doctor"]`) |
| **ZIP codes** (NEW) | n/a | comma-split string → `string[]` (helper text: "Use ZIP codes — never city names") |
| Places per query | input → `places_per_query` | renamed **Per-zip cap** → `organizations_per_query_limit` (default 200) |
| Websites only | checkbox | **REMOVED** — always on (hard-coded in `filters[]`) |
| Operational only | checkbox | **REMOVED** — always on (hard-coded in `filters[]`) |
| Language | select | unchanged |
| **Decision-maker types** (NEW) | n/a | multi-select with default 4 (decision makers, operations, marketing, sales) |
| Cost preview | `places_per_query × $0.0047` | `len(categories) × len(locations) × organizations_per_query_limit × $0.0047` |

## 8. Phase 0 GO/NO-GO

- ✅ 0a Submit responded HTTP 200 with task `id`
- ✅ 0b Poll at `/requests/<id>` returned `Success` with inline `data` (no `/tasks/<id>` fallback needed)
- ✅ 0c Full response captured at `/tmp/v8probe/poll1.json` (23 rows × 86 keys each)
- ✅ 0d Shape audited (§4)
- ✅ 0e Fill-rate gate: 23/23 emails (100% ≫ 30% threshold)
- ✅ 0f JSON output accepted; no CSV parser needed
- ✅ 0g Before/after request shape (§5)
- ✅ 0h Before/after parser shape (§6)
- ✅ 0i **PROCEED to Phase 1**

**Phase 0 spend:** 1 submit (1 ZIP × 10 places × 1.7 contacts ≈ 17 leads-equivalent × $0.003 ≈ $0.05). Well under the $0.30 cap.
