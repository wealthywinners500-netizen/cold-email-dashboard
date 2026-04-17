import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { verifyBatchFallback, mapReoonStatus, type ReoonResult } from "@/lib/leads/verification-service";
import { shouldDropByPrefix } from "@/lib/leads/prefix-filter";
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

    // TODO(phase-3): wrap in getDecryptedKey (BYOK via AES-256-GCM).
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

    let contactsQuery = supabase
      .from("lead_contacts")
      .select("id, email")
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

    if (contacts.length === 0) {
      return NextResponse.json(
        { verified: 0, valid: 0, invalid: 0, risky: 0, role_account: 0, catch_all: 0, unknown: 0, suppressed: 0, prefix_dropped: 0 },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (contacts.length > 5000) {
      return NextResponse.json(
        { error: "Maximum 5000 contacts per verification request" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const now = new Date().toISOString();

    // Pre-filter: drop null emails + drop-prefix emails (saves Reoon credits).
    const emailToIds = new Map<string, string>();
    const toDrop: string[] = [];
    for (const c of contacts as { id: string; email: string | null }[]) {
      if (!c.email || shouldDropByPrefix(c.email)) {
        toDrop.push(c.id);
        continue;
      }
      emailToIds.set(c.email, c.id);
    }

    if (toDrop.length) {
      await supabase
        .from("lead_contacts")
        .update({
          email_status: "invalid",
          verified_at: now,
          verification_source: "prefix_filter",
        })
        .in("id", toDrop);
    }

    const emails = [...emailToIds.keys()];

    // Small batch → parallel single. Large batch → chunked fallback until
    // Phase 6 wires async verify_jobs polling on top of verifyBulkCreate.
    let results: ReoonResult[];
    if (emails.length <= 50) {
      results = await verifyBatchFallback(reoon_api_key, emails);
    } else {
      results = [];
      for (let i = 0; i < emails.length; i += 50) {
        results.push(
          ...(await verifyBatchFallback(reoon_api_key, emails.slice(i, i + 50)))
        );
      }
    }

    const counts = {
      valid: 0,
      role_account: 0,
      catch_all: 0,
      invalid: 0,
      unknown: 0,
      suppressed: 0,
    };

    for (const r of results) {
      const id = emailToIds.get(r.email);
      if (!id) continue;
      const m = mapReoonStatus(r.status);
      counts[m.email_status] = (counts[m.email_status] ?? 0) + 1;

      await supabase
        .from("lead_contacts")
        .update({
          email_status: m.email_status,
          reoon_raw_status: r.status,
          reoon_overall_score: r.overall_score ?? null,
          reoon_is_role_account: !!r.is_role_account,
          reoon_is_catch_all: !!r.is_catch_all,
          reoon_verified_at: now,
          verified_at: now,
          verification_source: "reoon",
        })
        .eq("id", id);

      if (m.auto_suppress) {
        await supabase
          .from("suppression_list")
          .upsert(
            {
              org_id: orgId,
              email: r.email,
              reason: "reoon_spamtrap",
              source: "verify",
            },
            { onConflict: "org_id,email", ignoreDuplicates: true }
          );
        counts.suppressed++;
      }
    }

    // `risky: 0` kept for backwards-compat with lead-contacts-client.tsx toast;
    // Phase 5 redesigns that UI and drops the field.
    return NextResponse.json(
      {
        verified: emails.length,
        prefix_dropped: toDrop.length,
        risky: 0,
        ...counts,
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
