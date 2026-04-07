import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy init pattern — no module-scope client
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    try {
      require("dotenv").config({ path: ".env.local" });
    } catch (e) {
      // dotenv optional
    }
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      process.exit(1);
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

async function main() {
  const supabase = getSupabase();

  const orgId = process.argv[2] || process.env.FRIEND_ORG_ID;

  if (!orgId) {
    console.error(
      "❌ Usage: npx tsx src/seed/seed-friend-test.ts <org_id>"
    );
    console.error(
      "   or set FRIEND_ORG_ID environment variable"
    );
    process.exit(1);
  }

  try {
    console.log(`🌱 Starting seed for friend's org: ${orgId}\n`);

    // Check if sample data already exists (idempotency check)
    console.log("🔍 Checking for existing sample data...");
    const { data: existingPairs } = await supabase
      .from("server_pairs")
      .select("id")
      .eq("org_id", orgId)
      .eq("ns_domain", "demo-servers-1.example.com");

    if (existingPairs && existingPairs.length > 0) {
      console.log("✅ Sample data already exists for this org. Skipping.\n");
      return;
    }

    // 1. Insert Server Pairs
    console.log("🖥️  Seeding 2 sample server pairs...");
    const { data: serverPairsData, error: pairsError } = await supabase
      .from("server_pairs")
      .insert([
        {
          org_id: orgId,
          pair_number: 1,
          ns_domain: "demo-servers-1.example.com",
          s1_ip: "10.0.0.1",
          s1_hostname: "mail1.demo-servers-1.example.com",
          s2_ip: "10.0.0.2",
          s2_hostname: "mail2.demo-servers-1.example.com",
          status: "complete",
          mxtoolbox_errors: 0,
          warmup_day: 0,
          total_accounts: 5,
        },
        {
          org_id: orgId,
          pair_number: 2,
          ns_domain: "demo-servers-2.example.com",
          s1_ip: "10.0.0.3",
          s1_hostname: "mail1.demo-servers-2.example.com",
          s2_ip: "10.0.0.4",
          s2_hostname: "mail2.demo-servers-2.example.com",
          status: "setup",
          mxtoolbox_errors: 2,
          warmup_day: 1,
          total_accounts: 0,
        },
      ])
      .select();

    if (pairsError) {
      throw new Error(`Failed to seed server pairs: ${pairsError.message}`);
    }

    const pair1Id = serverPairsData?.[0]?.id;
    if (!pair1Id) {
      throw new Error("Failed to retrieve pair 1 ID");
    }

    console.log(`✅ Seeded 2 server pairs\n`);

    // 2. Insert Email Accounts (linked to pair 1)
    console.log("📧 Seeding 5 sample email accounts...");
    const { data: emailAccountsData, error: emailError } = await supabase
      .from("email_accounts")
      .insert([
        {
          org_id: orgId,
          email: "alex@demo-outreach.com",
          display_name: "Alex Johnson",
          smtp_host: "mail.demo-outreach.com",
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: "alex@demo-outreach.com",
          smtp_pass: "placeholder-change-me",
          imap_host: "mail.demo-outreach.com",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: pair1Id,
          daily_send_limit: 30,
          sends_today: 0,
          warmup_day: 0,
          status: "active",
        },
        {
          org_id: orgId,
          email: "sarah@demo-outreach.com",
          display_name: "Sarah Chen",
          smtp_host: "mail.demo-outreach.com",
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: "sarah@demo-outreach.com",
          smtp_pass: "placeholder-change-me",
          imap_host: "mail.demo-outreach.com",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: pair1Id,
          daily_send_limit: 30,
          sends_today: 0,
          warmup_day: 0,
          status: "active",
        },
        {
          org_id: orgId,
          email: "mike@demo-outreach.com",
          display_name: "Mike Roberts",
          smtp_host: "mail.demo-outreach.com",
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: "mike@demo-outreach.com",
          smtp_pass: "placeholder-change-me",
          imap_host: "mail.demo-outreach.com",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: pair1Id,
          daily_send_limit: 30,
          sends_today: 0,
          warmup_day: 0,
          status: "active",
        },
        {
          org_id: orgId,
          email: "lisa@demo-marketing.com",
          display_name: "Lisa Park",
          smtp_host: "mail.demo-marketing.com",
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: "lisa@demo-marketing.com",
          smtp_pass: "placeholder-change-me",
          imap_host: "mail.demo-marketing.com",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: pair1Id,
          daily_send_limit: 30,
          sends_today: 0,
          warmup_day: 1,
          status: "warming",
        },
        {
          org_id: orgId,
          email: "david@demo-marketing.com",
          display_name: "David Kim",
          smtp_host: "mail.demo-marketing.com",
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: "david@demo-marketing.com",
          smtp_pass: "placeholder-change-me",
          imap_host: "mail.demo-marketing.com",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: pair1Id,
          daily_send_limit: 30,
          sends_today: 0,
          warmup_day: 1,
          status: "warming",
        },
      ])
      .select();

    if (emailError) {
      throw new Error(`Failed to seed email accounts: ${emailError.message}`);
    }

    const firstEmailId = emailAccountsData?.[0]?.id;
    if (!firstEmailId) {
      throw new Error("Failed to retrieve first email account ID");
    }

    console.log(`✅ Seeded 5 email accounts\n`);

    // 3. Insert Campaigns
    console.log("📢 Seeding 2 sample campaigns...");
    const { data: campaignsData, error: campaignsError } = await supabase
      .from("campaigns")
      .insert([
        {
          org_id: orgId,
          name: "Demo Campaign - Healthcare Outreach",
          region: "CA",
          store_chain: "Target",
          recipients: 250,
          status: "active",
          subject_lines: [
            "Healthcare Partnership Opportunity",
            "Quick question about your practice",
          ],
          total_sent: 125,
          total_opened: 45,
          total_replied: 8,
          total_clicked: 12,
          total_bounced: 3,
          total_unsubscribed: 0,
          open_rate: 36.0,
          reply_rate: 6.4,
          bounce_rate: 2.4,
        },
        {
          org_id: orgId,
          name: "Demo Campaign - Wellness Centers",
          region: "NY",
          store_chain: "Stop & Shop",
          recipients: 500,
          status: "draft",
          subject_lines: ["Wellness Center Visibility Program"],
          total_sent: 0,
          total_opened: 0,
          total_replied: 0,
          total_clicked: 0,
          total_bounced: 0,
          total_unsubscribed: 0,
          open_rate: null,
          reply_rate: null,
          bounce_rate: null,
        },
      ])
      .select();

    if (campaignsError) {
      throw new Error(`Failed to seed campaigns: ${campaignsError.message}`);
    }

    const campaign1Id = campaignsData?.[0]?.id;
    if (!campaign1Id) {
      throw new Error("Failed to retrieve campaign 1 ID");
    }

    console.log(`✅ Seeded 2 campaigns\n`);

    // 4. Insert Campaign Sequence with 3 steps
    console.log("📋 Seeding campaign sequence with 3 steps...");
    const { error: sequenceError } = await supabase
      .from("campaign_sequences")
      .insert({
        org_id: orgId,
        campaign_id: campaign1Id,
        name: "Primary Outreach Sequence",
        sequence_type: "primary",
        sort_order: 0,
        status: "active",
        steps: [
          {
            step_number: 1,
            delay_days: 0,
            delay_hours: 0,
            subject: "Healthcare Partnership Opportunity",
            body_html:
              "<p>Hi {{first_name}},</p><p>I noticed {{company_name}} in {{city}} and wanted to reach out about a unique advertising opportunity for your practice.</p><p>We partner with local healthcare providers to increase visibility through billboard advertising in grocery stores.</p><p>Would you be open to learning more?</p><p>Best,<br/>Alex Johnson</p>",
            body_text:
              "Hi {{first_name}},\n\nI noticed {{company_name}} in {{city}} and wanted to reach out about a unique advertising opportunity for your practice.\n\nWe partner with local healthcare providers to increase visibility through billboard advertising in grocery stores.\n\nWould you be open to learning more?\n\nBest,\nAlex Johnson",
            send_in_same_thread: false,
            ab_variants: [],
          },
          {
            step_number: 2,
            delay_days: 3,
            delay_hours: 0,
            subject: "Re: Healthcare Partnership Opportunity",
            body_html:
              "<p>Hi {{first_name}},</p><p>Just following up on my last email. Our billboard kiosks in local grocery stores have been proven to increase patient inquiries by 30-50%.</p><p>Given {{company_name}}'s focus on {{specialty}}, this could be a great fit.</p><p>Let me know if you'd like to discuss further.</p><p>Best,<br/>Alex Johnson</p>",
            body_text:
              "Hi {{first_name}},\n\nJust following up on my last email. Our billboard kiosks in local grocery stores have been proven to increase patient inquiries by 30-50%.\n\nGiven {{company_name}}'s focus on {{specialty}}, this could be a great fit.\n\nLet me know if you'd like to discuss further.\n\nBest,\nAlex Johnson",
            send_in_same_thread: true,
            ab_variants: [],
          },
          {
            step_number: 3,
            delay_days: 7,
            delay_hours: 0,
            subject: "Re: Healthcare Partnership Opportunity",
            body_html:
              "<p>Hi {{first_name}},</p><p>Last note — would you be open to a quick 5-minute call this week? I'd love to share some case studies from similar practices in your area.</p><p>Let me know what works best for you.</p><p>Best,<br/>Alex Johnson</p>",
            body_text:
              "Hi {{first_name}},\n\nLast note — would you be open to a quick 5-minute call this week? I'd love to share some case studies from similar practices in your area.\n\nLet me know what works best for you.\n\nBest,\nAlex Johnson",
            send_in_same_thread: true,
            ab_variants: [],
          },
        ],
      });

    if (sequenceError) {
      throw new Error(
        `Failed to seed campaign sequence: ${sequenceError.message}`
      );
    }

    console.log(`✅ Seeded campaign sequence with 3 steps\n`);

    // 5. Insert 10 Sample Lead Contacts
    console.log("👥 Seeding 10 sample lead contacts...");
    const { error: contactsError } = await supabase
      .from("lead_contacts")
      .insert([
        {
          org_id: orgId,
          business_name: "Sunrise Family Medicine",
          business_type: "Medical Practice",
          first_name: "Jennifer",
          last_name: "Williams",
          email: "jwilliams@sunrisefamilymed.com",
          phone: "555-0101",
          city: "Los Angeles",
          state: "CA",
          zip: "90001",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "medical"],
          custom_fields: { specialty: "Family Medicine" },
        },
        {
          org_id: orgId,
          business_name: "Bay Area Chiropractic",
          business_type: "Chiropractor",
          first_name: "Robert",
          last_name: "Chen",
          email: "rchen@bayareachiro.com",
          phone: "555-0102",
          city: "San Francisco",
          state: "CA",
          zip: "94102",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "chiropractic"],
          custom_fields: { specialty: "Chiropractic" },
        },
        {
          org_id: orgId,
          business_name: "Manhattan Dental Group",
          business_type: "Dentist",
          first_name: "Maria",
          last_name: "Garcia",
          email: "mgarcia@manhattandental.com",
          phone: "555-0103",
          city: "New York",
          state: "NY",
          zip: "10001",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "dental"],
          custom_fields: { specialty: "General Dentistry" },
        },
        {
          org_id: orgId,
          business_name: "Dermatology Plus",
          business_type: "Dermatologist",
          first_name: "James",
          last_name: "Mitchell",
          email: "jmitchell@dermplus.com",
          phone: "555-0104",
          city: "Houston",
          state: "TX",
          zip: "77001",
          country: "US",
          email_status: "pending",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "dermatology"],
          custom_fields: { specialty: "Dermatology" },
        },
        {
          org_id: orgId,
          business_name: "Westside Wellness Center",
          business_type: "Wellness Center",
          first_name: "Angela",
          last_name: "Lopez",
          email: "alopez@westsidewellness.com",
          phone: "555-0105",
          city: "Phoenix",
          state: "AZ",
          zip: "85001",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["wellness", "spa"],
          custom_fields: { specialty: "Wellness Services" },
        },
        {
          org_id: orgId,
          business_name: "Boston Eye Care",
          business_type: "Optometrist",
          first_name: "David",
          last_name: "Thompson",
          email: "dthompson@bostoneyecare.com",
          phone: "555-0106",
          city: "Boston",
          state: "MA",
          zip: "02101",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "optometry"],
          custom_fields: { specialty: "Optometry" },
        },
        {
          org_id: orgId,
          business_name: "Seattle Orthopedic Clinic",
          business_type: "Orthopedic Surgery",
          first_name: "Lisa",
          last_name: "Anderson",
          email: "landerson@seattleortho.com",
          phone: "555-0107",
          city: "Seattle",
          state: "WA",
          zip: "98101",
          country: "US",
          email_status: "risky",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "orthopedic"],
          custom_fields: { specialty: "Orthopedics" },
        },
        {
          org_id: orgId,
          business_name: "Miami Pediatric Associates",
          business_type: "Pediatrician",
          first_name: "Carlos",
          last_name: "Rodriguez",
          email: "crodriguez@miamipeds.com",
          phone: "555-0108",
          city: "Miami",
          state: "FL",
          zip: "33101",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "pediatrics"],
          custom_fields: { specialty: "Pediatrics" },
        },
        {
          org_id: orgId,
          business_name: "Portland Veterinary Hospital",
          business_type: "Veterinarian",
          first_name: "Emily",
          last_name: "Stone",
          email: "estone@portlandvet.com",
          phone: "555-0109",
          city: "Portland",
          state: "OR",
          zip: "97201",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "veterinary"],
          custom_fields: { specialty: "Animal Care" },
        },
        {
          org_id: orgId,
          business_name: "Atlanta Physical Therapy",
          business_type: "Physical Therapy",
          first_name: "Marcus",
          last_name: "Johnson",
          email: "mjohnson@atlantapt.com",
          phone: "555-0110",
          city: "Atlanta",
          state: "GA",
          zip: "30301",
          country: "US",
          email_status: "valid",
          scrape_source: "outscraper",
          times_emailed: 0,
          suppressed: false,
          tags: ["healthcare", "therapy"],
          custom_fields: { specialty: "Physical Therapy" },
        },
      ]);

    if (contactsError) {
      throw new Error(`Failed to seed lead contacts: ${contactsError.message}`);
    }

    console.log(`✅ Seeded 10 lead contacts\n`);

    // 6. Insert 3 Inbox Threads with Messages
    console.log("💬 Seeding 3 inbox threads with messages...");

    const now = new Date().toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Insert threads
    const { data: threadsData, error: threadsError } = await supabase
      .from("inbox_threads")
      .insert([
        {
          org_id: orgId,
          subject: "Re: Healthcare Partnership Opportunity",
          snippet: "Yes, I'm interested in learning more about this opportunity.",
          message_count: 2,
          participants: ["jwilliams@sunrisefamilymed.com"],
          account_emails: ["alex@demo-outreach.com"],
          has_unread: true,
          is_starred: false,
          is_archived: false,
          latest_classification: "INTERESTED",
          campaign_id: campaign1Id,
          campaign_name: "Demo Campaign - Healthcare Outreach",
          latest_message_date: now,
          earliest_message_date: threeDaysAgo,
        },
        {
          org_id: orgId,
          subject: "Re: Wellness Center Program",
          snippet:
            "Thank you for your email. This is an automated reply. I will respond to your message shortly.",
          message_count: 2,
          participants: ["alopez@westsidewellness.com"],
          account_emails: ["sarah@demo-outreach.com"],
          has_unread: false,
          is_starred: false,
          is_archived: false,
          latest_classification: "AUTO_REPLY",
          campaign_id: null,
          campaign_name: null,
          latest_message_date: threeDaysAgo,
          earliest_message_date: threeDaysAgo,
        },
        {
          org_id: orgId,
          subject: "Re: Quick question about your practice",
          snippet:
            "We're not interested in advertising partnerships at this time. Thanks anyway.",
          message_count: 3,
          participants: ["rchen@bayareachiro.com"],
          account_emails: ["mike@demo-outreach.com"],
          has_unread: true,
          is_starred: false,
          is_archived: false,
          latest_classification: "OBJECTION",
          campaign_id: campaign1Id,
          campaign_name: "Demo Campaign - Healthcare Outreach",
          latest_message_date: now,
          earliest_message_date: sevenDaysAgo,
        },
      ])
      .select();

    if (threadsError) {
      throw new Error(`Failed to seed inbox threads: ${threadsError.message}`);
    }

    // Insert messages for each thread
    const threadIds = threadsData?.map((t) => t.id) || [];

    if (threadIds.length >= 3) {
      const { error: messagesError } = await supabase
        .from("inbox_messages")
        .insert([
          // Thread 1 messages
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[0],
            direction: "outbound",
            from_email: "alex@demo-outreach.com",
            from_name: "Alex Johnson",
            to_emails: ["jwilliams@sunrisefamilymed.com"],
            cc_emails: [],
            subject:
              "Healthcare Partnership Opportunity",
            body_html:
              "<p>Hi Jennifer,</p><p>I noticed Sunrise Family Medicine and wanted to reach out about a unique advertising opportunity...</p>",
            body_text:
              "Hi Jennifer,\n\nI noticed Sunrise Family Medicine and wanted to reach out about a unique advertising opportunity...",
            classification: "SENT",
            received_date: threeDaysAgo,
          },
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[0],
            direction: "inbound",
            from_email: "jwilliams@sunrisefamilymed.com",
            from_name: "Jennifer Williams",
            to_emails: ["alex@demo-outreach.com"],
            cc_emails: [],
            subject: "Re: Healthcare Partnership Opportunity",
            body_html:
              "<p>Hi Alex,</p><p>Yes, I'm interested in learning more about this opportunity. Could you send me some details?</p>",
            body_text:
              "Hi Alex,\n\nYes, I'm interested in learning more about this opportunity. Could you send me some details?",
            classification: "INTERESTED",
            received_date: now,
          },
          // Thread 2 messages
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[1],
            direction: "outbound",
            from_email: "sarah@demo-outreach.com",
            from_name: "Sarah Chen",
            to_emails: ["alopez@westsidewellness.com"],
            cc_emails: [],
            subject: "Wellness Center Visibility Program",
            body_html:
              "<p>Hi Angela,</p><p>I wanted to reach out about our wellness center advertising program...</p>",
            body_text:
              "Hi Angela,\n\nI wanted to reach out about our wellness center advertising program...",
            classification: "SENT",
            received_date: threeDaysAgo,
          },
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[1],
            direction: "inbound",
            from_email: "alopez@westsidewellness.com",
            from_name: "Angela Lopez",
            to_emails: ["sarah@demo-outreach.com"],
            cc_emails: [],
            subject: "Re: Wellness Center Visibility Program",
            body_html:
              "<p>Thank you for your email. This is an automated reply. I will respond to your message shortly.</p>",
            body_text:
              "Thank you for your email. This is an automated reply. I will respond to your message shortly.",
            classification: "AUTO_REPLY",
            received_date: threeDaysAgo,
          },
          // Thread 3 messages
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[2],
            direction: "outbound",
            from_email: "mike@demo-outreach.com",
            from_name: "Mike Roberts",
            to_emails: ["rchen@bayareachiro.com"],
            cc_emails: [],
            subject: "Quick question about your practice",
            body_html:
              "<p>Hi Robert,</p><p>I have a quick question about your chiropractic practice...</p>",
            body_text:
              "Hi Robert,\n\nI have a quick question about your chiropractic practice...",
            classification: "SENT",
            received_date: sevenDaysAgo,
          },
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[2],
            direction: "inbound",
            from_email: "rchen@bayareachiro.com",
            from_name: "Robert Chen",
            to_emails: ["mike@demo-outreach.com"],
            cc_emails: [],
            subject: "Re: Quick question about your practice",
            body_html:
              "<p>Hi Mike,</p><p>Thanks for reaching out. We're not interested in advertising partnerships at this time.</p>",
            body_text:
              "Hi Mike,\n\nThanks for reaching out. We're not interested in advertising partnerships at this time.",
            classification: "OBJECTION",
            received_date: now,
          },
          {
            org_id: orgId,
            account_id: firstEmailId,
            thread_id: threadIds[2],
            direction: "outbound",
            from_email: "mike@demo-outreach.com",
            from_name: "Mike Roberts",
            to_emails: ["rchen@bayareachiro.com"],
            cc_emails: [],
            subject: "Re: Quick question about your practice",
            body_html:
              "<p>Hi Robert,</p><p>No problem, thanks for letting me know. Feel free to reach out if circumstances change in the future.</p>",
            body_text:
              "Hi Robert,\n\nNo problem, thanks for letting me know. Feel free to reach out if circumstances change in the future.",
            classification: "SENT",
            received_date: now,
          },
        ]);

      if (messagesError) {
        throw new Error(
          `Failed to seed inbox messages: ${messagesError.message}`
        );
      }
    }

    console.log(`✅ Seeded 3 inbox threads with messages\n`);

    console.log("🎉 Friend test data seeded successfully!");
    console.log(`\n📊 Summary:`);
    console.log(`   • 2 server pairs`);
    console.log(`   • 5 email accounts`);
    console.log(`   • 2 campaigns`);
    console.log(`   • 1 campaign sequence with 3 steps`);
    console.log(`   • 10 lead contacts`);
    console.log(`   • 3 inbox threads with 8 messages`);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

main();
