export const dynamic = 'force-dynamic';

import { getServerPairs } from "@/lib/supabase/queries";
import ServersClient from "./servers-client";

export default async function ServersPage() {
  const serverPairs = await getServerPairs();
  return <ServersClient serverPairs={serverPairs} />;
}
