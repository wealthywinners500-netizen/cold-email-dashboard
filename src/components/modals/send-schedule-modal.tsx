"use client";

// Engine-shape contract: this modal writes the SAME shape sequence-engine.ts
// reads at line 693 + campaign-queue.ts:58-63. Field names are NOT the
// CC-#UI-3 prompt's `{hours.{start,end}, daily_limit, days_of_week}` — they
// are the engine's `{send_between_hours, days, max_per_day, per_account_per_hour}`.
// Phase 0 found the prior display read the prompt's shape (always fallback)
// while the column held the engine shape.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

interface SendingSchedule {
  send_between_hours: [number, number];
  timezone: string;
  days: string[];
  max_per_day: number;
  per_account_per_hour: number;
}

interface SendScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  initial: Record<string, unknown> | null;
}

const DEFAULT_SCHEDULE: SendingSchedule = {
  send_between_hours: [9, 17],
  timezone: "America/New_York",
  days: ["mon", "tue", "wed", "thu", "fri"],
  max_per_day: 500,
  per_account_per_hour: 13,
};

const DAY_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
];

function normalize(initial: Record<string, unknown> | null): SendingSchedule {
  if (!initial) return { ...DEFAULT_SCHEDULE };
  const rawSbh = initial.send_between_hours;
  const sbh: [number, number] =
    Array.isArray(rawSbh) && rawSbh.length === 2 && typeof rawSbh[0] === "number" && typeof rawSbh[1] === "number"
      ? [rawSbh[0], rawSbh[1]]
      : DEFAULT_SCHEDULE.send_between_hours;
  const days = Array.isArray(initial.days)
    ? (initial.days.filter((d) => typeof d === "string") as string[])
    : DEFAULT_SCHEDULE.days;
  return {
    send_between_hours: sbh,
    timezone: typeof initial.timezone === "string" ? initial.timezone : DEFAULT_SCHEDULE.timezone,
    days,
    max_per_day: typeof initial.max_per_day === "number" ? initial.max_per_day : DEFAULT_SCHEDULE.max_per_day,
    per_account_per_hour: typeof initial.per_account_per_hour === "number" ? initial.per_account_per_hour : DEFAULT_SCHEDULE.per_account_per_hour,
  };
}

function hourToTimeStr(h: number): string {
  const hh = Math.max(0, Math.min(23, Math.floor(h)));
  return `${hh.toString().padStart(2, "0")}:00`;
}

function timeStrToHour(s: string): number {
  const [hh] = s.split(":");
  const n = parseInt(hh, 10);
  return Number.isNaN(n) ? 9 : Math.max(0, Math.min(23, n));
}

export default function SendScheduleModal({
  open,
  onOpenChange,
  campaignId,
  initial,
}: SendScheduleModalProps) {
  const router = useRouter();
  const [schedule, setSchedule] = useState<SendingSchedule>(normalize(initial));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSchedule(normalize(initial));
      setError(null);
    }
  }, [open, initial]);

  const toggleDay = (day: string) => {
    setSchedule((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const [start, end] = schedule.send_between_hours;
    if (end <= start) {
      setError("End hour must be after start hour");
      return;
    }
    if (schedule.days.length === 0) {
      setError("Select at least one sending day");
      return;
    }
    if (schedule.max_per_day < 1) {
      setError("Daily limit must be at least 1");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sending_schedule: schedule }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = json?.error || "Failed to save schedule";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Schedule saved");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-gray-900 border border-gray-800 rounded-lg shadow-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">Edit Sending Schedule</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Start hour</label>
                <input
                  type="time"
                  step={3600}
                  value={hourToTimeStr(schedule.send_between_hours[0])}
                  onChange={(e) =>
                    setSchedule((prev) => ({
                      ...prev,
                      send_between_hours: [timeStrToHour(e.target.value), prev.send_between_hours[1]],
                    }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">End hour</label>
                <input
                  type="time"
                  step={3600}
                  value={hourToTimeStr(schedule.send_between_hours[1])}
                  onChange={(e) =>
                    setSchedule((prev) => ({
                      ...prev,
                      send_between_hours: [prev.send_between_hours[0], timeStrToHour(e.target.value)],
                    }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Timezone</label>
              <select
                value={schedule.timezone}
                onChange={(e) => setSchedule((prev) => ({ ...prev, timezone: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Sending days</label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((d) => {
                  const checked = schedule.days.includes(d.key);
                  return (
                    <label
                      key={d.key}
                      className={`px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
                        checked
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleDay(d.key)}
                      />
                      {d.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Daily limit</label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={schedule.max_per_day}
                  onChange={(e) =>
                    setSchedule((prev) => ({
                      ...prev,
                      max_per_day: parseInt(e.target.value, 10) || 1,
                    }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Per-account per hour</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={schedule.per_account_per_hour}
                  onChange={(e) =>
                    setSchedule((prev) => ({
                      ...prev,
                      per_account_per_hour: parseInt(e.target.value, 10) || 1,
                    }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? "Saving…" : "Save Schedule"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
