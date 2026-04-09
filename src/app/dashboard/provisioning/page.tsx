export const dynamic = 'force-dynamic';

import { Rocket } from "lucide-react";
import ProvisioningClient from "./provisioning-client";

export default function ProvisioningPage() {
  // Note: hasProviders check is done client-side in ProvisioningClient
  // to avoid server-side auth complexity in the page component
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Rocket className="w-8 h-8 text-blue-400" />
          Provisioning
        </h1>
        <p className="text-gray-400 mt-2">
          Automated server pair deployment — from VPS creation to verified mail delivery
        </p>
      </div>

      <ProvisioningClient hasProviders={true} />
    </div>
  );
}
