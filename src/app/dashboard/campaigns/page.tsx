export const dynamic = 'force-dynamic';

import { getCampaigns } from "@/lib/supabase/queries";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  try {
    campaigns = await getCampaigns();
  } catch {
    campaigns = [];
  }
  return <CampaignsClient campaigns={campaigns} />;
}
