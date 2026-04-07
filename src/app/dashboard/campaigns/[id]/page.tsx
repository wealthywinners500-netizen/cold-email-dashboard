export const dynamic = 'force-dynamic';

import { getCampaigns, getSequences, getLeadSequenceStates, getCampaignStats, getCampaignAnalytics, getDailySendVolume, getCampaignRecipientsForAnalytics } from "@/lib/supabase/queries";
import CampaignDetailClient from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = id;

  // Fetch campaign by finding it in the full list
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  try {
    campaigns = await getCampaigns();
  } catch {
    campaigns = [];
  }
  const campaign = campaigns.find((c: any) => c.id === campaignId);

  if (!campaign) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Campaign Not Found</h1>
          <p className="text-gray-400">The campaign you are looking for does not exist.</p>
        </div>
      </div>
    );
  }

  // Fetch sequences, lead states, and analytics
  const [sequences, leadStatesResult, stats, analytics, dailyVolume, recipientsResult] = await Promise.all([
    getSequences(campaignId),
    getLeadSequenceStates(campaignId, { limit: 50 }),
    getCampaignStats(campaignId),
    getCampaignAnalytics(campaignId).catch(() => null),
    getDailySendVolume(campaignId).catch(() => []),
    getCampaignRecipientsForAnalytics(campaignId, 1, 50).catch(() => ({ data: [], count: 0 })),
  ]);

  return (
    <CampaignDetailClient
      campaign={campaign}
      sequences={sequences}
      leadStates={leadStatesResult.data}
      stats={stats}
      analytics={analytics}
      dailyVolume={dailyVolume}
      analyticsRecipients={recipientsResult.data || []}
      analyticsRecipientsCount={recipientsResult.count ?? 0}
    />
  );
}
