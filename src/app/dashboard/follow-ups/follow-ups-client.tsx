"use client";

// CC #UI-4 (2026-05-02): adds 4th "Subsequences" tab exposing org-wide
// subsequence CRUD. Reuses <SequenceComposerModal> with optional campaignId
// + new <CampaignPicker>. Per-campaign attachment preserved (CC #UI-5 will
// migrate to true org-scoped via applies_to_* columns + nullable campaign_id
// + sequence-engine cross-campaign matching). Empty-state early-return now
// only fires when BOTH followUps and subsequences are empty.

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, AlertCircle, Pencil, Trash2, Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import SequenceComposerModal from "@/components/modals/sequence-composer-modal";
import type { CampaignSequence, SequenceStep } from "@/lib/supabase/types";

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

// CC #UI-4: shape returned by getOrgSubsequences() — a Supabase select with
// campaigns(name) embedded join. Org_id intentionally omitted (server-only).
// Accepts either { name } or [{ name }] for campaigns since Supabase typings
// model 1:1 FK joins as arrays.
interface SubsequenceRow {
  id: string;
  org_id: string;
  campaign_id: string;
  name: string;
  persona: string | null;
  sequence_type: string;
  sort_order: number;
  trigger_event: string | null;
  trigger_condition: Record<string, unknown> | null;
  trigger_priority: number;
  steps: SequenceStep[];
  status: string;
  created_at: string;
  updated_at: string;
  campaigns?: { name: string } | { name: string }[] | null;
}

function campaignNameOf(row: SubsequenceRow): string {
  if (!row.campaigns) return row.campaign_id.slice(0, 8);
  if (Array.isArray(row.campaigns)) return row.campaigns[0]?.name ?? row.campaign_id.slice(0, 8);
  return row.campaigns.name ?? row.campaign_id.slice(0, 8);
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface FollowUpsClientProps {
  followUps: FollowUp[];
  subsequences: SubsequenceRow[];
  campaigns: CampaignOption[];
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

function formatTriggerLabel(row: SubsequenceRow): string {
  const event = row.trigger_event ?? "—";
  const cond = (row.trigger_condition as Record<string, unknown> | null) ?? {};
  if (event === "reply_classified" || event === "Reply Classified") {
    const c = (cond.classification as string) ?? "?";
    return `Reply classified as ${c}`;
  }
  if (event === "no_reply" || event === "No Reply") {
    const d = (cond.days as number) ?? "?";
    return `No reply after ${d} day${d === 1 ? "" : "s"}`;
  }
  if (event === "opened" || event === "Opened") return "Opened";
  if (event === "clicked" || event === "Clicked") return "Clicked";
  return event;
}

export default function FollowUpsClient({
  followUps,
  subsequences,
  campaigns,
}: FollowUpsClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("group-a");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingSubseq, setEditingSubseq] = useState<SubsequenceRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  useRealtimeRefresh("follow_ups");

  // Calculate classification breakdown
  const classificationBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {};
    followUps.forEach((fu) => {
      breakdown[fu.classification] = (breakdown[fu.classification] || 0) + 1;
    });
    return breakdown;
  }, [followUps]);

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

  const openCreate = () => {
    setEditingSubseq(null);
    setComposerOpen(true);
  };

  const openEdit = (row: SubsequenceRow) => {
    setEditingSubseq(row);
    setComposerOpen(true);
  };

  const handleDelete = async (row: SubsequenceRow) => {
    if (!confirm(`Delete subsequence "${row.name}"? This cannot be undone.`)) {
      return;
    }
    setDeleteId(row.id);
    try {
      const res = await fetch(
        `/api/campaigns/${row.campaign_id}/sequences/${row.id}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Failed to delete subsequence");
        return;
      }
      toast.success("Subsequence deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeleteId(null);
    }
  };

  const showFollowUpsEmptyState =
    followUps.length === 0 && subsequences.length === 0;

  if (showFollowUpsEmptyState) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Follow-Ups</h1>
          <p className="text-gray-400 mt-2">Manage follow-up replies and track engagement</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageSquare className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No follow-up threads yet</h3>
          <p className="text-gray-400 mb-6 max-w-md">Follow-up threads will appear here once your campaigns start receiving replies. You can also create subsequences below to auto-fire on classified replies.</p>
          <div className="flex gap-3">
            <a href="/dashboard/campaigns" className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors">
              View Campaigns
            </a>
            <button
              onClick={openCreate}
              className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Subsequence
            </button>
          </div>
        </div>
        <SequenceComposerModal
          open={composerOpen}
          onOpenChange={setComposerOpen}
          campaignId={null}
          mode="create"
          sequenceType="subsequence"
          campaigns={campaigns}
        />
      </div>
    );
  }

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
      {Object.keys(classificationBreakdown).length > 0 && (
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
      )}

      {/* Tab Navigation */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Follow-Up Groups</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4 bg-gray-800">
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
              <TabsTrigger
                value="subsequences"
                className="data-[state=active]:bg-blue-600"
              >
                Subsequences ({subsequences.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="group-a" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">Thread ID</th>
                      <th className="text-left py-3 px-4 text-gray-400">Classification</th>
                      <th className="text-left py-3 px-4 text-gray-400">Template</th>
                      <th className="text-left py-3 px-4 text-gray-400">Action Needed</th>
                      <th className="text-left py-3 px-4 text-gray-400">Last Reply</th>
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
                          <Badge variant={classificationBadgeVariants[fu.classification] || "secondary"}>
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">{fu.template_assigned ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-white">{fu.action_needed ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-gray-400">{formatDate(fu.last_reply_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupA.length === 0 && (
                <div className="text-center py-8 text-gray-400">No follow-ups in this group</div>
              )}
            </TabsContent>

            <TabsContent value="group-b" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">Thread ID</th>
                      <th className="text-left py-3 px-4 text-gray-400">Classification</th>
                      <th className="text-left py-3 px-4 text-gray-400">Template</th>
                      <th className="text-left py-3 px-4 text-gray-400">Action Needed</th>
                      <th className="text-left py-3 px-4 text-gray-400">Last Reply</th>
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
                          <Badge variant={classificationBadgeVariants[fu.classification] || "secondary"}>
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">{fu.template_assigned ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-white">{fu.action_needed ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-gray-400">{formatDate(fu.last_reply_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupB.length === 0 && (
                <div className="text-center py-8 text-gray-400">No follow-ups in this group</div>
              )}
            </TabsContent>

            <TabsContent value="group-c" className="mt-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3 px-4 text-gray-400">Thread ID</th>
                      <th className="text-left py-3 px-4 text-gray-400">Classification</th>
                      <th className="text-left py-3 px-4 text-gray-400">Template</th>
                      <th className="text-left py-3 px-4 text-gray-400">Action Needed</th>
                      <th className="text-left py-3 px-4 text-gray-400">Last Reply</th>
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
                          <Badge variant={classificationBadgeVariants[fu.classification] || "secondary"}>
                            {fu.classification}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-white">{fu.template_assigned ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-white">{fu.action_needed ? "Yes" : "No"}</td>
                        <td className="py-3 px-4 text-gray-400">{formatDate(fu.last_reply_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {groupC.length === 0 && (
                <div className="text-center py-8 text-gray-400">No follow-ups in this group</div>
              )}
            </TabsContent>

            <TabsContent value="subsequences" className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-400">
                  Subsequences auto-fire on classified replies, opens, clicks, or no-reply windows.
                </p>
                <button
                  onClick={openCreate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" /> New Subsequence
                </button>
              </div>
              {subsequences.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p className="mb-2">No subsequences yet.</p>
                  <p className="text-xs">Create one to auto-fire on classified replies.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-3 px-4 text-gray-400">Name</th>
                        <th className="text-left py-3 px-4 text-gray-400">Persona</th>
                        <th className="text-left py-3 px-4 text-gray-400">Trigger</th>
                        <th className="text-left py-3 px-4 text-gray-400">Campaign</th>
                        <th className="text-left py-3 px-4 text-gray-400">Status</th>
                        <th className="text-right py-3 px-4 text-gray-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subsequences.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-gray-800 hover:bg-gray-800/50"
                        >
                          <td className="py-3 px-4 text-white">{row.name}</td>
                          <td className="py-3 px-4 text-gray-300">{row.persona ?? "—"}</td>
                          <td className="py-3 px-4 text-gray-300">{formatTriggerLabel(row)}</td>
                          <td className="py-3 px-4 text-gray-300">{campaignNameOf(row)}</td>
                          <td className="py-3 px-4">
                            <Badge variant={row.status === "active" ? "default" : "secondary"}>
                              {row.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEdit(row)}
                                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                                aria-label="Edit subsequence"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(row)}
                                disabled={deleteId === row.id}
                                className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label="Delete subsequence"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

      <SequenceComposerModal
        open={composerOpen}
        onOpenChange={setComposerOpen}
        campaignId={null}
        mode={editingSubseq ? "edit" : "create"}
        sequenceType="subsequence"
        existingSequence={editingSubseq ?? undefined}
        campaigns={campaigns}
      />
    </div>
  );
}
