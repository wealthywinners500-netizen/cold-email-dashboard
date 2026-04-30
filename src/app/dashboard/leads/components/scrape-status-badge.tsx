"use client";

import type { OutscraperTaskStatus } from "@/lib/supabase/types";

const STATUS_STYLES: Record<OutscraperTaskStatus, string> = {
  submitted: "bg-blue-900 text-blue-200",
  polling: "bg-blue-900 text-blue-200",
  downloading: "bg-purple-900 text-purple-200",
  complete: "bg-green-900 text-green-200",
  failed: "bg-red-900 text-red-200",
};

const STATUS_LABELS: Record<OutscraperTaskStatus, string> = {
  submitted: "Submitted",
  polling: "Polling",
  downloading: "Downloading",
  complete: "Saved",
  failed: "Failed",
};

export function ScrapeStatusBadge({
  status,
  startedAt,
}: {
  status: OutscraperTaskStatus | null;
  startedAt?: string | null;
}) {
  if (!status) return null;
  const minutesElapsed =
    startedAt && status !== "complete" && status !== "failed"
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(startedAt).getTime()) / 60000
          )
        )
      : null;
  const cls = STATUS_STYLES[status];
  const label = STATUS_LABELS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label}
      {minutesElapsed !== null && (
        <span className="opacity-75">· {minutesElapsed} min</span>
      )}
    </span>
  );
}
