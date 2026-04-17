"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Campaign, CampaignSequence, LeadSequenceState, CampaignStats, CampaignAnalytics, SequenceStep } from "@/lib/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SequenceStepEditor } from "@/components/sequence/sequence-step-editor";
import { SequenceFlowDiagram } from "@/components/sequence/sequence-flow-diagram";
import { SubsequenceTriggerEditor } from "@/components/sequence/subsequence-trigger-editor";
import { CreateSubsequenceModal } from "@/components/modals/create-subsequence-modal";
import { Button } from "@/components/ui/button";
import { isFeatureEnabledSync } from "@/lib/featureFlags";
import { Trash2, Users, Mail, MessageCircle, AlertCircle, Eye, MousePointerClick, UserMinus, BarChart3, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface DailyVolume {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
}

interface AnalyticsRecipient {
  id: string;
  email: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  bounce_type: string | null;
}

interface CampaignDetailClientProps {
  campaign: Campaign;
  sequences: CampaignSequence[];
  leadStates: LeadSequenceState[];
  stats: CampaignStats;
  analytics: CampaignAnalytics | null;
  dailyVolume: DailyVolume[];
  analyticsRecipients: AnalyticsRecipient[];
  analyticsRecipientsCount: number;
}

const statusColorMap: Record<string, string> = {
  active: "bg-blue-900 text-blue-200",
  paused: "bg-gray-700 text-gray-200",
  completed: "bg-green-900 text-green-200",
  draft: "bg-yellow-900 text-yellow-200",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#6b7280",
  sent: "#3b82f6",
  opened: "#22c55e",
  clicked: "#f59e0b",
  replied: "#a855f7",
  bounced: "#ef4444",
  unsubscribed: "#f97316",
  failed: "#dc2626",
};

const PIE_COLORS = ["#6b7280", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#f97316"];

export default function CampaignDetailClient({
  campaign,
  sequences,
  leadStates,
  stats,
  analytics,
  dailyVolume,
  analyticsRecipients,
  analyticsRecipientsCount,
}: CampaignDetailClientProps) {
  const [expandedSequence, setExpandedSequence] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  // Phase 4: flag-gated editable sequences. When off, the SequenceStepEditor
  // is rendered readOnly with a noop onChange (pixel-identical to pre-phase-4).
  const v2 = isFeatureEnabledSync("campaigns_v2");

  // Local sequences state so the editor's onChange mutations re-render the UI
  // without a router.refresh() round-trip. Initial value = server-rendered prop.
  // Flag-off path still reads from `sequences` (the prop) to preserve identity.
  const [localSequences, setLocalSequences] = useState<CampaignSequence[]>(sequences);

  // Per-sequence debounce timers + pending-patch buffer. Phase 5 fix (v2):
  // previously we had TWO debounced savers (steps and partial-patch) sharing
  // one timer map — a clearTimeout on the second edit silently dropped the
  // first patch's fields if they were of a different shape. The merged-patch
  // queue below guarantees rapid edits within the 800ms window collapse into
  // a single PATCH whose body is the union of all queued fields. On unmount
  // we clear timers and intentionally discard pending patches (same behavior
  // as the previous implementation — acceptable because the user still has
  // local state in front of them; forced reload is the sole foot-gun).
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatches = useRef<Record<string, Partial<CampaignSequence>>>({});
  const [savingSeqId, setSavingSeqId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const flushPatch = useCallback(
    async (seqId: string) => {
      const patch = pendingPatches.current[seqId];
      if (!patch || Object.keys(patch).length === 0) return;
      delete pendingPatches.current[seqId];
      setSavingSeqId(seqId);
      setSaveError(null);
      try {
        const resp = await fetch(
          `/api/campaigns/${campaign.id}/sequences/${seqId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setSaveError(err?.error ?? "Failed to save sequence");
          return;
        }
      } catch {
        setSaveError("Network error saving sequence");
      } finally {
        setSavingSeqId(null);
      }
    },
    [campaign.id]
  );

  const queuePatch = useCallback(
    (seqId: string, patch: Partial<CampaignSequence>) => {
      pendingPatches.current[seqId] = {
        ...pendingPatches.current[seqId],
        ...patch,
      };
      if (saveTimers.current[seqId]) clearTimeout(saveTimers.current[seqId]);
      saveTimers.current[seqId] = setTimeout(() => flushPatch(seqId), 800);
    },
    [flushPatch]
  );

  const onSequenceStepsChange = useCallback(
    (seqId: string, newSteps: SequenceStep[]) => {
      setLocalSequences((prev) =>
        prev.map((s) => (s.id === seqId ? { ...s, steps: newSteps } : s))
      );
      queuePatch(seqId, { steps: newSteps });
    },
    [queuePatch]
  );

  const onSubsequenceFieldChange = useCallback(
    (seqId: string, patch: Partial<CampaignSequence>) => {
      setLocalSequences((prev) =>
        prev.map((s) => (s.id === seqId ? { ...s, ...patch } : s))
      );
      queuePatch(seqId, patch);
    },
    [queuePatch]
  );

  const handleDeleteSubsequence = useCallback(
    async (seqId: string) => {
      setDeleteError(null);
      try {
        const resp = await fetch(
          `/api/campaigns/${campaign.id}/sequences/${seqId}`,
          { method: "DELETE" }
        );
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          if (typeof body?.count === "number" && body.count > 0) {
            setDeleteError(
              `Cannot delete — ${body.count} active lead${body.count === 1 ? "" : "s"} in this subsequence.`
            );
          } else {
            setDeleteError(body?.error ?? "Failed to delete subsequence");
          }
          return;
        }
        setLocalSequences((prev) => prev.filter((s) => s.id !== seqId));
        setPendingDeleteId(null);
      } catch {
        setDeleteError("Network error deleting subsequence");
      }
    },
    [campaign.id]
  );

  const handleCreatedSubsequence = useCallback((seq: CampaignSequence) => {
    setLocalSequences((prev) => [...prev, seq]);
  }, []);

  useEffect(() => {
    // Capture current timer map at effect-setup time so the cleanup closure
    // doesn't depend on a ref that could change identity between mount/unmount.
    const timers = saveTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const statusBadge = statusColorMap[campaign.status] || "bg-gray-700 text-gray-200";

  const sendingSchedule = campaign.sending_schedule as any || {};
  const sendingHours = sendingSchedule.hours || "9 AM - 5 PM";
  const timezone = sendingSchedule.timezone || "UTC";
  const dailyLimit = sendingSchedule.daily_limit || "Unlimited";

  // Flag-on path reads from local state (so edits re-render); flag-off reads
  // from the prop directly (zero behavior change).
  const sequenceSource = v2 ? localSequences : sequences;
  const primarySequence = sequenceSource.find((s) => s.sequence_type === "primary");
  const subsequences = sequenceSource.filter((s) => s.sequence_type === "subsequence");

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
          {v2 && (
            <Tabs.Trigger
              value="follow-ups"
              className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition-colors data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
            >
              Follow-Ups
            </Tabs.Trigger>
          )}
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
                      onChange={
                        v2
                          ? (newSteps) =>
                              onSequenceStepsChange(primarySequence.id, newSteps)
                          : () => {}
                      }
                      readOnly={!v2}
                    />
                    {v2 && savingSeqId === primarySequence.id && (
                      <div className="text-xs text-gray-400">Saving…</div>
                    )}
                    {v2 && saveError && savingSeqId === null && (
                      <div className="text-xs text-red-400">
                        Save failed: {saveError}
                      </div>
                    )}
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
                          onChange={
                            v2
                              ? (newSteps) => onSequenceStepsChange(seq.id, newSteps)
                              : () => {}
                          }
                          readOnly={!v2}
                        />
                        {v2 && savingSeqId === seq.id && (
                          <div className="text-xs text-gray-400">Saving…</div>
                        )}
                        {v2 && saveError && savingSeqId === null && (
                          <div className="text-xs text-red-400">
                            Save failed: {saveError}
                          </div>
                        )}
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

        {/* Analytics Tab (B10) */}
        <Tabs.Content value="analytics" className="space-y-6 pt-6">
          {analytics ? (
            <>
              {/* Stats Cards Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <Mail className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Sent</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_sent ?? 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <TrendingUp className="w-5 h-5 text-green-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Delivered</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_delivered ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{analytics.total_sent > 0 ? ((analytics.total_delivered / analytics.total_sent) * 100).toFixed(1) : '0'}%</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <Eye className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Opened</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_opened ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{(analytics.open_rate ?? 0).toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <MousePointerClick className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Clicked</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_clicked ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{(analytics.click_rate ?? 0).toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <MessageCircle className="w-5 h-5 text-purple-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Replied</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_replied ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{(analytics.reply_rate ?? 0).toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card className={`bg-gray-900 ${(analytics.bounce_rate ?? 0) > 5 ? 'border-red-600' : 'border-gray-800'}`}>
                  <CardContent className="p-4 text-center">
                    <AlertCircle className="w-5 h-5 text-red-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Bounced</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_bounced ?? 0).toLocaleString()}</p>
                    <p className={`text-xs ${(analytics.bounce_rate ?? 0) > 5 ? 'text-red-400' : 'text-gray-500'}`}>{(analytics.bounce_rate ?? 0).toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4 text-center">
                    <UserMinus className="w-5 h-5 text-orange-400 mx-auto mb-1" />
                    <p className="text-xs text-gray-400">Unsub</p>
                    <p className="text-xl font-bold text-white">{(analytics.total_unsubscribed ?? 0).toLocaleString()}</p>
                    <p className="text-xs text-gray-500">{(analytics.unsubscribe_rate ?? 0).toFixed(1)}%</p>
                  </CardContent>
                </Card>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Daily Volume Line Chart */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Daily Volume</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {dailyVolume.length > 0 ? (
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={dailyVolume}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                          <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #374151", borderRadius: 8 }}
                            labelStyle={{ color: "#f8fafc" }}
                          />
                          <Line type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} dot={false} name="Sent" />
                          <Line type="monotone" dataKey="opened" stroke="#22c55e" strokeWidth={2} dot={false} name="Opened" />
                          <Line type="monotone" dataKey="clicked" stroke="#f59e0b" strokeWidth={2} dot={false} name="Clicked" />
                          <Legend />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[250px] text-gray-500">No data yet</div>
                    )}
                  </CardContent>
                </Card>

                {/* Funnel Bar Chart */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Engagement Funnel</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart
                        data={[
                          { name: "Sent", value: analytics.total_sent ?? 0, fill: "#3b82f6" },
                          { name: "Delivered", value: analytics.total_delivered ?? 0, fill: "#06b6d4" },
                          { name: "Opened", value: analytics.total_opened ?? 0, fill: "#22c55e" },
                          { name: "Clicked", value: analytics.total_clicked ?? 0, fill: "#f59e0b" },
                          { name: "Replied", value: analytics.total_replied ?? 0, fill: "#a855f7" },
                        ]}
                        layout="vertical"
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis type="number" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" tick={{ fill: "#9ca3af", fontSize: 11 }} width={70} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #374151", borderRadius: 8 }}
                          labelStyle={{ color: "#f8fafc" }}
                        />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {[
                            { name: "Sent", fill: "#3b82f6" },
                            { name: "Delivered", fill: "#06b6d4" },
                            { name: "Opened", fill: "#22c55e" },
                            { name: "Clicked", fill: "#f59e0b" },
                            { name: "Replied", fill: "#a855f7" },
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Recipient Status Pie Chart */}
              {(() => {
                const statusCounts = new Map<string, number>();
                analyticsRecipients.forEach((r) => {
                  const s = r.status || "pending";
                  statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
                });
                const pieData = Array.from(statusCounts.entries()).map(([name, value]) => ({
                  name,
                  value,
                }));

                return pieData.length > 0 ? (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardHeader>
                      <CardTitle className="text-white text-sm">Recipient Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            outerRadius={90}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {pieData.map((entry, index) => (
                              <Cell
                                key={`pie-${index}`}
                                fill={STATUS_COLORS[entry.name] || PIE_COLORS[index % PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #374151", borderRadius: 8 }}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ) : null;
              })()}

              {/* Recipient Table */}
              <Card className="bg-gray-900 border-gray-800 overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-white text-sm">
                    Recipients ({analyticsRecipientsCount})
                  </CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-800 border-b border-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Email</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Sent</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Opened</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Clicked</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Replied</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Bounce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsRecipients.length > 0 ? (
                        analyticsRecipients.map((r) => {
                          const statusBadgeColor =
                            r.status === "replied" ? "bg-purple-900 text-purple-200" :
                            r.status === "opened" || r.status === "sent" ? "bg-blue-900 text-blue-200" :
                            r.status === "clicked" ? "bg-yellow-900 text-yellow-200" :
                            r.status === "bounced" ? "bg-red-900 text-red-200" :
                            r.status === "unsubscribed" ? "bg-orange-900 text-orange-200" :
                            "bg-gray-700 text-gray-200";
                          return (
                            <tr key={r.id} className="border-b border-gray-700 hover:bg-gray-800/50">
                              <td className="px-4 py-3 text-sm text-gray-300">{r.email}</td>
                              <td className="px-4 py-3 text-sm">
                                <Badge className={statusBadgeColor}>{r.status}</Badge>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">
                                {r.sent_at ? new Date(r.sent_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">
                                {r.opened_at ? new Date(r.opened_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">
                                {r.clicked_at ? new Date(r.clicked_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">
                                {r.replied_at ? new Date(r.replied_at).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-400">
                                {r.bounced_at ? (
                                  <span className="text-red-400">
                                    {r.bounce_type || "bounced"} — {new Date(r.bounced_at).toLocaleDateString()}
                                  </span>
                                ) : "—"}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                            No recipients yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : (
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="p-12 flex flex-col items-center justify-center text-center">
                <BarChart3 className="w-16 h-16 text-gray-600 mb-4" />
                <p className="text-gray-400 text-lg">No analytics data available yet</p>
                <p className="text-gray-500 text-sm mt-2">Analytics will appear once emails are sent</p>
              </CardContent>
            </Card>
          )}
        </Tabs.Content>

        {/* Phase 5: Follow-Ups tab — subsequence CRUD + trigger editor. Entire
            panel is flag-gated (the Tabs.Trigger is also gated above) so the
            flag-off detail page renders pixel-identical to phase-4. */}
        {v2 && (
          <Tabs.Content value="follow-ups" className="space-y-6 pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Follow-Up Subsequences
              </h3>
              <Button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                + New follow-up subsequence
              </Button>
            </div>

            {subsequences.length === 0 ? (
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="p-8 text-center text-gray-400">
                  No follow-up subsequences yet. Click{" "}
                  <em>New follow-up subsequence</em> to create one.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {subsequences.map((seq) => (
                  <Card key={seq.id} className="bg-gray-900 border-gray-800">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-3">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Name
                            </label>
                            <input
                              type="text"
                              value={seq.name}
                              onChange={(e) =>
                                onSubsequenceFieldChange(seq.id, {
                                  name: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">
                              Persona
                            </label>
                            <input
                              type="text"
                              value={seq.persona ?? ""}
                              onChange={(e) =>
                                onSubsequenceFieldChange(seq.id, {
                                  persona: e.target.value,
                                })
                              }
                              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingDeleteId(seq.id);
                            setDeleteError(null);
                          }}
                          className="px-3 py-2 text-sm bg-red-900 hover:bg-red-800 text-red-200 rounded-lg flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-6">
                      <SubsequenceTriggerEditor
                        trigger_event={seq.trigger_event}
                        trigger_condition={seq.trigger_condition}
                        trigger_priority={seq.trigger_priority}
                        persona={seq.persona}
                        onChange={(cfg) =>
                          onSubsequenceFieldChange(seq.id, {
                            trigger_event: cfg.trigger_event,
                            trigger_condition: cfg.trigger_condition,
                            trigger_priority: cfg.trigger_priority,
                            persona: cfg.persona,
                          })
                        }
                      />

                      <div>
                        <h4 className="text-sm font-semibold text-white mb-3">
                          Steps
                        </h4>
                        <SequenceStepEditor
                          steps={seq.steps}
                          onChange={(newSteps) =>
                            onSequenceStepsChange(seq.id, newSteps)
                          }
                          readOnly={false}
                        />
                      </div>

                      {savingSeqId === seq.id && (
                        <div className="text-xs text-gray-400">Saving…</div>
                      )}
                      {saveError && savingSeqId === null && (
                        <div className="text-xs text-red-400">
                          Save failed: {saveError}
                        </div>
                      )}

                      {pendingDeleteId === seq.id && (
                        <div className="rounded border border-red-800 bg-red-950/40 p-4 space-y-3">
                          <p className="text-sm text-red-200">
                            Delete subsequence <strong>{seq.name}</strong>? This
                            cannot be undone.
                          </p>
                          {deleteError && (
                            <p className="text-xs text-red-300">{deleteError}</p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              onClick={() => handleDeleteSubsequence(seq.id)}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              Confirm delete
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setPendingDeleteId(null);
                                setDeleteError(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <CreateSubsequenceModal
              open={createModalOpen}
              onOpenChange={setCreateModalOpen}
              campaignId={campaign.id}
              onCreated={handleCreatedSubsequence}
            />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </div>
  );
}
