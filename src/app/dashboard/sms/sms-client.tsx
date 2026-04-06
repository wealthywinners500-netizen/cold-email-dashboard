"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone,
  MessageCircle,
  AlertCircle,
  Zap,
  MapPin,
  Cloud,
  AlertTriangle,
} from "lucide-react";

interface SmsWorkflow {
  id: string;
  org_id: string;
  stage: string;
  name: string;
  message_type: string;
  message_count: number;
  description: string;
  tag_applied: string;
  region: string;
  store_chains: string;
  status: string;
  created_at: string;
}

interface SmsClientProps {
  workflows: SmsWorkflow[];
}

const stageColorMap: Record<string, string> = {
  A0: "#3b82f6",
  A2: "#10b981",
  "A3+": "#eab308",
  A4: "#ef4444",
};

const stageBadgeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  A0: "default",
  A2: "default",
  "A3+": "secondary",
  A4: "destructive",
};

export default function SmsClient({ workflows }: SmsClientProps) {
  // Calculate overview stats
  const stats = useMemo(() => {
    const totalMessages = workflows.reduce((sum, w) => sum + w.message_count, 0);
    const uniqueRegions = new Set(workflows.map((w) => w.region));
    const regionsString = Array.from(uniqueRegions).join(", ") || "Multiple";

    return {
      totalMessages,
      region: regionsString.length > 40 ? "Multiple" : regionsString,
      platform: "Telnyx SMS / Go High Level",
      status: "Active",
    };
  }, [workflows]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">SMS & Text Marketing</h1>
          <p className="text-gray-400 mt-2">
            Go High Level text campaigns and workflows
          </p>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Messages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {stats.totalMessages}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Region
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-white">{stats.region}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Platform
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold text-white">
              {stats.platform}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className="bg-green-500 text-white">{stats.status}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Stage Cards */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Workflow Stages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="bg-gray-900 border-gray-800">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-white text-lg">
                      {workflow.name}
                    </CardTitle>
                    <p className="text-sm text-gray-400 mt-2">
                      {workflow.description}
                    </p>
                  </div>
                  <Badge
                    variant={stageBadgeVariants[workflow.stage] || "secondary"}
                    className="ml-2"
                  >
                    {workflow.stage}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-gray-400 text-xs uppercase">Type</p>
                    <Badge variant="outline" className="text-white border-gray-700 mt-1">
                      {workflow.message_type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-gray-400 text-xs uppercase">
                      Message Count
                    </p>
                    <p className="text-white font-semibold mt-1">
                      {workflow.message_count}
                    </p>
                  </div>
                </div>

                <div className="border-t border-gray-800 pt-4">
                  <p className="text-gray-400 text-xs uppercase mb-2">Tag</p>
                  <Badge className="bg-blue-900 text-blue-200">
                    {workflow.tag_applied}
                  </Badge>
                </div>

                <div className="flex gap-2 text-gray-400 text-xs">
                  <MapPin className="w-4 h-4 mt-0.5" />
                  <span>{workflow.region}</span>
                </div>

                <div className="flex gap-2 text-gray-400 text-xs">
                  <Cloud className="w-4 h-4 mt-0.5" />
                  <span>{workflow.store_chains}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Key SMS Rules */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Key SMS Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-3 text-sm">
              <div className="text-green-400 font-bold mt-0.5">✓</div>
              <p className="text-white">Messages under 160 characters (1 credit)</p>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="text-green-400 font-bold mt-0.5">✓</div>
              <p className="text-white">Multi-part messages split at 153 chars</p>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="text-green-400 font-bold mt-0.5">✓</div>
              <p className="text-white">No numbers-only messages (carrier blocks)</p>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="text-green-400 font-bold mt-0.5">✓</div>
              <p className="text-white">No consecutive duplicates in 24h</p>
            </div>
            <div className="flex gap-3 text-sm">
              <div className="text-green-400 font-bold mt-0.5">✓</div>
              <p className="text-white">Opt-in verification required</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deliverables */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-400" />
            Deliverables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="text-blue-400 font-bold mt-0.5">+</div>
              <div>
                <p className="text-white font-medium">135 Total Messages</p>
                <p className="text-gray-400 text-sm">
                  Across all workflow stages
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-blue-400 font-bold mt-0.5">+</div>
              <div>
                <p className="text-white font-medium">4 Workflow Stages</p>
                <p className="text-gray-400 text-sm">
                  A0, A2, A3+, A4 progression
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-blue-400 font-bold mt-0.5">+</div>
              <div>
                <p className="text-white font-medium">NY Tops + Stop & Shop</p>
                <p className="text-gray-400 text-sm">
                  Primary store chains targeted
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="text-blue-400 font-bold mt-0.5">+</div>
              <div>
                <p className="text-white font-medium">Carrier Block Prevention</p>
                <p className="text-gray-400 text-sm">
                  Telnyx monitoring and alerts
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Region Expansion Plan */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            Region Expansion Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-l-4 border-green-500 pl-4">
              <p className="text-green-400 font-semibold text-sm">Phase 1 (Complete)</p>
              <p className="text-gray-400 text-sm mt-1">
                NY region: NY Tops, Stop & Shop, regional chains
              </p>
            </div>
            <div className="border-l-4 border-yellow-500 pl-4">
              <p className="text-yellow-400 font-semibold text-sm">Phase 2 (Planned)</p>
              <p className="text-gray-400 text-sm mt-1">
                GA & regional expansion with segment-specific messaging
              </p>
            </div>
            <div className="border-l-4 border-gray-500 pl-4">
              <p className="text-gray-400 font-semibold text-sm">Phase 3 (Future)</p>
              <p className="text-gray-400 text-sm mt-1">
                National rollout with vertical-specific compliance
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
