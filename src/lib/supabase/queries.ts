import { createAdminClient } from "./server";
import { auth } from "@clerk/nextjs/server";

/**
 * Get the current organization's ID from Clerk auth.
 * Uses clerk_org_id which maps to organizations.clerk_org_id in Supabase.
 * All queries filter by org_id to enforce multi-tenant isolation.
 */
async function getOrgId(): Promise<string> {
  const { orgId } = await auth();
  if (!orgId) {
    throw new Error(
      "No organization selected. Please select or create an organization."
    );
  }
  return orgId;
}

/**
 * Get the internal org_id (UUID) from the Clerk org ID.
 * Maps clerk_org_id → organizations.id for use in queries.
 */
async function getInternalOrgId(): Promise<string> {
  const clerkOrgId = await getOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", clerkOrgId)
    .single();

  if (error || !data) {
    throw new Error(
      "Organization not found. Please ensure your organization is set up."
    );
  }
  return data.id;
}

export async function getServerPairs() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("server_pairs")
    .select("*")
    .eq("org_id", orgId)
    .order("pair_number", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getCampaigns() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getLeads() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getFollowUps() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSmsWorkflows() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("sms_workflows")
    .select("*")
    .eq("org_id", orgId)
    .order("stage", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getOrganization() {
  const clerkOrgId = await getOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("clerk_org_id", clerkOrgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getTableCounts() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  // First get pair IDs for domain lookup
  const { data: pairData } = await supabase
    .from("server_pairs")
    .select("id")
    .eq("org_id", orgId);
  const pairIds = pairData?.map((p) => p.id) || [];

  const [servers, campaigns, leads, followUps, sms, domains] =
    await Promise.all([
      supabase
        .from("server_pairs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("follow_ups")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      supabase
        .from("sms_workflows")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId),
      pairIds.length > 0
        ? supabase
            .from("sending_domains")
            .select("id", { count: "exact", head: true })
            .in("pair_id", pairIds)
        : Promise.resolve({ count: 0 }),
    ]);

  return {
    server_pairs: servers.count ?? 0,
    campaigns: campaigns.count ?? 0,
    leads: leads.count ?? 0,
    follow_ups: followUps.count ?? 0,
    sms_workflows: sms.count ?? 0,
    sending_domains: domains.count ?? 0,
  };
}

export async function getDashboardOverview() {
  const [serverPairs, campaigns, leads, followUps, smsWorkflows] =
    await Promise.all([
      getServerPairs(),
      getCampaigns(),
      getLeads(),
      getFollowUps(),
      getSmsWorkflows(),
    ]);

  return { serverPairs, campaigns, leads, followUps, smsWorkflows };
}

export async function getEmailAccounts() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("org_id", orgId)
    .order("email", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getActiveEmailAccounts() {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("email", { ascending: true });

  if (error) throw error;
  // Filter client-side for sends_today < daily_send_limit
  return (data || []).filter((a: any) => a.sends_today < a.daily_send_limit);
}

export async function getCampaignRecipients(
  campaignId: string,
  page: number = 1,
  perPage: number = 50,
  status?: string
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  let query = supabase
    .from("campaign_recipients")
    .select("*", { count: "exact" })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}

export async function getCampaignStats(campaignId: string) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  const { data, error } = await supabase
    .from("campaign_recipients")
    .select("status, opened_at, clicked_at, replied_at, bounced_at")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId);

  if (error) throw error;

  const stats = {
    total_recipients: data?.length || 0,
    sent: 0,
    pending: 0,
    failed: 0,
    opened: 0,
    clicked: 0,
    replied: 0,
    bounced: 0,
  };

  (data || []).forEach((r: any) => {
    if (r.status === "sent") stats.sent++;
    else if (r.status === "pending") stats.pending++;
    else if (r.status === "failed") stats.failed++;
    if (r.opened_at) stats.opened++;
    if (r.clicked_at) stats.clicked++;
    if (r.replied_at) stats.replied++;
    if (r.bounced_at) stats.bounced++;
  });

  return stats;
}
