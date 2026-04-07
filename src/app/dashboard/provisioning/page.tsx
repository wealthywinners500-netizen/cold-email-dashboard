export const dynamic = 'force-dynamic';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rocket } from "lucide-react";

export default function ProvisioningPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Provisioning</h1>
        <p className="text-gray-400 mt-2">
          Automated server pair deployment — from VPS creation to verified mail delivery
        </p>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            Server Provisioning
            <Badge className="bg-yellow-900 text-yellow-200 ml-2">Coming Soon</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400">
            One-click server pair deployment is under development. Configure your VPS providers
            and DNS registrars in Settings to prepare for automated provisioning.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-800/50 rounded-lg">
              <p className="text-white font-medium mb-1">Phase 1</p>
              <p className="text-gray-400 text-sm">Database schema + provider abstraction</p>
              <Badge className="bg-green-900 text-green-200 mt-2">Complete</Badge>
            </div>
            <div className="p-4 bg-gray-800/50 rounded-lg">
              <p className="text-white font-medium mb-1">Phase 2</p>
              <p className="text-gray-400 text-sm">Clouding + IONOS API integration</p>
              <Badge className="bg-gray-800 text-gray-400 mt-2">Pending</Badge>
            </div>
            <div className="p-4 bg-gray-800/50 rounded-lg">
              <p className="text-white font-medium mb-1">Phase 3</p>
              <p className="text-gray-400 text-sm">Provisioning wizard + real-time progress</p>
              <Badge className="bg-gray-800 text-gray-400 mt-2">Pending</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
