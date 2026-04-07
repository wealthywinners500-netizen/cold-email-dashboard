export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { getDashboardOverview, getTableCounts, getDashboardMetrics } from "@/lib/supabase/queries";
import OverviewClient from "./overview-client";
import OnboardingWizard from "@/components/onboarding/onboarding-wizard";

export default async function DashboardOverview() {
  const { orgId } = await auth();
  const hasOrg = !!orgId;

  try {
    // Check if org has any data
    const counts = await getTableCounts();
    const hasData =
      counts.server_pairs > 0 ||
      counts.campaigns > 0 ||
      counts.leads > 0 ||
      counts.follow_ups > 0 ||
      counts.sms_workflows > 0 ||
      counts.sending_domains > 0;

    // If has data, show dashboard
    if (hasData) {
      const [data, metrics] = await Promise.all([
        getDashboardOverview(),
        getDashboardMetrics(counts._orgId).catch(() => null),
      ]);
      return <OverviewClient data={data} metrics={metrics} />;
    }

    // No data, show onboarding wizard
    return <OnboardingWizard hasOrg={hasOrg} />;
  } catch (error) {
    // Organization not in Supabase yet, show onboarding wizard
    return <OnboardingWizard hasOrg={hasOrg} />;
  }
}
