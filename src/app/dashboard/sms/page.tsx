export const dynamic = 'force-dynamic';

import { getSmsWorkflows } from "@/lib/supabase/queries";
import SmsClient from "./sms-client";

export default async function SMSPage() {
  const workflows = await getSmsWorkflows();
  return <SmsClient workflows={workflows} />;
}
