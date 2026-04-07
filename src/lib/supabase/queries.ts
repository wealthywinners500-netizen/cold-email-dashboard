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

export async function getSequences(campaignId: string) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("campaign_sequences")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getSequence(sequenceId: string) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("campaign_sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("org_id", orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getLeadSequenceStates(
  campaignId: string,
  opts?: { status?: string; page?: number; limit?: number }
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  const page = opts?.page || 1;
  const limit = opts?.limit || 50;

  let query = supabase
    .from("lead_sequence_state")
    .select("*", { count: "exact" })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId);

  if (opts?.status) {
    query = query.eq("status", opts.status);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: true })
    .range((page - 1) * limit, page * limit - 1);

  if (error) throw error;
  return { data, count };
}

export async function getLeadSequenceState(
  recipientId: string,
  campaignId: string
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("lead_sequence_state")
    .select("*")
    .eq("recipient_id", recipientId)
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId);

  if (error) throw error;
  return data;
}

export async function getInboxThreads(
  filters?: {
    classification?: string;
    campaign_id?: string;
    unread?: boolean;
    search?: string;
    page?: number;
    per_page?: number;
  }
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const page = filters?.page || 1;
  const perPage = filters?.per_page || 50;

  let query = supabase
    .from("inbox_threads")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .eq("is_archived", false)
    .order("latest_message_date", { ascending: false });

  if (filters?.classification) {
    query = query.eq("latest_classification", filters.classification);
  }
  if (filters?.campaign_id) {
    query = query.eq("campaign_id", filters.campaign_id);
  }
  if (filters?.unread) {
    query = query.eq("has_unread", true);
  }

  query = query.range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, count };
}

export async function getThreadMessages(orgId: string, threadId: number) {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("inbox_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("org_id", orgId)
    .order("received_date", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getUnreadCount(orgId: string): Promise<number> {
  const supabase = await createAdminClient();
  const { count, error } = await supabase
    .from("inbox_threads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("has_unread", true)
    .eq("is_archived", false);

  if (error) throw error;
  return count || 0;
}

export async function getSuppressionList(
  orgId: string,
  page: number = 1,
  perPage: number = 50
) {
  const supabase = await createAdminClient();
  const { data, error, count } = await supabase
    .from("suppression_list")
    .select("*", { count: "exact" })
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) throw error;
  return { data, count };
}

export async function searchInboxMessages(orgId: string, query: string) {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("inbox_messages")
    .select("id, thread_id, subject, from_email, from_name, body_preview, received_date, classification")
    .eq("org_id", orgId)
    .textSearch("search_vector", query)
    .order("received_date", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data;
}

// ============================================
// B10: Tracking + Analytics Queries
// ============================================

export async function getTrackingEvents(
  orgId: string,
  opts?: { campaignId?: string; eventType?: string; limit?: number }
) {
  const supabase = await createAdminClient();
  let query = supabase
    .from("tracking_events")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (opts?.campaignId) {
    query = query.eq("campaign_id", opts.campaignId);
  }
  if (opts?.eventType) {
    query = query.eq("event_type", opts.eventType);
  }

  query = query.limit(opts?.limit || 100);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCampaignAnalytics(campaignId: string) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  // Get campaign aggregate numbers
  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select(
      "total_sent, total_opened, total_clicked, total_replied, total_bounced, total_unsubscribed"
    )
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();

  if (campaignErr || !campaign) {
    throw new Error("Campaign not found");
  }

  const totalSent = campaign.total_sent ?? 0;
  const totalBounced = campaign.total_bounced ?? 0;
  const totalDelivered = totalSent - totalBounced;
  const totalOpened = campaign.total_opened ?? 0;
  const totalClicked = campaign.total_clicked ?? 0;
  const totalReplied = campaign.total_replied ?? 0;
  const totalUnsubscribed = campaign.total_unsubscribed ?? 0;

  // Rates based on delivered (or sent if no bounces)
  const denominator = totalDelivered > 0 ? totalDelivered : totalSent || 1;

  return {
    total_sent: totalSent,
    total_delivered: totalDelivered,
    total_opened: totalOpened,
    total_clicked: totalClicked,
    total_replied: totalReplied,
    total_bounced: totalBounced,
    total_unsubscribed: totalUnsubscribed,
    open_rate: (totalOpened / denominator) * 100,
    click_rate: (totalClicked / denominator) * 100,
    reply_rate: (totalReplied / denominator) * 100,
    bounce_rate: totalSent > 0 ? (totalBounced / totalSent) * 100 : 0,
    unsubscribe_rate: (totalUnsubscribed / denominator) * 100,
  };
}

export async function getRecipientTimeline(recipientId: string) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("tracking_events")
    .select("*")
    .eq("recipient_id", recipientId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getDailySendVolume(
  campaignId: string,
  days: number = 30
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  // Get send logs grouped by date
  const { data: sendLogs, error: sendErr } = await supabase
    .from("email_send_log")
    .select("sent_at")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .eq("status", "sent")
    .gte("sent_at", sinceDate.toISOString())
    .order("sent_at", { ascending: true });

  if (sendErr) throw sendErr;

  // Get tracking events grouped by date
  const { data: trackingEvents, error: trackErr } = await supabase
    .from("tracking_events")
    .select("event_type, created_at")
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .gte("created_at", sinceDate.toISOString())
    .order("created_at", { ascending: true });

  if (trackErr) throw trackErr;

  // Group by date
  const dailyMap = new Map<
    string,
    { sent: number; opened: number; clicked: number }
  >();

  for (const log of sendLogs || []) {
    if (!log.sent_at) continue;
    const day = log.sent_at.substring(0, 10);
    const entry = dailyMap.get(day) || { sent: 0, opened: 0, clicked: 0 };
    entry.sent++;
    dailyMap.set(day, entry);
  }

  for (const event of trackingEvents || []) {
    const day = event.created_at.substring(0, 10);
    const entry = dailyMap.get(day) || { sent: 0, opened: 0, clicked: 0 };
    if (event.event_type === "open") entry.opened++;
    else if (event.event_type === "click") entry.clicked++;
    dailyMap.set(day, entry);
  }

  // Convert to sorted array
  return Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));
}

export async function getCampaignRecipientsForAnalytics(
  campaignId: string,
  page: number = 1,
  perPage: number = 50
) {
  const orgId = await getInternalOrgId();
  const supabase = await createAdminClient();

  const { data, error, count } = await supabase
    .from("campaign_recipients")
    .select("id, email, status, sent_at, opened_at, clicked_at, replied_at, bounced_at, bounce_type", {
      count: "exact",
    })
    .eq("campaign_id", campaignId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) throw error;
  return { data, count };
}

// ============================================
// B11: Lead Contacts Queries
// ============================================

export async function getLeadContacts(
  orgId: string,
  filters?: {
    page?: number;
    perPage?: number;
    city?: string;
    state?: string;
    business_type?: string;
    email_status?: string;
    tags?: string[];
    suppressed?: boolean;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }
) {
  const supabase = await createAdminClient();
  const page = filters?.page || 1;
  const perPage = filters?.perPage || 50;
  const sortBy = filters?.sortBy || 'created_at';
  const sortOrder = filters?.sortOrder || 'desc';

  let query = supabase
    .from('lead_contacts')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId);

  if (filters?.city) {
    query = query.ilike('city', `%${filters.city}%`);
  }
  if (filters?.state) {
    query = query.eq('state', filters.state);
  }
  if (filters?.business_type) {
    query = query.ilike('business_type', `%${filters.business_type}%`);
  }
  if (filters?.email_status) {
    query = query.eq('email_status', filters.email_status);
  }
  if (filters?.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags);
  }
  if (filters?.suppressed !== undefined) {
    query = query.eq('suppressed', filters.suppressed);
  }
  if (filters?.search) {
    query = query.or(
      `business_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%`
    );
  }

  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / perPage),
  };
}

export async function getLeadContact(orgId: string, contactId: string) {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('lead_contacts')
    .select('*')
    .eq('id', contactId)
    .eq('org_id', orgId)
    .single();

  if (error) throw error;
  return data;
}

export async function getLeadContactStats(orgId: string) {
  const supabase = await createAdminClient();

  // Get counts by email_status
  const { data: contacts, error } = await supabase
    .from('lead_contacts')
    .select('email_status, state, business_type, suppressed')
    .eq('org_id', orgId);

  if (error) throw error;

  const stats = {
    total: contacts?.length || 0,
    pending: 0,
    valid: 0,
    invalid: 0,
    risky: 0,
    unknown: 0,
    suppressed: 0,
    by_state: [] as { state: string; count: number }[],
    by_type: [] as { type: string; count: number }[],
  };

  const stateMap = new Map<string, number>();
  const typeMap = new Map<string, number>();

  for (const c of contacts || []) {
    if (c.suppressed) stats.suppressed++;
    switch (c.email_status) {
      case 'pending': stats.pending++; break;
      case 'valid': stats.valid++; break;
      case 'invalid': stats.invalid++; break;
      case 'risky': stats.risky++; break;
      case 'unknown': stats.unknown++; break;
    }
    if (c.state) {
      stateMap.set(c.state, (stateMap.get(c.state) || 0) + 1);
    }
    if (c.business_type) {
      typeMap.set(c.business_type, (typeMap.get(c.business_type) || 0) + 1);
    }
  }

  stats.by_state = Array.from(stateMap.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);

  stats.by_type = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return stats;
}

export async function upsertLeadContacts(
  orgId: string,
  contacts: Partial<Record<string, unknown>>[]
) {
  const supabase = await createAdminClient();

  const rows = contacts.map((c) => ({
    ...c,
    org_id: orgId,
  }));

  const { data, error } = await supabase
    .from('lead_contacts')
    .upsert(rows, {
      onConflict: 'org_id,email',
      ignoreDuplicates: false,
    })
    .select();

  if (error) throw error;
  return { inserted: data?.length || 0, data };
}

export async function searchLeadContactsByEmail(orgId: string, emails: string[]) {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('lead_contacts')
    .select('email')
    .eq('org_id', orgId)
    .in('email', emails);

  if (error) throw error;
  return new Set((data || []).map((d: { email: string }) => d.email));
}

export async function getOrganizationIntegrations(orgId: string) {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('integrations')
    .eq('id', orgId)
    .single();

  if (error) throw error;
  return (data?.integrations || {}) as Record<string, string>;
}

export async function updateOrganizationIntegrations(
  orgId: string,
  integrations: Record<string, string>
) {
  const supabase = await createAdminClient();
  const { error } = await supabase
    .from('organizations')
    .update({ integrations })
    .eq('id', orgId);

  if (error) throw error;
}
