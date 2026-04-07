"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Campaign, CampaignSequence, LeadSequenceState, CampaignStats } from "@/lib/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SequenceStepEditor } from "@/components/sequence/sequence-step-editor";
import { SequenceFlowDiagram } from "@/components/sequence/sequence-flow-diagram";
import { Users, Mail, MessageCircle, AlertCircle } from "lucide-react";

interface CampaignDetailClientProps {
  campaign: Campaign;
  sequences: CampaignSequence[];
  leadStates: LeadSequenceState[];
  stats: CampaignStats;
}

const statusColorMap: Record<string, string> = {
  active: "bg-blue-900 text-blue-200",
  paused: "bg-gray-700 text-gray-200",
  completed: "bg-green-900 text-green-200",
  draft: "bg-yellow-900 text-yellow-200",
};

export default function CampaignDetailClient({
  campaign,
  sequences,
  leadStates,
  stats,
}: CampaignDetailClientProps) {
  const [expandedSequence, setExpandedSequence] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const statusBadge = statusColorMap[campaign.status] || "bg-gray-700 text-gray-200";

  const sendingSchedule = campaign.sending_schedule as any || {};
  const sendingHours = sendingSchedule.hours || "9 AM - 5 PM";
  const timezone = sendingSchedule.timezone || "UTC";
  const dailyLimit = sendingSchedule.daily_limit || "Unlimited";

  const primarySequence = sequences.find((s) => s.sequence_type === "primary");
  const subsequences = sequences.filter((s) => s.sequence_type === "subsequence");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">{campaign.name}</h1>
            <div className="flex items-center gap-3">
              <Badge className={statusBadge}>{campaign.status}</Badge>
              {campaign.region && (
                <span className="text-gray-400">{campaign.region}</span>
              )}
              {campaign.store_chain && (
                <span className="text-gray-400">{campaign.store_chain}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
        <Tabs.List className="flex gap-1 border-b border-gray-800 bg-gray-900/50 rounded-t-lg p-1">
          <Tabs.Trigger
            value="overview"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition-colors data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
          >
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="sequences"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition-colors data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
          >
            Sequences
          </Tabs.Trigger>
          <Tabs.Trigger
            value="recipients"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition-colors data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
          >
            Recipients
          </Tabs.Trigger>
          <Tabs.Trigger
            value="analytics"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition-colors data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
          >
            Analytics
          </Tabs.Trigger>
        </Tabs.List>

        {/* Overview Tab */}
        <Tabs.Content value="overview" className="space-y-6 pt-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Total Recipients</p>
                    <p className="text-2xl font-bold text-white mt-2">
                      {stats.total_recipients}
                    </p>
                  </div>
                  <Users className="w-8 h-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Sent</p>
                    <p className="text-2xl font-bold text-white mt-2">
                      {stats.sent}
                    </p>
                  </div>
                  <Mail className="w-8 h-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Replied</p>
                    <p className="text-2xl font-bold text-white mt-2">
                      {stats.replied}
                    </p>
                  </div>
                  <MessageCircle className="w-8 h-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-400 text-sm">Bounced</p>
                    <p className="text-2xl font-bold text-white mt-2">
                      {stats.bounced}
                    </p>
                  </div>
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Schedule Info */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">Sending Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <p className="text-gray-400 text-sm">Sending Hours</p>
                  <p className="text-white font-medium mt-2">{sendingHours}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Timezone</p>
                  <p className="text-white font-medium mt-2">{timezone}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Daily Limit</p>
                  <p className="text-white font-medium mt-2">{dailyLimit}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Tabs.Content>

        {/* Sequences Tab */}
        <Tabs.Content value="sequences" className="space-y-6 pt-6">
          {primarySequence && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Primary Sequence</h3>
              <Card
                className="bg-gray-900 border-l-4 border-l-blue-600 border-gray-800 cursor-pointer transition-all hover:bg-gray-800/80"
                onClick={() =>
                  setExpandedSequence(
                    expandedSequence === primarySequence.id ? null : primarySequence.id
                  )
                }
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-white">
                        {primarySequence.name}
                      </CardTitle>
                      <Badge className="bg-blue-900 text-blue-200">Primary</Badge>
                    </div>
                    <span className="text-gray-400 text-sm">
                      {primarySequence.steps.length} steps
                    </span>
                  </div>
                </CardHeader>
                {expandedSequence === primarySequence.id && (
                  <CardContent className="space-y-4">
                    <SequenceStepEditor
                      steps={primarySequence.steps}
                      onChange={() => {}}
                      readOnly={true}
                    />
                  </CardContent>
                )}
              </Card>
            </div>
          )}

          {subsequences.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Subsequences</h3>
              {subsequences.map((seq) => {
                let triggerLabel = "Trigger: ";
                if (seq.trigger_event === "Reply Classified") {
                  const condition = seq.trigger_condition as any;
                  triggerLabel += `Reply classified as ${condition?.classification || "Unknown"}`;
                } else if (seq.trigger_event === "No Reply") {
                  const condition = seq.trigger_condition as any;
                  triggerLabel += `No reply after ${condition?.days || 0} days`;
                } else if (seq.trigger_event) {
                  triggerLabel += seq.trigger_event;
                }

                return (
                  <Card
                    key={seq.id}
                    className="bg-gray-900 border-gray-800 cursor-pointer transition-all hover:bg-gray-800/80"
                    onClick={() =>
                      setExpandedSequence(
                        expandedSequence === seq.id ? null : seq.id
                      )
                    }
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-white">
                            {seq.name}
                          </CardTitle>
                          <Badge className="bg-amber-900 text-amber-200">
                            Subsequence
                          </Badge>
                        </div>
                        <span className="text-gray-400 text-sm">
                          {seq.steps.length} steps
                        </span>
                      </div>
                      <CardDescription className="text-gray-400 mt-2">
                        {triggerLabel}
                      </CardDescription>
                    </CardHeader>
                    {expandedSequence === seq.id && (
                      <CardContent className="space-y-4">
                        <SequenceStepEditor
                          steps={seq.steps}
                          onChange={() => {}}
                          readOnly={true}
                        />
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Flow Diagram */}
          {sequences.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Sequence Flow</h3>
              <SequenceFlowDiagram sequences={sequences} />
            </div>
          )}

          {sequences.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Mail className="w-12 h-12 text-gray-600 mb-4" />
              <p className="text-gray-400">No sequences created yet</p>
              <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                Create Sequence
              </button>
            </div>
          )}
        </Tabs.Content>

        {/* Recipients Tab */}
        <Tabs.Content value="recipients" className="space-y-6 pt-6">
          <Card className="bg-gray-900 border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800 border-b border-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Sequence
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Step
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Variant
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                      Last Activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leadStates && leadStates.length > 0 ? (
                    leadStates.map((state) => {
                      const sequence = sequences.find(s => s.id === state.sequence_id);
                      const statusColor =
                        state.status === "active"
                          ? "bg-blue-900 text-blue-200"
                          : state.status === "completed"
                          ? "bg-green-900 text-green-200"
                          : state.status === "replied"
                          ? "bg-purple-900 text-purple-200"
                          : state.status === "bounced"
                          ? "bg-red-900 text-red-200"
                          : state.status === "opted_out"
                          ? "bg-gray-700 text-gray-200"
                          : "bg-gray-700 text-gray-200";

                      return (
                        <tr key={state.id} className="border-b border-gray-700 hover:bg-gray-800/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-gray-300">
                            <span className="font-medium">Recipient</span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {state.recipient_id.substring(0, 8)}...
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {sequence?.name || "Unknown"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {state.current_step} / {state.total_steps}
                          </td>
                          <td className="px-6 py-4 text-sm">
                            <Badge className={statusColor}>
                              {state.status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {state.assigned_variant || "—"}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400">
                            {state.last_sent_at
                              ? new Date(state.last_sent_at).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                        No recipients yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </Tabs.Content>

        {/* Analytics Tab */}
        <Tabs.Content value="analytics" className="space-y-6 pt-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-12 flex flex-col items-center justify-center text-center">
              <Mail className="w-16 h-16 text-gray-600 mb-4" />
              <p className="text-gray-400 text-lg">Analytics coming in B10</p>
            </CardContent>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
