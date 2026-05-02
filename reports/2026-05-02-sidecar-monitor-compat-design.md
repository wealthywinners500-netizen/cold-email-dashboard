# Sidecar monitor-compat — design doc (CC #5b1, V9, 2026-05-02)

## Why this session

CC #5b's Phase-0 HALT exposed that `smtp-connection-monitor` cron uses
`testConnection()` from the worker IP `200.234.226.226` to the panel's port
587 — the EXACT legacy SMTP-AUTH path the sidecar exists to bypass. After 5
consecutive failures it sets `status='disabled'` + `disable_reason=
'smtp_connection_failures'`. Without monitor compatibility, every sidecar-
routed account is fragile: the monitor will cascade-disable it within
~75 min on whatever pre-existing legacy SMTP issues exist, regardless of
sidecar health.

CC #5b1 fixes the architecture in two scoped, code-only changes. CC #5b2
(next session) does the operational work (P20-S2 deploy + reactivation +
flag-flip + smoke) on top of #5b1's foundation.

## Phase 0 ground-truth (verified)

### `src/worker/handlers/smtp-connection-monitor.ts` (256 LOC)

- L29: `const FAILURE_THRESHOLD = 5;` — confirmed.
- L44–49: SELECT from `email_accounts` filtered by `.eq("status","active")`
  — the ONLY filter today.
- L84–90: `testConnection(host, port, secure, user, pass)` — synchronous
  SMTP-AUTH probe from worker IP.
- L211–217: cascade-disable update sets `status:'disabled'`,
  `disable_reason:'smtp_connection_failures'`.
- L122–136 / L167–181: alert insert pattern — `org_id, alert_type,
  severity:'critical', title, details:{...}, account_id`.
- No `id NOT IN <list>` filter exists today. ✅

### `panel-sidecar/index.mjs`

- L143–154: `GET /admin/health` returns 200 with JSON
  `{ status: 'ok', version, uptime_ms }`. Unauthenticated. ✅
- The new cron probes this endpoint and asserts `json.status === 'ok'`.

### `supabase/migrations/008_system_health.sql`

- `system_alerts` columns: `id UUID, org_id TEXT, alert_type VARCHAR(50),
  severity VARCHAR(20), title VARCHAR(255), details JSONB, account_id UUID,
  acknowledged BOOLEAN, acknowledged_at, created_at`. ✅
- Important: `org_id` is `TEXT` (not UUID), per the FK to
  `organizations(id)` which is also TEXT.
- No migration needed. ✅

### `src/worker/index.ts`

- L52–81: `queueNames` array. New `"sidecar-health-monitor"` slots in
  alongside `"smtp-connection-monitor"`.
- L9: existing `import { handleSmtpConnectionMonitor } from
  "./handlers/smtp-connection-monitor";` — mirror with new import.
- L270–280: existing smtp-connection-monitor cron registration. Mirror
  block for new cron, same `*/15 * * * *` cadence.

### `src/lib/email/smtp-manager.ts`

- L53–59: `shouldUseSidecar()` parsing pattern for
  `USE_PANEL_SIDECAR_ACCOUNT_IDS`. CC #5b1 reuses the same parsing inside
  the monitor handler (cannot import the function — handler needs the
  Set, not a per-id boolean predicate).

## Files to create / modify (LOC budget)

| Path | Type | LOC |
|------|------|-----|
| `src/worker/handlers/smtp-connection-monitor.ts` | EDIT | +25 |
| `src/worker/handlers/sidecar-health-monitor.ts` | NEW  | ~145 |
| `src/worker/index.ts` | EDIT | +18 |
| `src/lib/email/__tests__/smtp-manager-sidecar.test.ts` | EDIT | +30 |
| `src/worker/handlers/__tests__/sidecar-health-monitor.test.ts` | NEW | ~210 |
| `package.json` | EDIT | +1 line in `test:gate0` |
| `reports/2026-05-02-sidecar-monitor-compat-{design,deploy}.md` | NEW | docs |

Net: ~430 LOC additions, ~0 deletions.

## New env-var reads (PRODUCTION default empty)

- `USE_PANEL_SIDECAR_ACCOUNT_IDS` — already exists (per CC #5a v2). NEW
  reader: `getSidecarAccountIds()` in
  `src/worker/handlers/smtp-connection-monitor.ts`.
- `SIDECAR_DEPLOYED_HOSTS` — NEW. Read by
  `getSidecarDeployedHosts()` in
  `src/worker/handlers/sidecar-health-monitor.ts`. Comma-separated
  hostnames. Empty → cron is a no-op.

## Verbatim before/after — `smtp-connection-monitor.ts` lines 39–62

### BEFORE

```ts
export async function handleSmtpConnectionMonitor() {
  const supabase = getSupabase();

  try {
    // Fetch all active email accounts
    const { data: accounts, error: fetchError } = await supabase
      .from("email_accounts")
      .select(
        "id, org_id, email, status, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, consecutive_failures, last_error, last_error_at"
      )
      .eq("status", "active");

    if (fetchError) {
      throw new Error(`Failed to fetch email accounts: ${fetchError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log("[smtp-connection-monitor] No active email accounts found");
      return;
    }

    console.log(
      `[smtp-connection-monitor] Testing SMTP connections for ${accounts.length} active accounts`
    );
```

### AFTER

```ts
export async function handleSmtpConnectionMonitor() {
  const supabase = getSupabase();

  try {
    const sidecarIds = getSidecarAccountIds();

    // Fetch all active email accounts
    const { data: rawAccounts, error: fetchError } = await supabase
      .from("email_accounts")
      .select(
        "id, org_id, email, status, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, consecutive_failures, last_error, last_error_at"
      )
      .eq("status", "active");

    if (fetchError) {
      throw new Error(`Failed to fetch email accounts: ${fetchError.message}`);
    }

    // Filter out sidecar-routed accounts: they have a different liveness path
    // (Exim local-pipe, not SMTP-AUTH from worker IP). sidecar-health-monitor
    // probes /admin/health for those hosts instead. Without this skip, the
    // monitor's testConnection() (worker → port 587 SMTP-AUTH) would cascade-
    // disable any sidecar-flagged account on whatever pre-existing legacy
    // SMTP issues exist, defeating the sidecar's purpose at scale.
    const accounts = (rawAccounts || []).filter(
      (a) => !sidecarIds.has(a.id)
    );
    const skippedCount = (rawAccounts?.length || 0) - accounts.length;

    if (skippedCount > 0) {
      console.log(
        `[smtp-connection-monitor] Skipping ${skippedCount} sidecar-routed accounts ` +
        `(USE_PANEL_SIDECAR_ACCOUNT_IDS contains them; sidecar-health-monitor handles their liveness)`
      );
    }

    if (accounts.length === 0) {
      console.log("[smtp-connection-monitor] No active email accounts found");
      return;
    }

    console.log(
      `[smtp-connection-monitor] Testing SMTP connections for ${accounts.length} active accounts`
    );
```

Plus a new helper above `handleSmtpConnectionMonitor()`:

```ts
function getSidecarAccountIds(): Set<string> {
  const raw = process.env.USE_PANEL_SIDECAR_ACCOUNT_IDS || "";
  return new Set(
    raw.split(",").map((s) => s.trim()).filter(Boolean)
  );
}
```

## sidecar-health-monitor.ts algorithm

```
on cron tick:
  hosts ← getSidecarDeployedHosts()  // env: SIDECAR_DEPLOYED_HOSTS
  if hosts.empty: log no-op, return.
  for each host:
    result ← probeSidecarHealth(host)  // GET https://host/admin/health, 5s timeout
    prev   ← failureCounts.get(host) or 0
    if result.ok:
      if prev > 0: log recovery
      failureCounts.set(host, 0)
      continue
    next   ← prev + 1
    failureCounts.set(host, next)
    log warn (next/THRESHOLD)
    if next ≥ FAILURE_THRESHOLD:
      if recentAlertExists(host) within DEDUP_WINDOW: skip
      orgId ← getDefaultOrgId() or null
      if orgId: insert system_alerts row { alert_type: 'sidecar_unhealthy',
                                           severity: 'critical', ... }
```

Constants: `FAILURE_THRESHOLD = 3`, `DEDUP_WINDOW_MINUTES = 60`,
`HEALTH_TIMEOUT_MS = 5000`.

## Alert dedup design

Prompt §0.6 suggested PostgREST JSONB-path filter:
`.eq('details->>host', host)`. The HALT condition (§Phase 1) explicitly
calls out that this MUST be probed before committing.

To avoid that risk and keep this session strictly mechanical, the
implementation uses an **in-memory filter** instead:

```ts
async function recentAlertExists(supabase, host) {
  const since = new Date(Date.now() - DEDUP_WINDOW_MINUTES*60_000).toISOString();
  const { data, error } = await supabase
    .from('system_alerts')
    .select('id, details')
    .eq('alert_type', 'sidecar_unhealthy')
    .gte('created_at', since)
    .limit(50);
  if (error) return false;  // fail-open
  return (data || []).some((row) =>
    (row?.details as Record<string, unknown> | null)?.host === host
  );
}
```

Why safe:
- The candidate set is bounded: `alert_type='sidecar_unhealthy'` AND
  `created_at > now-60min`. At canary scale (≤2 hosts × 1 alert/60min),
  this is ≤2 rows; at 22-panel scale it's ≤22.
- No PostgREST JSONB-syntax dependency.
- Fail-open on query error: better to over-alert than miss a sidecar
  outage.

## Tests (Phase 2 plan)

### `smtp-manager-sidecar.test.ts` (extension, +3 cases)

Source-grep guards on `smtp-connection-monitor.ts`:
1. References `USE_PANEL_SIDECAR_ACCOUNT_IDS`.
2. Defines/uses `getSidecarAccountIds`.
3. Logs the skip message phrase (`Skipping`).
4. Filters via `sidecarIds.has(...)` before the test loop.

### `sidecar-health-monitor.test.ts` (NEW, ~12 cases)

Pure helper tests + a tiny in-process http server fixture:
- `getSidecarDeployedHosts()` × 4: empty, single, multi, whitespace-tolerant.
- `probeSidecarHealth()` × 4 against a 127.0.0.1:0 fixture:
  - 200 + `{status:"ok",...}` → `{ok:true}`.
  - 200 + `{status:"degraded"}` → `{ok:false, error:'bad payload...'}`.
  - 503 → `{ok:false, error:'HTTP 503'}`.
  - hung-server (5.5s no response) → `{ok:false, error:contains 'abort'}`.
- Source-greps:
  - `FAILURE_THRESHOLD = 3` and `DEDUP_WINDOW_MINUTES = 60`.
  - Inserts to `system_alerts` with `alert_type: 'sidecar_unhealthy'`.
  - `worker/index.ts` registers `"sidecar-health-monitor"` queue and
    schedules `*/15 * * * *`.
  - `worker/index.ts` imports `handleSidecarHealthMonitor`.

The fixture binds to 127.0.0.1:0 (random port), passes URL via a small
internal `_probeSidecarHealthAt(url)` exported helper that takes the full
URL (the public `probeSidecarHealth(host)` builds `https://${host}/...`).
`probeSidecarHealth` itself remains the production entry point;
`_probeSidecarHealthAt` exists ONLY for tests so the fixture can use http://.

To wire into `test:gate0`, append:
`tsx src/worker/handlers/__tests__/sidecar-health-monitor.test.ts` at the
end of the existing `&& tsx ... smtp-manager-sidecar.test.ts` chain in
`package.json`.

## Migration needed

**NO.** Both env vars are runtime-config only. `system_alerts` schema is
unchanged (new `alert_type` value `'sidecar_unhealthy'` is just data, not
schema — column type is `VARCHAR(50)`).

## Risks + mitigations

| Risk | Mitigation |
|------|------------|
| In-memory `failureCounts` resets on worker restart, possibly missing the 3rd consecutive failure | Acceptable for canary. After CC #5c rollout, a future CC may persist counters in a small table. |
| `getDefaultOrgId()` picks the first org by insertion order — wrong org for multi-org alerts | Canary has a single StealthMail org. Documented as a follow-up for CC #4.5 / #5c. |
| `recentAlertExists` fail-open triggers duplicate alerts on transient PostgREST errors | Better to over-alert than miss sidecar outage. Severity is critical → operator-paged anyway, dedup-by-eyeball. |
| 5s health-probe timeout might be tight under load | Conservative; 95th percentile of `/admin/health` is sub-100ms (no work). 5s is generous. |
| `boss.schedule` for new queue requires `boss.createQueue` first (pg-boss v12) | Adding `"sidecar-health-monitor"` to `queueNames` array ensures `createQueue` runs before `schedule`. Mirror existing pattern. |

## Production behavior change at merge

**ZERO.** Both env vars (`USE_PANEL_SIDECAR_ACCOUNT_IDS` AND
`SIDECAR_DEPLOYED_HOSTS`) are empty by default in the worker .env.
- smtp-connection-monitor: `sidecarIds` is empty Set → filter is no-op
  → behavior identical to today.
- sidecar-health-monitor: `hosts` is empty array → cron logs no-op message
  and returns immediately. Zero side-effects.

CC #5b2 sets the env vars during P20-S2 deploy.
