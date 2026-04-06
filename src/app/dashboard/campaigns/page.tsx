import { getCampaigns } from "@/lib/supabase/queries";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();
  return <CampaignsClient campaigns={campaigns} />;
}
