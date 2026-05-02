// CC #5b1 (V9, 2026-05-02): Sidecar liveness monitor.
//
// Probes GET https://<host>/admin/health for every host in env
// SIDECAR_DEPLOYED_HOSTS (comma-separated). On 3 consecutive failures
// per host, inserts a critical row into system_alerts with
// alert_type='sidecar_unhealthy' (60-min dedup window).
//
// ALERTS ONLY — does NOT auto-disable accounts. The legacy
// smtp-connection-monitor's cascade-disable path is wrong for
// sidecar-routed accounts (they don't authenticate over SMTP at all)
// and was the architectural risk that motivated this whole compat layer.
//
// Failure counter is in-memory (per-handler-invocation acceptable for
// canary scale). After CC #5c rollout, a future CC may persist counters
// in a small table if needed.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface SystemAlert {
  org_id: string;
  alert_type: string;
  severity: string;
  title: string;
  details: Record<string, unknown>;
}

const FAILURE_THRESHOLD = 3;
const DEDUP_WINDOW_MINUTES = 60;
const HEALTH_TIMEOUT_MS = 5000;

const failureCounts = new Map<string, number>();

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export function getSidecarDeployedHosts(): string[] {
  const raw = process.env.SIDECAR_DEPLOYED_HOSTS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Probe an explicit URL — exists for tests so the http://127.0.0.1:<port>
// fixture can exercise the production timeout/parse logic. Production
// callers use `probeSidecarHealth(host)` which builds the https:// URL.
export async function _probeSidecarHealthAt(
  url: string
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => null);
    if (!json || (json as Record<string, unknown>).status !== "ok") {
      const sample = JSON.stringify(json).slice(0, 100);
      return { ok: false, error: `bad payload: ${sample}` };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeSidecarHealth(
  host: string
): Promise<{ ok: boolean; error?: string }> {
  return _probeSidecarHealthAt(`https://${host}/admin/health`);
}

async function recentAlertExists(
  supabase: SupabaseClient,
  host: string
): Promise<boolean> {
  const since = new Date(
    Date.now() - DEDUP_WINDOW_MINUTES * 60_000
  ).toISOString();
  // In-memory filter on details.host instead of PostgREST JSONB-path
  // (.eq('details->>host', host)) — the candidate set is tightly bounded
  // by alert_type+time so it's at most a handful of rows. Avoids a
  // PostgREST-syntax dependency that varies across deployments.
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id, details")
    .eq("alert_type", "sidecar_unhealthy")
    .gte("created_at", since)
    .limit(50);
  if (error) {
    console.error(
      `[sidecar-health-monitor] dedup query failed: ${error.message}`
    );
    // fail-open: better to over-alert than miss a sidecar outage
    return false;
  }
  return (data || []).some(
    (row) => (row?.details as Record<string, unknown> | null)?.host === host
  );
}

async function getDefaultOrgId(
  supabase: SupabaseClient
): Promise<string | null> {
  // Canary stage has a single StealthMail org; first row is sufficient.
  // CC #4.5 will add proper multi-org reconciliation; until then the
  // alert is broadcast under the canary org.
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  if (error || !data) {
    console.error(
      `[sidecar-health-monitor] no org_id available; cannot insert alert`
    );
    return null;
  }
  return data.id as string;
}

export async function handleSidecarHealthMonitor() {
  const hosts = getSidecarDeployedHosts();
  if (hosts.length === 0) {
    console.log(
      "[sidecar-health-monitor] SIDECAR_DEPLOYED_HOSTS empty; no-op"
    );
    return;
  }

  const supabase = getSupabase();
  console.log(
    `[sidecar-health-monitor] Probing ${hosts.length} hosts: ${hosts.join(", ")}`
  );

  for (const host of hosts) {
    const result = await probeSidecarHealth(host);
    const prev = failureCounts.get(host) || 0;

    if (result.ok) {
      if (prev > 0) {
        console.log(
          `[sidecar-health-monitor] ${host} recovered (was at ${prev} consecutive failures)`
        );
      }
      failureCounts.set(host, 0);
      continue;
    }

    const next = prev + 1;
    failureCounts.set(host, next);
    console.warn(
      `[sidecar-health-monitor] ${host} unhealthy (${next}/${FAILURE_THRESHOLD}): ${result.error}`
    );

    if (next < FAILURE_THRESHOLD) continue;

    const dedupHit = await recentAlertExists(supabase, host);
    if (dedupHit) {
      console.log(
        `[sidecar-health-monitor] ${host} alert deduped (recent within ${DEDUP_WINDOW_MINUTES}min)`
      );
      continue;
    }

    const orgId = await getDefaultOrgId(supabase);
    if (!orgId) continue;

    const alert: SystemAlert = {
      org_id: orgId,
      alert_type: "sidecar_unhealthy",
      severity: "critical",
      title: `Panel sidecar unhealthy: ${host}`,
      details: {
        host,
        consecutive_failures: next,
        threshold: FAILURE_THRESHOLD,
        last_error: result.error,
      },
    };

    const { error: insertErr } = await supabase
      .from("system_alerts")
      .insert(alert);
    if (insertErr) {
      console.error(
        `[sidecar-health-monitor] insert alert failed: ${insertErr.message}`
      );
    } else {
      console.log(
        `[sidecar-health-monitor] CRITICAL alert inserted for ${host}`
      );
    }
  }
}

// Test-only — clears the in-memory failureCounts map between unit tests so
// each test starts from a known state. Production code never calls this.
export function _resetFailureCountsForTest(): void {
  failureCounts.clear();
}
