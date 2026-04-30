"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  LeadList,
  OutscraperFilters,
  OutscraperTask,
} from "@/lib/supabase/types";
import { LeadListsSidebar } from "./components/lead-lists-sidebar";
import { NewListModal } from "./components/new-list-modal";
import { OutscraperSearchForm } from "./components/outscraper-search-form";
import { ScrapeStatusBadge } from "./components/scrape-status-badge";
import { LeadListTable } from "./components/lead-list-table";

interface Props {
  initialLists: LeadList[];
  activeListId: string | null;
  initialView: string;
}

export default function LeadListsClient({
  initialLists,
  activeListId: initialActiveListId,
  initialView,
}: Props) {
  const router = useRouter();
  const [lists, setLists] = useState<LeadList[]>(initialLists);
  const [activeListId, setActiveListId] = useState<string | null>(
    initialActiveListId
  );
  const [view, setView] = useState<"search" | "browse">(
    initialView === "browse" ? "browse" : "search"
  );
  const [newListOpen, setNewListOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [latestTask, setLatestTask] = useState<OutscraperTask | null>(null);

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) || null,
    [lists, activeListId]
  );

  const updateUrl = (
    nextListId: string | null,
    nextView: "search" | "browse"
  ) => {
    const params = new URLSearchParams();
    params.set("tab", "lists");
    if (nextListId) params.set("list", nextListId);
    params.set("view", nextView);
    router.replace(`/dashboard/leads?${params.toString()}`, { scroll: false });
  };

  const onSelectList = (id: string) => {
    setActiveListId(id);
    setLatestTask(null);
    const next = "search" as const;
    setView(next);
    updateUrl(id, next);
  };

  const onCreated = (list: LeadList) => {
    setLists((prev) => [list, ...prev]);
    setActiveListId(list.id);
    updateUrl(list.id, "search");
  };

  const refreshActiveList = async () => {
    if (!activeListId) return;
    try {
      const res = await fetch(`/api/leads/lists/${activeListId}`);
      const data = await res.json();
      if (res.ok && data.list) {
        setLists((prev) =>
          prev.map((l) => (l.id === data.list.id ? data.list : l))
        );
        setLatestTask(data.latest_task || null);
      }
    } catch {
      // best-effort refresh
    }
  };

  // Poll task status every 5s while in non-terminal state.
  useEffect(() => {
    if (!latestTask) return;
    if (
      latestTask.status === "complete" ||
      latestTask.status === "failed"
    ) {
      // One last refresh to get final list totals.
      refreshActiveList();
      return;
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/leads/scrapes/${latestTask.outscraper_task_id}`
        );
        const data = await res.json();
        if (res.ok && data.task) {
          setLatestTask(data.task as OutscraperTask);
          if (typeof data.list_total_leads === "number") {
            setLists((prev) =>
              prev.map((l) =>
                l.id === latestTask.lead_list_id
                  ? {
                      ...l,
                      total_leads: data.list_total_leads,
                      last_scrape_status: data.task.status,
                    }
                  : l
              )
            );
          }
        }
      } catch {
        /* swallow */
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestTask?.outscraper_task_id, latestTask?.status]);

  // On list switch, fetch its latest task to drive status badge.
  useEffect(() => {
    if (!activeListId) return;
    refreshActiveList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListId]);

  const onSubmitScrape = async (
    filters: OutscraperFilters,
    estimatedCount: number
  ) => {
    if (!activeListId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leads/lists/${activeListId}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters,
          estimated_count: estimatedCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      toast.success(
        `Outscraper task ${data.task.outscraper_task_id} submitted — polling will begin within 2 min.`
      );
      setLatestTask(data.task as OutscraperTask);
      // Update list status optimistically
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeListId
            ? {
                ...l,
                last_scrape_status: "submitted",
                last_scrape_started_at: new Date().toISOString(),
                last_scrape_error: null,
              }
            : l
        )
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const switchView = (next: "search" | "browse") => {
    setView(next);
    updateUrl(activeListId, next);
  };

  return (
    <div className="flex gap-6 min-h-[60vh]">
      <LeadListsSidebar
        lists={lists}
        activeListId={activeListId}
        onSelect={onSelectList}
        onNewList={() => setNewListOpen(true)}
      />

      <main className="flex-1 min-w-0 space-y-4">
        {!activeList ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-10 text-center">
            <h2 className="text-xl font-semibold text-white mb-2">
              Pick a list to start
            </h2>
            <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
              Lists scope leads by region + vertical so you can run separate
              Outscraper searches without cross-contamination.
            </p>
            <button
              onClick={() => setNewListOpen(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold"
            >
              + New list
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {activeList.name}
                  </h2>
                  {(activeList.region ||
                    activeList.vertical ||
                    activeList.sub_vertical) && (
                    <p className="text-sm text-gray-400">
                      {[
                        activeList.region,
                        activeList.vertical,
                        activeList.sub_vertical,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {activeList.description && (
                    <p className="text-xs text-gray-500 mt-1">
                      {activeList.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-sm text-gray-400">
                    <strong className="text-white">
                      {activeList.total_leads}
                    </strong>{" "}
                    leads
                  </span>
                  {(latestTask?.status || activeList.last_scrape_status) && (
                    <ScrapeStatusBadge
                      status={
                        latestTask?.status ||
                        activeList.last_scrape_status ||
                        null
                      }
                      startedAt={
                        latestTask?.created_at ||
                        activeList.last_scrape_started_at
                      }
                    />
                  )}
                </div>
              </div>
              {activeList.last_scrape_error && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded px-2 py-1">
                  Last scrape error: {activeList.last_scrape_error}
                </p>
              )}
              <div className="flex gap-1 bg-gray-800 rounded-md p-1 w-fit">
                <button
                  onClick={() => switchView("search")}
                  className={`px-3 py-1.5 rounded text-xs font-medium ${
                    view === "search"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Search
                </button>
                <button
                  onClick={() => switchView("browse")}
                  className={`px-3 py-1.5 rounded text-xs font-medium ${
                    view === "browse"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Browse leads ({activeList.total_leads})
                </button>
              </div>
            </div>

            {view === "search" ? (
              <OutscraperSearchForm
                list={activeList}
                submitting={submitting}
                onSubmit={onSubmitScrape}
              />
            ) : (
              <LeadListTable listId={activeList.id} />
            )}
          </>
        )}
      </main>

      <NewListModal
        open={newListOpen}
        onClose={() => setNewListOpen(false)}
        onCreated={onCreated}
      />
    </div>
  );
}
