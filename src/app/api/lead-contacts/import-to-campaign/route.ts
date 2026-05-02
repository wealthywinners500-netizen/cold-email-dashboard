import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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
    const { campaign_id, contact_ids, filter } = body;

    if (!campaign_id) {
      return NextResponse.json(
        { error: "campaign_id is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const supabase = await createAdminClient();

    // Fetch contacts based on contact_ids or filter
    let contactsQuery = supabase
      .from("lead_contacts")
      .select()
      .eq("org_id", orgId)
      .not("email", "is", null); // Only contacts with non-null email

    if (contact_ids && contact_ids.length > 0) {
      contactsQuery = contactsQuery.in("id", contact_ids);
    } else if (filter) {
      if (filter.lead_list_id) {
        contactsQuery = contactsQuery.eq("lead_list_id", filter.lead_list_id);
      }
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
        {
          imported: 0,
          skipped_suppressed: 0,
          skipped_duplicate: 0,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Get suppression list for this org
    const { data: suppressedEmails } = await supabase
      .from("suppression_list")
      .select("email")
      .eq("org_id", orgId);

    const suppressedSet = new Set(
      suppressedEmails?.map((s: any) => s.email) || []
    );

    // Get existing campaign recipients to avoid duplicates
    const { data: existingRecipients } = await supabase
      .from("campaign_recipients")
      .select("email")
      .eq("campaign_id", campaign_id)
      .eq("org_id", orgId);

    const existingSet = new Set(
      existingRecipients?.map((r: any) => r.email) || []
    );

    // Filter contacts
    let skipped_suppressed = 0;
    let skipped_duplicate = 0;
    const contactsToImport = [];

    for (const contact of contacts) {
      if (suppressedSet.has(contact.email)) {
        skipped_suppressed++;
        continue;
      }
      if (existingSet.has(contact.email)) {
        skipped_duplicate++;
        continue;
      }
      contactsToImport.push(contact);
    }

    // Insert campaign recipients
    let imported = 0;
    if (contactsToImport.length > 0) {
      const recipientsToInsert = contactsToImport.map((contact: any) => ({
        org_id: orgId,
        campaign_id,
        email: contact.email,
        first_name: contact.first_name || null,
        last_name: contact.last_name || null,
        company_name: contact.business_name || null,
        status: "pending",
      }));

      const { error: insertError } = await supabase
        .from("campaign_recipients")
        .insert(recipientsToInsert);

      if (!insertError) {
        imported = recipientsToInsert.length;

        // Update lead_contacts: increment times_emailed, set last_emailed_at
        const now = new Date().toISOString();
        for (const contact of contactsToImport) {
          await supabase
            .from("lead_contacts")
            .update({
              times_emailed: (contact.times_emailed || 0) + 1,
              last_emailed_at: now,
            })
            .eq("id", contact.id);
        }

        // Update campaigns recipients count
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("recipients")
          .eq("id", campaign_id)
          .eq("org_id", orgId)
          .single();

        const newCount = (campaign?.recipients || 0) + imported;
        await supabase
          .from("campaigns")
          .update({ recipients: newCount })
          .eq("id", campaign_id)
          .eq("org_id", orgId);
      }
    }

    return NextResponse.json(
      {
        imported,
        skipped_suppressed,
        skipped_duplicate,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error importing to campaign:", error);
    return NextResponse.json(
      { error: "Failed to import contacts to campaign" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
