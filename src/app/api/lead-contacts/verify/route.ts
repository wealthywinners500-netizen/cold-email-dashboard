import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { verifyBatch } from "@/lib/leads/verification-service";
import { rateLimit } from "@/lib/rate-limit";

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
  // Rate limit: 20 requests per IP per minute
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`verify:${ip}`, 20)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await request.json();
    const { contact_ids, filter } = body;

    const supabase = await createAdminClient();

    // Get organization integrations
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("integrations")
      .eq("id", orgId)
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: "Failed to fetch organization" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Extract Reoon API key
    const reoon_api_key = org.integrations?.reoon_api_key;
    if (!reoon_api_key) {
      return NextResponse.json(
        {
          error:
            "Reoon API key not configured. Please configure it in Settings > Integrations.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Fetch contacts based on contact_ids or filter
    let contactsQuery = supabase
      .from("lead_contacts")
      .select()
      .eq("org_id", orgId);

    if (contact_ids && contact_ids.length > 0) {
      contactsQuery = contactsQuery.in("id", contact_ids);
    } else if (filter) {
      if (filter.email_status) {
        contactsQuery = contactsQuery.eq("email_status", filter.email_status);
      }
      if (filter.state) {
        contactsQuery = contactsQuery.eq("state", filter.state);
      }
      if (filter.city) {
        contactsQuery = contactsQuery.eq("city", filter.city);
      }
    }

    const { data: contacts, error: fetchError } = await contactsQuery;

    if (fetchError || !contacts) {
      return NextResponse.json(
        { error: "Failed to fetch contacts" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Get emails and filter out nulls
    const emails = contacts
      .filter((c: { id: string; email: string | null }) => c.email)
      .map((c: { id: string; email: string | null }) => ({ id: c.id, email: c.email as string }));

    if (emails.length === 0) {
      return NextResponse.json(
        { verified: 0, valid: 0, invalid: 0, risky: 0 },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Guard: max 5000 contacts per request
    if (emails.length > 5000) {
      return NextResponse.json(
        { error: "Maximum 5000 contacts per verification request" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Verify batch
    const verificationResults = await verifyBatch(
      reoon_api_key,
      emails.map((e: { id: string; email: string }) => e.email)
    );

    // Build email-to-result map
    const resultMap = new Map<string, string>();
    for (const r of verificationResults) {
      resultMap.set(r.email, r.email_status);
    }

    // Update contacts with verification results — batched for performance
    const now = new Date().toISOString();
    let validCount = 0;
    let invalidCount = 0;
    let riskyCount = 0;

    const updates = emails.map(({ id, email }: { id: string; email: string }) => {
      const status = resultMap.get(email) || 'unknown';
      if (status === 'valid') validCount++;
      else if (status === 'invalid') invalidCount++;
      else if (status === 'risky') riskyCount++;
      return { id, status };
    });

    // Batch updates in chunks of 50 with Promise.all
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(({ id, status }) =>
          supabase
            .from("lead_contacts")
            .update({
              email_status: status,
              verified_at: now,
              verification_source: "reoon",
            })
            .eq("id", id)
        )
      );
    }

    return NextResponse.json(
      {
        verified: emails.length,
        valid: validCount,
        invalid: invalidCount,
        risky: riskyCount,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error verifying contacts:", error);
    return NextResponse.json(
      { error: "Failed to verify contacts" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
