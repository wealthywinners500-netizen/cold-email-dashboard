"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtimeRefresh } from "@/hooks/use-realtime";

interface FollowUp {
  id: string;
  org_id: string;
  campaign_id: string;
  thread_id: string;
  classification: string;
  template_assigned: boolean;
  action_needed: boolean;
  last_reply_date: string | null;
  created_at: string;
}

interface FollowUpsClientProps {
  followUps: FollowUp[];
}

const classificationColorMap: Record<string, string> = {
  INTERESTED: "#10b981",
  STOP: "#ef4444",
  POLITE_DECLINE: "#f97316",
  OBJECTION: "#eab308",
  AUTO_REPLY: "#3b82f6",
  BOUNCE: "#6b7280",
};

const classificationBadgeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  INTERESTED: "default",
  STOP: "destructive",
  POLITE_DECLINE: "secondary",
  OBJECTION: "secondary",
  AUTO_REPLY: "outline",
  BOUNCE: "secondary",
};

export default function FollowUpsClient({ followUps }: FollowUpsClientProps) {
  const [activeTab, setActiveTab] = useState("group-a");
  useRealtimeRefresh("follow_ups");

  // Calculate classification breakdown
  const classificationBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {};
    followUps.forEach((fu) => {
      breakdown[fu.classification] = (breakdown[fu.classification] || 0) + 1;
    });
    return breakdown;
  }, [followUps]);

  if (followUps.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Follow-Ups</h1>
          <p className="text-gray-400 mt-2">Manage follow-up replies and track engagement</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageSquare className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No follow-up threads yet</h3>
          <p className="text-gray-400 mb-6 max-w-md">Follow-up threads will appear here once your campaigns start receiving replies.</p>
          <a href="/dashboard/campaigns" className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors">
            View Campaigns
          </a>
        </div>
      </div>
    );
  }

  // Group A: INTERESTED with action_needed
  const groupA = useMemo(() => {
    return followUps.filter(
      (fu) => fu.classification === "INTERESTED" && fu.action_needed
    );
  }, [followUps]);

  // Group B: POLITE_DECLINE or OBJECTION with template_assigned
  const groupB = useMemo(() => {
    return followUps.filter(
      (fu) =>
        (fu.classification === "POLITE_DECLINE" ||
          fu.classification === "OBJECTION") &&
        fu.template_assigned
    );
  }, [followUps]);

  // Group C: Rest
  const groupC = useMemo(() => {
    return followUps.filter(
      (fu) =>
        !groupA.includes(fu) && !groupB.includes(fu)
    );
  }, [followUps, groupA, groupB]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Follow-Ups</h1>
          <p className="text-gray-400 mt-2">
            Manage follow-up replies and track engagement
          </p>
        </div>
      </div>

      {/* Classification Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {Object.entries(classificationBreakdown)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([classification, count]) => (
            <Card key={classification} className="bg-gray-900 border-gray-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">
                  {classification.replace(/_/g, " ")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="text-3xl font-bold"
                  style={{ color: classificationColorMap[classification] }}
                >
                  {count}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Tab Navigation */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Follow-Up Groups</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3 bg-gray-800">
              <TabsTrigger
                value="group-a"
                className="data-[state=active]:bg-blue-600"
              >
                Group A: Action Needed ({groupA.length})
              </TabsTrigger>
              <TabsTrigger
                value="group-b"
                className="data-[state=active]:bg-blue-600"
              >
                Group B: Templated ({groupB.length})
              </TabsTrigger>
              <TabsTrigger
                value="group-c"
                className="data-[state=active]:bg-blue-600"
              >
                Group C: Rest ({groupC.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="group-a" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">
                        Thread ID
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Classification
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Template
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Action Needed
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Last Reply
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupA.map((fu) => (
                      <tr
                        key={fu.id}
                        className="border-b border-gray-800 hover:bg-gray-800/50"
                      >
                        <td className="py-3 px-4 text-white font-mono text-xs">
                          {fu.thread_id.substring(0, 12)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={classificationBadgeVariants[fu.classification] || "secondary"}
                          >
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.template_assigned ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.action_needed ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-gray-400">
                          {formatDate(fu.last_reply_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupA.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No follow-ups in this group
                </div>
              )}
            </TabsContent>

            <TabsContent value="group-b" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">
                        Thread ID
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Classification
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Template
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Action Needed
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Last Reply
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupB.map((fu) => (
                      <tr
                        key={fu.id}
                        className="border-b border-gray-800 hover:bg-gray-800/50"
                      >
                        <td className="py-3 px-4 text-white font-mono text-xs">
                          {fu.thread_id.substring(0, 12)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={classificationBadgeVariants[fu.classification] || "secondary"}
                          >
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.template_assigned ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.action_needed ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-gray-400">
                          {formatDate(fu.last_reply_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupB.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No follow-ups in this group
                </div>
              )}
            </TabsContent>

            <TabsContent value="group-c" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">
                        Thread ID
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Classification
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Template
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Action Needed
                      </th>
                      <th className="text-left py-3 px-4 text-gray-400">
                        Last Reply
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupC.map((fu) => (
                      <tr
                        key={fu.id}
                        className="border-b border-gray-800 hover:bg-gray-800/50"
                      >
                        <td className="py-3 px-4 text-white font-mono text-xs">
                          {fu.thread_id.substring(0, 12)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={classificationBadgeVariants[fu.classification] || "secondary"}
                          >
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.template_assigned ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-white">
                          {fu.action_needed ? "Yes" : "No"}
                        </td>
                        <td className="py-3 px-4 text-gray-400">
                          {formatDate(fu.last_reply_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupC.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No follow-ups in this group
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Make.com Automation Status */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-blue-400" />
            Make.com Automation Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border-l-4 border-green-500 pl-4">
              <p className="text-gray-400 text-sm">Reply Scanning</p>
              <p className="text-white font-semibold mt-1">Active</p>
            </div>
            <div className="border-l-4 border-green-500 pl-4">
              <p className="text-gray-400 text-sm">Classification</p>
              <p className="text-white font-semibold mt-1">Active</p>
            </div>
            <div className="border-l-4 border-green-500 pl-4">
              <p className="text-gray-400 text-sm">Draft Injection</p>
              <p className="text-white font-semibold mt-1">Active</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
