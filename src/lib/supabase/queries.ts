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
