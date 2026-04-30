"use client";

import { Plus } from "lucide-react";
import type { LeadList } from "@/lib/supabase/types";
import { ScrapeStatusBadge } from "./scrape-status-badge";

export function LeadListsSidebar({
  lists,
  activeListId,
  onSelect,
  onNewList,
}: {
  lists: LeadList[];
  activeListId: string | null;
  onSelect: (id: string) => void;
  onNewList: () => void;
}) {
  return (
    <aside className="w-72 shrink-0 rounded-lg border border-gray-800 bg-gray-900 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide">
          Lists
        </h2>
        <button
          onClick={onNewList}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {lists.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500">
            No lists yet. Create one to start scoping a region + vertical.
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {lists.map((list) => {
              const active = list.id === activeListId;
              return (
                <li key={list.id}>
                  <button
                    onClick={() => onSelect(list.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      active ? "bg-gray-800" : "hover:bg-gray-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm font-medium truncate ${
                          active ? "text-white" : "text-gray-200"
                        }`}
                      >
                        {list.name}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {list.total_leads}
                      </span>
                    </div>
                    {(list.region || list.vertical) && (
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {[list.region, list.vertical, list.sub_vertical]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    )}
                    {list.last_scrape_status && (
                      <div className="mt-1.5">
                        <ScrapeStatusBadge
                          status={list.last_scrape_status}
                          startedAt={list.last_scrape_started_at}
                        />
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
