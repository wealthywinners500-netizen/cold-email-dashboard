"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LeadContact } from "@/lib/supabase/types";

const STATUS_COLORS: Record<string, string> = {
  valid: "bg-green-900 text-green-200",
  invalid: "bg-red-900 text-red-200",
  risky: "bg-yellow-900 text-yellow-200",
  unknown: "bg-blue-900 text-blue-200",
  pending: "bg-gray-700 text-gray-300",
};

interface PageData {
  data: LeadContact[];
  total: number;
  page: number;
  totalPages: number;
}

export function LeadListTable({ listId }: { listId: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageData>({
    data: [],
    total: 0,
    page: 1,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/leads/lists/${listId}/leads?page=${page}&per_page=50`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setData(d);
      })
      .catch(() => {
        if (!alive) return;
        setData({ data: [], total: 0, page: 1, totalPages: 0 });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [listId, page]);

  if (loading && data.data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center text-gray-500 text-sm">
        Loading leads…
      </div>
    );
  }
  if (data.data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-white font-medium mb-1">No leads in this list yet</p>
        <p className="text-sm text-gray-400">
          Switch to the Search tab and submit an Outscraper task to populate it.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="py-3 px-4 text-left text-gray-400">Business</th>
              <th className="py-3 px-4 text-left text-gray-400">Email</th>
              <th className="py-3 px-4 text-left text-gray-400">Status</th>
              <th className="py-3 px-4 text-left text-gray-400">Phone</th>
              <th className="py-3 px-4 text-left text-gray-400">City</th>
              <th className="py-3 px-4 text-left text-gray-400">State</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((contact) => (
              <tr
                key={contact.id}
                className="border-b border-gray-800 hover:bg-gray-800/50"
              >
                <td className="py-3 px-4 text-white font-medium">
                  {contact.business_name || "—"}
                </td>
                <td className="py-3 px-4 text-gray-300 font-mono text-xs">
                  {contact.email || "—"}
                </td>
                <td className="py-3 px-4">
                  <Badge
                    className={
                      STATUS_COLORS[contact.email_status] || STATUS_COLORS.pending
                    }
                  >
                    {contact.email_status}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-gray-400">
                  {contact.phone || "—"}
                </td>
                <td className="py-3 px-4 text-gray-400">
                  {contact.city || "—"}
                </td>
                <td className="py-3 px-4 text-gray-400">
                  {contact.state || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
          <p className="text-sm text-gray-400">
            Showing {(data.page - 1) * 50 + 1}–
            {Math.min(data.page * 50, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-white text-sm">
              {data.page} / {data.totalPages}
            </span>
            <button
              onClick={() =>
                setPage((p) => Math.min(data.totalPages, p + 1))
              }
              disabled={page >= data.totalPages}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
