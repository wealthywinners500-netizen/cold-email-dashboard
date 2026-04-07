import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { searchBusinesses } from "@/lib/leads/outscraper-service";

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

export async function POST(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await request.json();
    const { query, location, limit = 50 } = body;

    if (!query || !location) {
      return NextResponse.json(
        { error: "query and location are required" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const supabase = await createAdminClient();

    // Get organization integrations
    const { data: org } = await supabase
      .from("organizations")
      .select("integrations")
      .eq("id", orgId)
      .single();

    const integrations = (org?.integrations || {}) as Record<string, string>;
    const apiKey = integrations.outscraper_api_key;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Outscraper API key not configured. Go to Settings > Integrations." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Search businesses via Outscraper
    const { results, raw_count } = await searchBusinesses(apiKey, query, location, limit);

    // Filter results that have an email
    const withEmail = results.filter((r) => r.email);

    // Check existing emails in this org for dedup
    const emails = withEmail.map((r) => r.email!);
    const { data: existing } = await supabase
      .from("lead_contacts")
      .select("email")
      .eq("org_id", orgId)
      .in("email", emails);

    const existingSet = new Set((existing || []).map((e: any) => e.email));

    const newContacts = withEmail.filter((r) => !existingSet.has(r.email!));
    const duplicates = withEmail.length - newContacts.length;

    // Insert new contacts
    let imported = 0;
    if (newContacts.length > 0) {
      const rows = newContacts.map((r) => ({
        org_id: orgId,
        business_name: r.business_name || null,
        business_type: r.business_type || null,
        email: r.email,
        phone: r.phone || null,
        website: r.website || null,
        city: r.city || null,
        state: r.state || null,
        zip: r.zip || null,
        country: r.country || 'US',
        google_rating: r.google_rating ?? null,
        google_reviews_count: r.google_reviews_count ?? null,
        google_place_id: r.google_place_id || null,
        scrape_source: 'outscraper',
        scrape_query: r.scrape_query || null,
        scraped_at: r.scraped_at || new Date().toISOString(),
        email_status: 'pending',
      }));

      const { data: inserted, error: insertErr } = await supabase
        .from("lead_contacts")
        .upsert(rows, { onConflict: 'org_id,email', ignoreDuplicates: false })
        .select();

      if (!insertErr) {
        imported = inserted?.length || 0;
      }
    }

    // Also insert results without emails (for phone-only contacts)
    const noEmail = results.filter((r) => !r.email && r.business_name);
    if (noEmail.length > 0) {
      const phoneRows = noEmail.map((r) => ({
        org_id: orgId,
        business_name: r.business_name || null,
        business_type: r.business_type || null,
        phone: r.phone || null,
        website: r.website || null,
        city: r.city || null,
        state: r.state || null,
        zip: r.zip || null,
        country: r.country || 'US',
        google_rating: r.google_rating ?? null,
        google_reviews_count: r.google_reviews_count ?? null,
        google_place_id: r.google_place_id || null,
        scrape_source: 'outscraper',
        scrape_query: r.scrape_query || null,
        scraped_at: r.scraped_at || new Date().toISOString(),
        email_status: 'pending',
      }));

      await supabase.from("lead_contacts").insert(phoneRows);
      imported += phoneRows.length;
    }

    return NextResponse.json(
      { found: raw_count, imported, duplicates },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error searching businesses:", error);
    return NextResponse.json(
      { error: "Failed to search businesses" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
