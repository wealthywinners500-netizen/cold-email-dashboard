import { getFollowUps } from "@/lib/supabase/queries";
import FollowUpsClient from "./follow-ups-client";

export default async function FollowUpsPage() {
  const followUps = await getFollowUps();
  return <FollowUpsClient followUps={followUps} />;
}
