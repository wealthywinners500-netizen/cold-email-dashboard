import { createClient } from "@supabase/supabase-js";

// Load environment variables
try {
  require("dotenv").config({ path: ".env.local" });
} catch (e) {
  console.warn("⚠️ dotenv not installed or failed to load - using process.env only");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables"
  );
  process.exit(1);
}

// Get CLI arguments
const [, , orgId, orgName] = process.argv;

if (!orgId || !orgName) {
  console.error("Usage: npx tsx src/seed/seed-new-org.ts <org_id> <org_name>");
  console.error("Example: npx tsx src/seed/seed-new-org.ts org_test_friend \"Test Friend Org\"");
  process.exit(1);
}

// Untyped client for seed script – bypasses strict Insert type checks
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function seed() {
  try {
    console.log(`🌱 Starting seed for organization: ${orgName} (${orgId})...\n`);

    // 1. Delete existing data for this org (clean seed)
    console.log("🗑️ Cleaning up existing data...");
    await supabase
      .from("sms_workflows")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("follow_ups")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("leads")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("campaigns")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("sending_domains")
      .delete()
      .in(
        "pair_id",
        (
          await supabase
            .from("server_pairs")
            .select("id")
            .eq("org_id", orgId)
        ).data?.map((p) => p.id) || []
      );
    await supabase
      .from("server_pairs")
      .delete()
      .eq("org_id", orgId);
    await supabase
      .from("organizations")
      .delete()
      .eq("id", orgId);
    console.log("✓ Cleaned up existing data\n");

    // 2. Insert Organization
    console.log("📦 Seeding organization...");
    const { error: orgError } = await supabase
      .from("organizations")
      .insert({
        id: orgId,
        clerk_org_id: orgId,
        name: orgName,
        plan_tier: "starter",
      });

    if (orgError) {
      throw new Error(`Failed to seed organization: ${orgError.message}`);
    }
    console.log("✓ Organization seeded\n");

    // 3. Insert 1 Sample Server Pair
    console.log("🖥️ Seeding 1 sample server pair...");
    const serverPair = {
      org_id: orgId,
      pair_number: 1,
      ns_domain: `test-${orgId.replace(/[^a-z0-9]/g, "")}.com`,
      s1_ip: "192.168.1.1",
      s1_hostname: `mail1.test-${orgId.replace(/[^a-z0-9]/g, "")}.com`,
      s2_ip: "192.168.1.2",
      s2_hostname: `mail2.test-${orgId.replace(/[^a-z0-9]/g, "")}.com`,
      status: "planned",
      mxtoolbox_errors: 0,
      warmup_day: 0,
      total_accounts: 0,
    };

    const { data: insertedPairs, error: pairsError } = await supabase
      .from("server_pairs")
      .insert([serverPair])
      .select();

    if (pairsError) {
      throw new Error(`Failed to seed server pair: ${pairsError.message}`);
    }
    console.log(`✓ Seeded 1 server pair\n`);

    const pairId = insertedPairs?.[0]?.id;
    if (!pairId) {
      throw new Error("Could not retrieve server pair ID");
    }

    // 4. Insert 1 Sample Campaign
    console.log("📧 Seeding 1 sample campaign...");
    const campaign = {
      org_id: orgId,
      snovio_id: "test_campaign_001",
      name: "Sample Campaign - Test Org",
      region: "NY",
      store_chain: "Sample",
      recipients: 0,
      status: "active",
    };

    const { data: insertedCampaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .insert([campaign])
      .select();

    if (campaignsError) {
      throw new Error(`Failed to seed campaign: ${campaignsError.message}`);
    }
    console.log(`✓ Seeded 1 campaign\n`);

    const campaignId = insertedCampaigns?.[0]?.id;
    if (!campaignId) {
      throw new Error("Could not retrieve campaign ID");
    }

    // 5. Insert 2 Sample Leads
    console.log("🎯 Seeding 2 sample leads...");
    const leads = [
      {
        org_id: orgId,
        source: "Test Source",
        city: "New York",
        state: "NY",
        total_scraped: 100,
        verified_count: 85,
        cost_per_lead: 0.005,
        status: "verified",
      },
      {
        org_id: orgId,
        source: "Test Source",
        city: "Los Angeles",
        state: "CA",
        total_scraped: 50,
        verified_count: 42,
        cost_per_lead: 0.005,
        status: "verified",
      },
    ];

    const { data: insertedLeads, error: leadsError } = await supabase
      .from("leads")
      .insert(leads)
      .select();

    if (leadsError) {
      throw new Error(`Failed to seed leads: ${leadsError.message}`);
    }
    console.log(`✓ Seeded 2 leads\n`);

    // 6. Insert 2 Sample Follow-ups
    console.log("💬 Seeding 2 sample follow-ups...");
    const followUps = [
      {
        org_id: orgId,
        campaign_id: campaignId,
        thread_id: "thread_sample_001",
        classification: "INTERESTED",
        action_needed: "Review response",
        template_assigned: null,
      },
      {
        org_id: orgId,
        campaign_id: campaignId,
        thread_id: "thread_sample_002",
        classification: "POLITE_DECLINE",
        template_assigned: "Auto-response",
        action_needed: null,
      },
    ];

    const { data: insertedFollowUps, error: followUpsError } = await supabase
      .from("follow_ups")
      .insert(followUps)
      .select();

    if (followUpsError) {
      throw new Error(`Failed to seed follow-ups: ${followUpsError.message}`);
    }
    console.log(`✓ Seeded 2 follow-ups\n`);

    // 7. Insert 1 Sample SMS Workflow
    console.log("📱 Seeding 1 sample SMS workflow...");
    const smsWorkflow = {
      org_id: orgId,
      stage: "A0",
      name: "Sample SMS Outreach",
      message_type: "SMS",
      message_count: 3,
      description: "Sample SMS workflow for testing multi-tenant data isolation.",
      tag_applied: "Test Contacted",
      region: "NY",
      store_chains: ["Sample"],
      status: "pending_build",
    };

    const { data: insertedSMS, error: smsError } = await supabase
      .from("sms_workflows")
      .insert([smsWorkflow])
      .select();

    if (smsError) {
      throw new Error(`Failed to seed SMS workflow: ${smsError.message}`);
    }
    console.log(`✓ Seeded 1 SMS workflow\n`);

    // Summary
    console.log("========================================");
    console.log(`✓ SEED COMPLETE - ${orgName}`);
    console.log("========================================");
    console.log(`Organization ID: ${orgId}`);
    console.log(`Organization Name: ${orgName}`);
    console.log(`Server Pairs: 1`);
    console.log(`Campaigns: 1`);
    console.log(`Leads: 2`);
    console.log(`Follow-ups: 2`);
    console.log(`SMS Workflows: 1`);
    console.log("========================================\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

seed();
