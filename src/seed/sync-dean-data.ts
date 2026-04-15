import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// Lazy init pattern - no module-scope client
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    // Load environment variables
    try {
      require("dotenv").config({ path: ".env.local" });
    } catch (e) {
      // dotenv optional
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables"
      );
      process.exit(1);
    }

    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }

  return _supabase;
}

// Server pair data (8 pairs)
const SERVER_PAIRS_DATA = [
  {
    pair_number: 1,
    ns_domain: "grocerysynergy.info",
    s1_ip: "187.33.145.55",
    s1_hostname: "mail1.grocerysynergy.info",
    s2_ip: "185.253.155.145",
    s2_hostname: "mail2.grocerysynergy.info",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 2,
    ns_domain: "krogernetworks.info",
    s1_ip: "27.0.174.55",
    s1_hostname: "mail1.krogernetworks.info",
    s2_ip: "217.71.202.214",
    s2_hostname: "mail2.krogernetworks.info",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 3,
    ns_domain: "krogertogether.info",
    s1_ip: "79.143.93.98",
    s1_hostname: "mail1.krogertogether.info",
    s2_ip: "79.143.94.164",
    s2_hostname: "mail2.krogertogether.info",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 4,
    ns_domain: "marketpartners.info",
    s1_ip: "200.234.225.136",
    s1_hostname: "mail1.marketpartners.info",
    s2_ip: "187.33.147.57",
    s2_hostname: "mail2.marketpartners.info",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 5,
    ns_domain: "partner-with-kroger.info",
    s1_ip: "195.201.164.217",
    s1_hostname: "mail1.partner-with-kroger.info",
    s2_ip: "195.201.164.218",
    s2_hostname: "mail2.partner-with-kroger.info",
    status: "setup",
    mxtoolbox_errors: 0, // Note: 9 of 10 domains Spamhaus DBL blacklisted (manual note)
  },
  {
    pair_number: 6,
    ns_domain: "partnerwithkroger.online",
    s1_ip: "200.234.229.210",
    s1_hostname: "mail1.partnerwithkroger.online",
    s2_ip: "200.234.229.211",
    s2_hostname: "mail2.partnerwithkroger.online",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 7,
    ns_domain: "partnerwithkroger.org",
    s1_ip: "185.247.112.94",
    s1_hostname: "mail1.partnerwithkroger.org",
    s2_ip: "185.247.112.95",
    s2_hostname: "mail2.partnerwithkroger.org",
    status: "complete",
    mxtoolbox_errors: 0,
  },
  {
    pair_number: 8,
    ns_domain: "partnerwithkroger.store",
    s1_ip: "94.142.161.254",
    s1_hostname: "mail1.partnerwithkroger.store",
    s2_ip: "94.142.161.255",
    s2_hostname: "mail2.partnerwithkroger.store",
    status: "complete",
    mxtoolbox_errors: 0,
  },
];

// Campaign data (8 campaigns)
const CAMPAIGNS_DATA = [
  {
    name: "GA Med Practice Kroger - Direct Pitch",
    snovio_id: "2946984",
    region: "GA",
    store_chain: "Kroger",
    status: "active",
    subject_lines: [
      "Direct Pitch A",
      "Direct Pitch B",
      "Direct Pitch C",
      "Direct Pitch D",
    ],
    recipients: 0,
  },
  {
    name: "GA Med Practice Kroger - Question Hook",
    snovio_id: "2946985",
    region: "GA",
    store_chain: "Kroger",
    status: "active",
    subject_lines: [
      "Question Hook A",
      "Question Hook B",
      "Question Hook C",
      "Question Hook D",
    ],
    recipients: 0,
  },
  {
    name: "LI Med Spa Stop & Shop Kiosks - Local Feature",
    snovio_id: "2946995",
    region: "NY",
    store_chain: "Stop & Shop",
    status: "active",
    subject_lines: [
      "Local Feature A",
      "Local Feature B",
      "Local Feature C",
      "Local Feature D",
    ],
    recipients: 0,
  },
  {
    name: "LI Med Spa Stop & Shop Kiosks - Question Hook",
    snovio_id: "2946996",
    region: "NY",
    store_chain: "Stop & Shop",
    status: "active",
    subject_lines: [
      "Question Hook A",
      "Question Hook B",
      "Question Hook C",
      "Question Hook D",
    ],
    recipients: 0,
  },
  {
    name: "LI Med Practice Stop & Shop Kiosks A",
    snovio_id: "2946341",
    region: "NY",
    store_chain: "Stop & Shop",
    status: "active",
    subject_lines: ["Visibility Pitch"],
    recipients: 0,
  },
  {
    name: "LI Med Practice Stop & Shop Kiosks B",
    snovio_id: "2946347",
    region: "NY",
    store_chain: "Stop & Shop",
    status: "active",
    subject_lines: ["Question Hook"],
    recipients: 0,
  },
  {
    name: "Med Practice Snov TX Octoparse 1",
    snovio_id: null,
    region: "TX",
    store_chain: "Kroger",
    status: "active",
    subject_lines: [
      "TX Campaign 1 Step 1",
      "TX Campaign 1 Step 2",
      "TX Campaign 1 Step 3",
    ],
    recipients: 846,
  },
  {
    name: "Med Practice Snov TX Octoparse 2",
    snovio_id: null,
    region: "TX",
    store_chain: "Kroger",
    status: "active",
    subject_lines: [
      "TX Campaign 2 Step 1",
      "TX Campaign 2 Step 2",
      "TX Campaign 2 Step 3",
    ],
    recipients: 6190,
  },
];

// CSV mapping: pair_number -> csv filename
const CSV_PAIR_MAP: Record<number, string> = {
  1: "pair_1_accounts.csv",
  2: "pair_2_accounts.csv",
  3: "pair_3_accounts.csv",
  4: "pair_4_accounts.csv",
  7: "pair_7_accounts.csv",
  8: "pair_8_accounts.csv",
  // Pairs 5 and 6 have no CSV
};

/**
 * Get or create organization
 * If DEAN_ORG_ID is provided, use it. Otherwise, query for existing or create.
 */
async function getOrCreateOrg(): Promise<string> {
  const supabase = getSupabase();
  const deanOrgId = process.env.DEAN_ORG_ID;

  if (deanOrgId) {
    console.log(`Using DEAN_ORG_ID: ${deanOrgId}`);
    return deanOrgId;
  }

  // Query for first org or org containing "StealthMail" or "Terraboost"
  const { data: orgs, error: queryError } = await supabase
    .from("organizations")
    .select("id, name")
    .limit(1);

  if (queryError) {
    throw new Error(`Failed to query organizations: ${queryError.message}`);
  }

  if (orgs && orgs.length > 0) {
    console.log(`Found existing organization: ${orgs[0].name} (${orgs[0].id})`);
    return orgs[0].id;
  }

  // Create new org
  const newOrgId = "org_stealthmail_" + Date.now();
  console.log(`Creating new organization: ${newOrgId}`);

  const { error: createError } = await supabase
    .from("organizations")
    .insert({
      id: newOrgId,
      name: "StealthMail",
      clerk_org_id: deanOrgId || "clerk_" + newOrgId,
      plan_tier: "pro",
    });

  if (createError) {
    throw new Error(`Failed to create organization: ${createError.message}`);
  }

  return newOrgId;
}

/**
 * Sync server pairs (idempotent by ns_domain + org_id)
 * Returns map of pair_number -> id for linking
 */
async function syncServerPairs(
  orgId: string
): Promise<Map<number, string>> {
  const supabase = getSupabase();
  console.log("\nSyncing 8 server pairs...");

  const pairMap = new Map<number, string>();

  for (const pairData of SERVER_PAIRS_DATA) {
    // Check if already exists
    const { data: existing, error: selectError } = await supabase
      .from("server_pairs")
      .select("id")
      .eq("org_id", orgId)
      .eq("ns_domain", pairData.ns_domain)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to query pair ${pairData.pair_number}: ${selectError.message}`);
    }

    if (existing) {
      console.log(`  Pair ${pairData.pair_number}: ${pairData.ns_domain} (exists, id=${existing.id})`);
      pairMap.set(pairData.pair_number, existing.id);
      continue;
    }

    // Insert new pair
    const { data: inserted, error: insertError } = await supabase
      .from("server_pairs")
      .insert({
        org_id: orgId,
        ...pairData,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      throw new Error(`Failed to insert pair ${pairData.pair_number}: ${insertError.message}`);
    }

    if (!inserted) {
      throw new Error(`No data returned for pair ${pairData.pair_number}`);
    }

    console.log(`  Pair ${pairData.pair_number}: ${pairData.ns_domain} (inserted, id=${inserted.id})`);
    pairMap.set(pairData.pair_number, inserted.id);
  }

  console.log(`Synced ${pairMap.size} server pairs`);
  return pairMap;
}

/**
 * Parse CSV file and return array of rows
 */
async function parseCSV(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];
  let isFirstRow = true;

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (isFirstRow) {
        headers = line.split(",").map((h) => h.trim());
        isFirstRow = false;
        return;
      }

      const values = line.split(",").map((v) => v.trim());
      const row: Record<string, string> = {};

      headers.forEach((header, idx) => {
        row[header] = values[idx] || "";
      });

      rows.push(row);
    });

    rl.on("close", () => resolve(rows));
    rl.on("error", reject);
  });
}

/**
 * Sync email accounts from CSVs (idempotent by email + org_id)
 */
async function syncEmailAccountsFromCSVs(
  orgId: string,
  pairMap: Map<number, string>
): Promise<number> {
  const supabase = getSupabase();
  console.log("\nSyncing email accounts from CSVs...");

  const csvDir = process.env.CSV_DIR || "../snovio_csvs_v2";
  const csvDirAbsolute = path.resolve(process.cwd(), csvDir);

  let totalAccounts = 0;

  for (const [pairNumber, csvFileName] of Object.entries(CSV_PAIR_MAP)) {
    const pairNum = parseInt(pairNumber, 10);
    const csvPath = path.join(csvDirAbsolute, csvFileName);

    if (!fs.existsSync(csvPath)) {
      console.log(`  Pair ${pairNum}: CSV not found (${csvPath}), skipping`);
      continue;
    }

    console.log(`  Pair ${pairNum}: parsing ${csvFileName}...`);

    let rows: Record<string, string>[] = [];
    try {
      rows = await parseCSV(csvPath);
    } catch (err) {
      console.warn(`    Error parsing CSV: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const serverPairId = pairMap.get(pairNum);
    if (!serverPairId) {
      console.warn(`    No server_pair_id found for pair ${pairNum}, skipping`);
      continue;
    }

    let pairAccountCount = 0;

    for (const row of rows) {
      const email = row["From Email*"]?.trim();
      if (!email) continue;

      // Check if already exists
      const { data: existing, error: selectError } = await supabase
        .from("email_accounts")
        .select("id")
        .eq("org_id", orgId)
        .eq("email", email)
        .maybeSingle();

      if (selectError) {
        console.warn(`      Error checking email ${email}: ${selectError.message}`);
        continue;
      }

      if (existing) {
        // Already exists, skip
        pairAccountCount++;
        totalAccounts++;
        continue;
      }

      // Parse daily limit, default to 30
      const dailyLimit = parseInt(row["Daily Limit"] || "30", 10) || 30;

      // Insert new account
      const { error: insertError } = await supabase
        .from("email_accounts")
        .insert({
          org_id: orgId,
          email,
          display_name: row["From Name*"]?.trim() || "",
          smtp_host: row["SMTP Host*"]?.trim() || "",
          smtp_port: 587,
          smtp_user: row["Username"]?.trim() || email,
          smtp_pass: row["SMTP Password*"]?.trim() || "",
          smtp_secure: false,  // Port 587 = STARTTLS = secure:false (Hard Lesson)
          imap_host: row["IMAP Host*"]?.trim() || row["SMTP Host*"]?.trim() || "",
          imap_port: 993,
          imap_secure: true,
          server_pair_id: serverPairId,
          status: "active",
          daily_send_limit: dailyLimit,
        });

      if (insertError) {
        console.warn(`      Error inserting ${email}: ${insertError.message}`);
        continue;
      }

      pairAccountCount++;
      totalAccounts++;
    }

    console.log(`    Pair ${pairNum}: synced ${pairAccountCount} accounts`);
  }

  console.log(`Total email accounts synced: ${totalAccounts}`);
  return totalAccounts;
}

/**
 * Sync campaigns (idempotent by name + org_id)
 */
async function syncCampaigns(orgId: string): Promise<number> {
  const supabase = getSupabase();
  console.log("\nSyncing 8 campaigns...");

  let syncedCount = 0;

  for (const campaignData of CAMPAIGNS_DATA) {
    // Check if already exists
    const { data: existing, error: selectError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", campaignData.name)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to query campaign ${campaignData.name}: ${selectError.message}`);
    }

    if (existing) {
      console.log(`  Campaign: ${campaignData.name} (exists)`);
      syncedCount++;
      continue;
    }

    // Insert new campaign
    const { error: insertError } = await supabase
      .from("campaigns")
      .insert({
        org_id: orgId,
        ...campaignData,
      });

    if (insertError) {
      throw new Error(`Failed to insert campaign ${campaignData.name}: ${insertError.message}`);
    }

    console.log(`  Campaign: ${campaignData.name} (inserted)`);
    syncedCount++;
  }

  console.log(`Synced ${syncedCount} campaigns`);
  return syncedCount;
}

/**
 * Main entry point
 */
async function main() {
  console.log("=== Dean Data Sync (Idempotent) ===\n");

  try {
    const orgId = await getOrCreateOrg();
    const pairMap = await syncServerPairs(orgId);
    const accountCount = await syncEmailAccountsFromCSVs(orgId, pairMap);
    const campaignCount = await syncCampaigns(orgId);

    console.log("\n=== Sync Complete ===");
    console.log(`Organization: ${orgId}`);
    console.log(`Server Pairs: ${pairMap.size}`);
    console.log(`Email Accounts: ${accountCount}`);
    console.log(`Campaigns: ${campaignCount}`);
  } catch (error) {
    console.error(
      "\nFatal error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
