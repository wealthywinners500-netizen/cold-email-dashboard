// CC #UI-4 (2026-05-02): org-scoped list endpoint for subsequences.
// Joins campaigns(name) for display in /dashboard/follow-ups Subsequences tab.
// Per-campaign attachment preserved in this CC; CC #UI-5 will migrate to true
// org-scoped (campaign_id nullable + applies_to_campaigns + applies_to_tags).

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

export async function GET(_req: Request) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("campaign_sequences")
      .select(
        "id, org_id, name, persona, trigger_event, trigger_condition, trigger_priority, campaign_id, status, created_at, updated_at, sequence_type, steps, sort_order, campaigns(name)"
      )
      .eq("org_id", orgId)
      .eq("sequence_type", "subsequence")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (_e) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
