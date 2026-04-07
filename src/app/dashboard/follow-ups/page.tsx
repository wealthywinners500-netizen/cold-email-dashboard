export const dynamic = 'force-dynamic';

import { getFollowUps } from "@/lib/supabase/queries";
import FollowUpsClient from "./follow-ups-client";

export default async function FollowUpsPage() {
  let followUps: Awaited<ReturnType<typeof getFollowUps>> = [];
  try {
    followUps = await getFollowUps();
  } catch {
    followUps = [];
  }
  return <FollowUpsClient followUps={followUps} />;
}
