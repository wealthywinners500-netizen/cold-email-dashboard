// Per-subsystem hands-free health snapshot.
// Anonymous callers get coarse per-subsystem status ('ok' | 'degraded' | 'down'
// | 'unknown'). Authenticated org admins get the richer payload with last_run
// timestamps when we can read them.
//
// Session 06 is expected to land a proper hands_free_job_status table. Until
// then we best-effort query system_alerts (a live table, see migration 008)
// for recent critical entries and fall back to 'unknown' per subsystem.

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubsystemStatus = "ok" | "degraded" | "down" | "unknown";

const SUBSYSTEMS = [
  "cron",
  "worker",
  "snov_sync",
  "blacklist_watcher",
  "domain_health_probe",
] as const;

type SubsystemKey = (typeof SUBSYSTEMS)[number];

interface SubsystemDetail {
  status: SubsystemStatus;
  last_run?: string;
  last_error?: string;
}

function worstOf(statuses: SubsystemStatus[]): SubsystemStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  if (statuses.every((s) => s === "ok")) return "ok";
  return "unknown";
}

async function readSubsystemStatuses(): Promise<Record<SubsystemKey, SubsystemDetail>> {
  const result = Object.fromEntries(
    SUBSYSTEMS.map((s) => [s, { status: "unknown" as SubsystemStatus }])
  ) as Record<SubsystemKey, SubsystemDetail>;

  try {
    const supabase = await createAdminClient();
    // Look for recent critical hands-free alerts in the last 15 minutes.
    // If we see one tagged to a subsystem, flag that subsystem 'down'.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: alerts } = await supabase
      .from("system_alerts")
      .select("alert_type, severity, metadata, created_at")
      .gte("created_at", since)
      .eq("severity", "critical")
      .limit(50);

    for (const a of alerts ?? []) {
      const meta = (a.metadata ?? {}) as Record<string, unknown>;
      const subsystem = (meta.subsystem as SubsystemKey | undefined) ?? undefined;
      if (subsystem && subsystem in result) {
        result[subsystem] = {
          status: "down",
          last_error: (meta.message as string | undefined) ?? a.alert_type,
        };
      }
    }
  } catch {
    // Fall through with all 'unknown'. /api/health is for hard liveness;
    // we never want this endpoint to 500 on a transient DB hiccup.
  }

  return result;
}

export async function GET() {
  const { orgRole } = await auth().catch(() => ({ orgRole: null as string | null }));
  const isAdmin = orgRole === "org:admin";

  const detailed = await readSubsystemStatuses();
  const overall = worstOf(SUBSYSTEMS.map((s) => detailed[s].status));

  const coarse: Record<SubsystemKey, SubsystemStatus> = Object.fromEntries(
    SUBSYSTEMS.map((s) => [s, detailed[s].status])
  ) as Record<SubsystemKey, SubsystemStatus>;

  return NextResponse.json(
    {
      subsystems: isAdmin ? detailed : coarse,
      overall,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
