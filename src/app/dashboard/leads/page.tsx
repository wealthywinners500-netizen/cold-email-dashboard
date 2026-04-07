export const dynamic = 'force-dynamic';

import { getLeads } from "@/lib/supabase/queries";
import { getLeadContacts, getLeadContactStats, getOrganizationIntegrations } from "@/lib/supabase/queries";
import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import LeadsClient from "./leads-client";
import LeadContactsClient from "./lead-contacts-client";

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

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = (params.tab as string) || "contacts";
  const page = parseInt((params.page as string) || "1", 10);

  const orgId = await getInternalOrgId();

  // Fetch batch leads (existing)
  let leads: Awaited<ReturnType<typeof getLeads>> = [];
  try {
    leads = await getLeads();
  } catch {
    leads = [];
  }

  // Fetch contacts data if we have an org
  let contactsData: { data: Awaited<ReturnType<typeof getLeadContacts>>['data']; total: number; page: number; totalPages: number } = { data: [], total: 0, page: 1, totalPages: 0 };
  let contactStats: Awaited<ReturnType<typeof getLeadContactStats>> = { total: 0, pending: 0, valid: 0, invalid: 0, risky: 0, unknown: 0, suppressed: 0, by_state: [], by_type: [] };
  let hasOutscraper = false;
  let hasReoon = false;

  if (orgId) {
    try {
      const [contacts, stats, integrations] = await Promise.all([
        getLeadContacts(orgId, {
          page,
          perPage: 50,
          city: params.city as string | undefined,
          state: params.state as string | undefined,
          business_type: params.business_type as string | undefined,
          email_status: params.email_status as string | undefined,
          search: params.search as string | undefined,
          sortBy: (params.sort_by as string) || 'created_at',
          sortOrder: (params.sort_order as 'asc' | 'desc') || 'desc',
        }),
        getLeadContactStats(orgId),
        getOrganizationIntegrations(orgId),
      ]);
      contactsData = contacts;
      contactStats = stats;
      hasOutscraper = !!integrations.outscraper_api_key;
      hasReoon = !!integrations.reoon_api_key;
    } catch (err) {
      console.error("Failed to fetch lead contacts:", err);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Lead Pipeline</h1>
          <p className="text-gray-400 mt-2">Manage and track lead sources and verification</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 w-fit">
        <a
          href="/dashboard/leads?tab=contacts"
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "contacts"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          Contacts ({contactStats.total ?? 0})
        </a>
        <a
          href="/dashboard/leads?tab=batches"
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "batches"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          Batches ({leads.length})
        </a>
      </div>

      {/* Tab Content */}
      {tab === "contacts" ? (
        <LeadContactsClient
          contacts={contactsData.data}
          stats={contactStats}
          total={contactsData.total}
          page={contactsData.page}
          totalPages={contactsData.totalPages}
          hasOutscraper={hasOutscraper}
          hasReoon={hasReoon}
        />
      ) : (
        <LeadsClient leads={leads} />
      )}
    </div>
  );
}
