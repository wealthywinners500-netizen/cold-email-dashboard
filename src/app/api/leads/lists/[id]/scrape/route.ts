// V1a: trigger an async Outscraper scrape for a list. Submits the task,
// records it in outscraper_tasks (status='submitted'), updates the list's
// last_scrape_started_at, and returns the task id. The worker cron picks
// it up within ~2 minutes.
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { submitMapsSearchTask } from "@/lib/outscraper/client";
import { estimateCostCents } from "@/lib/outscraper/cost";
import { getLeadList } from "@/lib/supabase/queries";
import type { OutscraperFilters } from "@/lib/supabase/types";

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();
  return data?.id || null;
}

interface ScrapeBody {
  filters?: Partial<OutscraperFilters>;
  estimated_count?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OUTSCRAPER_API_KEY not configured on the server" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const { id: listId } = await params;
  const list = await getLeadList(orgId, listId);
  if (!list) {
    return NextResponse.json(
      { error: "List not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: ScrapeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const f = body.filters || {};
  const query = (f.query || "").trim();
  if (!query) {
    return NextResponse.json(
      { error: "filters.query is required (e.g. 'senior care, Atlanta GA')" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Resolved filters with skill defaults.
  const resolved: OutscraperFilters = {
    query,
    location: (f.location || "").trim(),
    region: f.region || list.region || undefined,
    vertical: f.vertical || list.vertical || undefined,
    sub_vertical: f.sub_vertical || list.sub_vertical || undefined,
    places_per_query:
      typeof f.places_per_query === "number" && f.places_per_query > 0
        ? Math.min(f.places_per_query, 1000)
        : 200,
    websites_only: f.websites_only !== false,
    operational_only: f.operational_only !== false,
    language: f.language || "en",
    max_per_query: typeof f.max_per_query === "number" ? f.max_per_query : 0,
    enrichment:
      Array.isArray(f.enrichment) && f.enrichment.length > 0
        ? f.enrichment
        : ["emails_and_contacts"],
  };

  const estimatedCount =
    typeof body.estimated_count === "number" && body.estimated_count > 0
      ? Math.floor(body.estimated_count)
      : resolved.places_per_query;
  const estimatedCostCents = estimateCostCents(estimatedCount);

  let submitResult;
  try {
    submitResult = await submitMapsSearchTask(apiKey, resolved);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/leads/lists/scrape] submit failed:", msg);
    return NextResponse.json(
      { error: `Outscraper submit failed: ${msg.slice(0, 200)}` },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: taskRow, error: taskErr } = await supabase
    .from("outscraper_tasks")
    .insert({
      org_id: orgId,
      lead_list_id: listId,
      outscraper_task_id: submitResult.outscraperTaskId,
      status: "submitted",
      filters: resolved,
      estimated_count: estimatedCount,
      estimated_cost_cents: estimatedCostCents,
    })
    .select()
    .single();

  if (taskErr || !taskRow) {
    console.error("[/api/leads/lists/scrape] persist failed:", taskErr);
    return NextResponse.json(
      { error: "Outscraper task submitted but failed to persist locally" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  await supabase
    .from("lead_lists")
    .update({
      last_scrape_status: "submitted",
      last_scrape_started_at: nowIso,
      last_scrape_error: null,
      updated_at: nowIso,
    })
    .eq("id", listId)
    .eq("org_id", orgId);

  return NextResponse.json(
    { task: taskRow },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
