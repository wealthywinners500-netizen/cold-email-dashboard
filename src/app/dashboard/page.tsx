export const dynamic = 'force-dynamic';

import { getDashboardOverview } from "@/lib/supabase/queries";
import OverviewClient from "./overview-client";

export default async function DashboardOverview() {
  const data = await getDashboardOverview();
  return <OverviewClient data={data} />;
}
