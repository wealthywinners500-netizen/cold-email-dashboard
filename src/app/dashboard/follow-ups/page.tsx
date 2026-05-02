export const dynamic = 'force-dynamic';

import { getFollowUps, getOrgSubsequences, getCampaigns } from "@/lib/supabase/queries";
import FollowUpsClient from "./follow-ups-client";

export default async function FollowUpsPage() {
  // CC #UI-4 (2026-05-02): parallel-fetch followUps + subsequences + campaigns
  // so the new Subsequences tab + its CampaignPicker can render without
  // additional client roundtrips. Failures degrade to empty arrays.
  let followUps: Awaited<ReturnType<typeof getFollowUps>> = [];
  let subsequences: Awaited<ReturnType<typeof getOrgSubsequences>> = [];
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  try {
    [followUps, subsequences, campaigns] = await Promise.all([
      getFollowUps(),
      getOrgSubsequences(),
      getCampaigns(),
    ]);
  } catch {
    // partial failure recovers per-fetch
    try { followUps = await getFollowUps(); } catch { followUps = []; }
    try { subsequences = await getOrgSubsequences(); } catch { subsequences = []; }
    try { campaigns = await getCampaigns(); } catch { campaigns = []; }
  }
  return (
    <FollowUpsClient
      followUps={followUps}
      subsequences={subsequences}
      campaigns={campaigns}
    />
  );
}
