import { createClient } from "@supabase/supabase-js";

// Load environment variables
try {
  require("dotenv").config({ path: ".env.local" });
} catch (e) {
  console.warn("â ï¸ dotenv not installed or failed to load - using process.env only");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "â Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables"
  );
  process.exit(1);
}

// Untyped client for seed script â bypasses strict Insert type checks
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ORG_ID = "org_dean_terraboost";
const CLERK_ORG_ID = "org_dean_terraboost";

async function seed() {
  try {
    console.log("ð± Starting seed for Dean's Cold Email Operation...\n");

    // 1. Delete existing data for this org (clean seed)
    console.log("ðï¸ Cleaning up existing data...");
    await supabase
      .from("sms_workflows")
      .delete()
      .eq("org_id", ORG_ID);
    await supabase
      .from("follow_ups")
      .delete()
      .eq("org_id", ORG_ID);
    await supabase
      .from("leads")
      .delete()
      .eq("org_id", ORG_ID);
    await supabase
      .from("campaigns")
      .delete()
      .eq("org_id", ORG_ID);
    await supabase
      .from("sending_domains")
      .delete()
      .in(
        "pair_id",
        (
          await supabase
            .from("server_pairs")
            .select("id")
            .eq("org_id", ORG_ID)
        ).data?.map((p) => p.id) || []
      );
    await supabase
      .from("server_pairs")
      .delete()
      .eq("org_id", ORG_ID);
    await supabase
      .from("organizations")
      .delete()
      .eq("id", ORG_ID);
    console.log("â Cleaned up existing data\n");

    // 2. Insert Organization
    console.log("ð¦ Seeding organization...");
    const { error: orgError } = await supabase
      .from("organizations")
      .insert({
        id: ORG_ID,
        clerk_org_id: CLERK_ORG_ID,
        name: "Dean's Cold Email Operation",
        plan_tier: "pro",
      });

    if (orgError) {
      throw new Error(`Failed to seed organization: ${orgError.message}`);
    }
    console.log("â Organization seeded\n");

    // 3. Insert Server Pairs
    console.log("ð¥ï¸ Seeding 10 server pairs...");
    const serverPairs =
      [
        {
          org_id: ORG_ID,
          pair_number: 1,
          ns_domain: "grocerysynergy.info",
          s1_ip: "187.33.145.55",
          s1_hostname: "mail1.grocerysynergy.info",
          s2_ip: "185.253.155.145",
          s2_hostname: "mail2.grocerysynergy.info",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 30,
        },
        {
          org_id: ORG_ID,
          pair_number: 2,
          ns_domain: "krogernetworks.info",
          s1_ip: "27.0.174.55",
          s1_hostname: "mail1.krogernetworks.info",
          s2_ip: "217.71.202.214",
          s2_hostname: "mail2.krogernetworks.info",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 30,
        },
        {
          org_id: ORG_ID,
          pair_number: 3,
          ns_domain: "krogertogether.info",
          s1_ip: "79.143.93.98",
          s1_hostname: "mail1.krogertogether.info",
          s2_ip: "79.143.94.164",
          s2_hostname: "mail2.krogertogether.info",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 30,
        },
        {
          org_id: ORG_ID,
          pair_number: 4,
          ns_domain: "marketpartners.info",
          s1_ip: "200.234.225.136",
          s1_hostname: "mail1.marketpartners.info",
          s2_ip: "187.33.147.57",
          s2_hostname: "mail2.marketpartners.info",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 1,
          total_accounts: 30,
        },
        {
          org_id: ORG_ID,
          pair_number: 5,
          ns_domain: "partner-with-kroger.info",
          s1_ip: "195.201.164.217",
          s1_hostname: "mail1.partner-with-kroger.info",
          s2_ip: "195.201.164.218",
          s2_hostname: "mail2.partner-with-kroger.info",
          status: "needs_attention",
          mxtoolbox_errors: 9,
          warmup_day: 0,
          total_accounts: 0,
        },
        {
          org_id: ORG_ID,
          pair_number: 6,
          ns_domain: "partnerwithkroger.online",
          s1_ip: "200.234.229.210",
          s1_hostname: "mail1.partnerwithkroger.online",
          s2_ip: "200.234.229.211",
          s2_hostname: "mail2.partnerwithkroger.online",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 30,
        },
        {
          org_id: ORG_ID,
          pair_number: 7,
          ns_domain: "partnerwithkroger.org",
          s1_ip: "185.247.112.94",
          s1_hostname: "mail1.partnerwithkroger.org",
          s2_ip: "185.247.112.95",
          s2_hostname: "mail2.partnerwithkroger.org",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 1,
          total_accounts: 25,
        },
        {
          org_id: ORG_ID,
          pair_number: 8,
          ns_domain: "partnerwithkroger.store",
          s1_ip: "94.142.161.254",
          s1_hostname: "mail1.partnerwithkroger.store",
          s2_ip: "94.142.161.255",
          s2_hostname: "mail2.partnerwithkroger.store",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 1,
          total_accounts: 25,
        },
        {
          org_id: ORG_ID,
          pair_number: 9,
          ns_domain: "krogerentrancemedia.online",
          s1_ip: "TBD",
          s1_hostname: "mail1.krogerentrancemedia.online",
          s2_ip: "TBD",
          s2_hostname: "mail2.krogerentrancemedia.online",
          status: "planned",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 0,
        },
        {
          org_id: ORG_ID,
          pair_number: 10,
          ns_domain: "krogerentrancemedia.store",
          s1_ip: "TBD",
          s1_hostname: "mail1.krogerentrancemedia.store",
          s2_ip: "TBD",
          s2_hostname: "mail2.krogerentrancemedia.store",
          status: "planned",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 0,
        },
      ];

    const { data: insertedPairs, error: pairsError } = await supabase
      .from("server_pairs")
      .insert(serverPairs)
      .select();

    if (pairsError) {
      throw new Error(`Failed to seed server pairs: ${pairsError.message}`);
    }
    console.log(`â Seeded ${insertedPairs?.length} server pairs\n`);

    // 4. Insert Campaigns
    console.log("ð§ Seeding 8 campaigns...");
    const campaigns = [
      {
        org_id: ORG_ID,
        snovio_id: "2946984",
        name: "GA Med Practice Kroger - Direct Pitch",
        region: "GA",
        store_chain: "Kroger",
        recipients: 0,
        status: "active",
      },
      {
        org_id: ORG_ID,
        snovio_id: "2946985",
        name: "GA Med Practice Kroger - Question Hook",
        region: "GA",
        store_chain: "Kroger",
        recipients: 0,
        status: "active",
      },
      {
        org_id: ORG_ID,
        snovio_id: "2946995",
        name: "LI Med Spa Stop & Shop - Local Feature",
        region: "NY",
        store_chain: "Stop & Shop",
        recipients: 0,
        status: "active",
      },
      {
        org_id: ORG_ID,
        snovio_id: "2946996",
        name: "LI Med Spa Stop & Shop - Question Hook",
        region: "NY",
        store_chain: "Stop & Shop",
        recipients: 0,
        status: "active",
      },
      {
        org_id: ORG_ID,
        snovio_id: "2946341",
        name: "LI Med Practice Stop & Shop A",
        region: "NY",
        store_chain: "Stop & Shop",
        recipients: 0,
        status: "paused",
      },
      {
        org_id: ORG_ID,
        snovio_id: "2946347",
        name: "LI Med Practice Stop & Shop B",
        region: "NY",
        store_chain: "Stop & Shop",
        recipients: 0,
        status: "paused",
      },
      {
        org_id: ORG_ID,
        snovio_id: null,
        name: "Med Practice TX Octoparse 1",
        region: "TX",
        store_chain: "Kroger",
        recipients: 846,
        status: "completed",
      },
      {
        org_id: ORG_ID,
        snovio_id: null,
        name: "Med Practice TX Octoparse 2",
        region: "TX",
        store_chain: "Kroger",
        recipients: 6190,
        status: "completed",
      },
    ];

    const { data: insertedCampaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .insert(campaigns)
      .select();

    if (campaignsError) {
      throw new Error(`Failed to seed campaigns: ${campaignsError.message}`);
    }
    console.log(`â Seeded ${insertedCampaigns?.length} campaigns\n`);

    // 5. Insert Leads
    console.log("ð¯ Seeding 8 lead batches...");
    const leads = [
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Long Island",
        state: "NY",
        total_scraped: 3918,
        verified_count: 3918,
        cost_per_lead: 0.0047,
        status: "verified",
      },
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Dallas",
        state: "TX",
        total_scraped: 9011,
        verified_count: 9011,
        cost_per_lead: 0.0046,
        status: "verified",
      },
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Atlanta",
        state: "GA",
        total_scraped: 16824,
        verified_count: 16824,
        cost_per_lead: 0.0047,
        status: "verified",
      },
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Atlanta",
        state: "GA",
        total_scraped: 0,
        verified_count: 0,
        cost_per_lead: null,
        status: "pending",
      },
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Pittsburgh",
        state: "PA",
        total_scraped: 0,
        verified_count: 0,
        cost_per_lead: null,
        status: "submitted",
      },
      {
        org_id: ORG_ID,
        source: "Octoparse",
        city: "Long Island",
        state: "NY",
        total_scraped: 6619,
        verified_count: 0,
        cost_per_lead: null,
        status: "completed",
      },
      {
        org_id: ORG_ID,
        source: "Octoparse",
        city: "Houston",
        state: "TX",
        total_scraped: 26926,
        verified_count: 0,
        cost_per_lead: null,
        status: "completed",
      },
      {
        org_id: ORG_ID,
        source: "Outscraper",
        city: "Long Island",
        state: "NY",
        total_scraped: 0,
        verified_count: 0,
        cost_per_lead: null,
        status: "submitted",
      },
    ];

    const { data: insertedLeads, error: leadsError } = await supabase
      .from("leads")
      .insert(leads)
      .select();

    if (leadsError) {
      throw new Error(`Failed to seed leads: ${leadsError.message}`);
    }
    console.log(`â Seeded ${insertedLeads?.length} lead batches\n`);

    // 6. Insert Follow-ups (sample)
    console.log("ð¬ Seeding follow-ups...");

    // Get first campaign ID for follow-ups
    const firstCampaignId = insertedCampaigns?.[0]?.id;
    if (!firstCampaignId) {
      throw new Error("Could not retrieve campaign ID for follow-ups");
    }

    const followUps = [];

    // Add 54 interested threads
    for (let i = 1; i <= 54; i++) {
      followUps.push({
        org_id: ORG_ID,
        campaign_id: firstCampaignId,
        thread_id: `thread_interested_${i}`,
        classification: "INTERESTED",
        action_needed: "Dean responds",
        template_assigned: null,
      });
    }

    // Add 30 ghosted threads
    for (let i = 1; i <= 30; i++) {
      followUps.push({
        org_id: ORG_ID,
        campaign_id: firstCampaignId,
        thread_id: `thread_ghosted_${i}`,
        classification: "POLITE_DECLINE",
        template_assigned: "FOMO apology",
        action_needed: null,
      });
    }

    // Add 20 auto-reply threads
    for (let i = 1; i <= 20; i++) {
      followUps.push({
        org_id: ORG_ID,
        campaign_id: firstCampaignId,
        thread_id: `thread_autoreply_${i}`,
        classification: "AUTO_REPLY",
        template_assigned: null,
        action_needed: null,
      });
    }

    const { data: insertedFollowUps, error: followUpsError } = await supabase
      .from("follow_ups")
      .insert(followUps)
      .select();

    if (followUpsError) {
      throw new Error(`Failed to seed follow-ups: ${followUpsError.message}`);
    }
    console.log(`â Seeded ${insertedFollowUps?.length} follow-ups\n`);

    // 7. Insert SMS Workflows
    console.log("ð± Seeding SMS workflows...");
    const smsWorkflows = [
      {
        org_id: ORG_ID,
        stage: "A0",
        name: "Initial Outreach",
        message_type: "SMS",
        message_count: 5,
        description: "Under 160 chars. Mentions Tops + Stop & Shop, references NY. Asks about interest in kiosk advertising.",
        tag_applied: "Contacted",
        region: "NY",
        store_chains: ["Tops", "Stop & Shop"],
        status: "pending_build",
      },
      {
        org_id: ORG_ID,
        stage: "A2",
        name: "Auto Pricing Response",
        message_type: "MMS",
        message_count: 5,
        description: "326-354 chars + flyer image. 117k+ impressions, art/production/installation included. Triggers 3-4 min after reply.",
        tag_applied: "Pricing Sent",
        region: "NY",
        store_chains: ["Tops", "Stop & Shop"],
        status: "pending_build",
      },
      {
        org_id: ORG_ID,
        stage: "A3+",
        name: "Follow-Up Drip",
        message_type: "SMS",
        message_count: 85,
        description: "Triggered 24hrs after pricing with no reply. References promo/flyer/pricing. Tone shifts across sequence.",
        tag_applied: "Pricing Sent - No Response",
        region: "NY",
        store_chains: ["Tops", "Stop & Shop"],
        status: "pending_build",
      },
      {
        org_id: ORG_ID,
        stage: "A4",
        name: "Re-Engagement",
        message_type: "SMS",
        message_count: 40,
        description: "Last-ditch recovery after drip sequence exhausted. Final attempt before archiving.",
        tag_applied: null,
        region: "NY",
        store_chains: ["Tops", "Stop & Shop"],
        status: "pending_build",
      },
    ];

    // Clean existing SMS data
    await supabase.from("sms_workflows").delete().eq("org_id", ORG_ID);

    const { data: insertedSMS, error: smsError } = await supabase
      .from("sms_workflows")
      .insert(smsWorkflows)
      .select();

    if (smsError) {
      throw new Error(`Failed to seed SMS workflows: ${smsError.message}`);
    }
    console.log(`â Seeded ${insertedSMS?.length} SMS workflows\n`);

    // Summary
    console.log("========================================");
    console.log("â SEED COMPLETE - Dean's Cold Email Operation");
    console.log("========================================");
    console.log(`Organization: ${ORG_ID}`);
    console.log(`Server Pairs: ${insertedPairs?.length}`);
    console.log(`Campaigns: ${insertedCampaigns?.length}`);
    console.log(`Leads: ${insertedLeads?.length}`);
    console.log(`Follow-ups: ${insertedFollowUps?.length}`);
    console.log(`SMS Workflows: ${insertedSMS?.length}`);
    console.log("========================================\n");

    process.exit(0);
  } catch (error) {
    console.error("â Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

seed();
