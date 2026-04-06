import { createAdminClient } from "./server";

const ORG_ID = "org_dean_terraboost";

export async function getServerPairs() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("server_pairs")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("pair_number", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getCampaigns() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getLeads() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getFollowUps() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSmsWorkflows() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("sms_workflows")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("stage", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getOrganization() {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", ORG_ID)
    .single();

  if (error) throw error;
  return data;
}

export async function getTableCounts() {
  const supabase = await createAdminClient();

  const [servers, campaigns, leads, followUps, sms, domains] = await Promise.all([
    supabase.from("server_pairs").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID),
    supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID),
    supabase.from("sms_workflows").select("id", { count: "exact", head: true }).eq("org_id", ORG_ID),
    supabase.from("sending_domains").select("id", { count: "exact", head: true }),
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
  const [serverPairs, campaigns, leads, followUps, smsWorkflows] = await Promise.all([
    getServerPairs(),
    getCampaigns(),
    getLeads(),
    getFollowUps(),
    getSmsWorkflows(),
  ]);

  return { serverPairs, campaigns, leads, followUps, smsWorkflows };
}
