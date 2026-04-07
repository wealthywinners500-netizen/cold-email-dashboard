export const dynamic = 'force-dynamic';

import { getServerPairs } from "@/lib/supabase/queries";
import ServersClient from "./servers-client";

export default async function ServersPage() {
  let serverPairs: Awaited<ReturnType<typeof getServerPairs>> = [];
  try {
    serverPairs = await getServerPairs();
  } catch {
    serverPairs = [];
  }
  return <ServersClient serverPairs={serverPairs} />;
}
