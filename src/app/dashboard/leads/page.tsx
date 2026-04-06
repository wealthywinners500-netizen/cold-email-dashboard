export const dynamic = 'force-dynamic';

import { getLeads } from "@/lib/supabase/queries";
import LeadsClient from "./leads-client";

export default async function LeadsPage() {
  const leads = await getLeads();
  return <LeadsClient leads={leads} />;
}
