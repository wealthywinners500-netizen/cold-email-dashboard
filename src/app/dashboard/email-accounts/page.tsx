
import { getEmailAccounts } from "@/lib/supabase/queries";
import EmailAccountsClient from "./email-accounts-client";

export default async function EmailAccountsPage() {
  let accounts: Awaited<ReturnType<typeof getEmailAccounts>> = [];
  try {
    accounts = await getEmailAccounts();
  } catch {
    accounts = [];
  }

  return <EmailAccountsClient accounts={accounts} />;
}
