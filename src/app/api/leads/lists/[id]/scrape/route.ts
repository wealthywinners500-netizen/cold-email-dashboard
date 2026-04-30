// V1a + V8: trigger an async Outscraper scrape for a list. Submits the task,
// records it in outscraper_tasks (status='submitted'), updates the list's
// last_scrape_started_at, and returns the task id. The worker cron picks
// it up within ~2 minutes.
//
// V8 (2026-04-30): rewrote filter resolution to the /tasks API shape —
// categories[] + locations[] + use_zip_codes + organizations_per_query_limit
// + preferred_contacts. Drops legacy single-string `query` from the wire
// format; UI form may still pre-populate legacy fields from suggested_filters
// for one cycle.
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { submitMapsSearchTask } from "@/lib/outscraper/client";
import { estimateCostCents } from "@/lib/outscraper/cost";
import { getLeadList } from "@/lib/supabase/queries";
import type { OutscraperFilters } from "@/lib/supabase/types";

const DEFAULT_PREFERRED_CONTACTS = [
  "decision makers",
  "operations",
  "marketing",
  "sales",
];

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

function asStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
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
  const categories = asStringArray(
    f.categories ?? (typeof f.query === "string" ? f.query : undefined)
  );
  const locations = asStringArray(
    f.locations ?? (typeof f.location === "string" ? f.location : undefined)
  );

  if (categories.length === 0) {
    return NextResponse.json(
      { error: "filters.categories must be a non-empty string array (e.g. ['dentist'])" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (locations.length === 0) {
    return NextResponse.json(
      { error: "filters.locations must be a non-empty string array of ZIP codes (e.g. ['30309'])" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const orgsPerQuery =
    typeof f.organizations_per_query_limit === "number" &&
    f.organizations_per_query_limit > 0
      ? Math.min(f.organizations_per_query_limit, 1000)
      : 200;

  const preferredContacts =
    Array.isArray(f.preferred_contacts) && f.preferred_contacts.length > 0
      ? f.preferred_contacts.map((s) => String(s).trim()).filter((s) => s.length > 0)
      : DEFAULT_PREFERRED_CONTACTS;

  const resolved: OutscraperFilters = {
    categories,
    locations,
    use_zip_codes: f.use_zip_codes !== false,
    ignore_without_emails: f.ignore_without_emails !== false,
    drop_email_duplicates: f.drop_email_duplicates !== false,
    organizations_per_query_limit: orgsPerQuery,
    limit: typeof f.limit === "number" ? f.limit : 0,
    preferred_contacts: preferredContacts,
    region: f.region || list.region || undefined,
    vertical: f.vertical || list.vertical || undefined,
    sub_vertical: f.sub_vertical || list.sub_vertical || undefined,
    language: f.language || "en",
  };

  const queries = categories.length * locations.length;
  const blendedLeadEstimate = queries * orgsPerQuery;
  const estimatedCount =
    typeof body.estimated_count === "number" && body.estimated_count > 0
      ? Math.floor(body.estimated_count)
      : blendedLeadEstimate;
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
