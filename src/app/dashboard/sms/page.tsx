export const dynamic = 'force-dynamic';

import { getSmsWorkflows } from "@/lib/supabase/queries";
import SmsClient from "./sms-client";

export default async function SMSPage() {
  let workflows: Awaited<ReturnType<typeof getSmsWorkflows>> = [];
  try {
    workflows = await getSmsWorkflows();
  } catch {
    workflows = [];
  }
  return <SmsClient workflows={workflows} />;
}
