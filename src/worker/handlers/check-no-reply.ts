import { createClient } from "@supabase/supabase-js";
import { checkNoReplyTriggers } from "../../lib/email/sequence-engine";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function handleCheckNoReply(): Promise<void> {
  const supabase = getSupabase();

  console.log("[CheckNoReply] Starting no-reply trigger check...");

  try {
    // 1. Query all distinct org_ids from lead_sequence_state where status IN ('active', 'completed')
    const { data: states, error: statesErr } = await supabase
      .from("lead_sequence_state")
      .select("org_id")
      .in("status", ["active", "completed"]);

    if (statesErr) {
      console.error("[CheckNoReply] Failed to fetch sequence states:", statesErr);
      throw statesErr;
    }

    // Extract unique org_ids
    const orgIds = Array.from(new Set((states || []).map((s: any) => s.org_id)));

    console.log(`[CheckNoReply] Found ${orgIds.length} organizations with active sequences`);

    // 2. For each org_id, call checkNoReplyTriggers(orgId)
    for (const orgId of orgIds) {
      try {
        console.log(`[CheckNoReply] Processing org ${orgId}...`);
        await checkNoReplyTriggers(orgId);
        console.log(`[CheckNoReply] Completed org ${orgId}`);
      } catch (orgErr) {
        console.error(`[CheckNoReply] Error processing org ${orgId}:`, orgErr);
        // Continue processing other orgs on error
      }
    }

    console.log("[CheckNoReply] No-reply trigger check completed");
  } catch (err) {
    console.error("[CheckNoReply] Fatal error:", err);
    throw err;
  }
}
