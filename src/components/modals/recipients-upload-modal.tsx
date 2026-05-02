"use client";

// Wires the existing /api/lead-contacts/import-to-campaign route. CC #UI-3
// extended that route's filter object to accept lead_list_id (3-line edit).
// CSV path is stubbed pending CC #UI-4 (per V10 prompt — "defer if existing
// API doesn't accept CSV").

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

interface LeadList {
  id: string;
  name: string;
  total_leads: number | null;
  region: string | null;
  vertical: string | null;
  last_scrape_status: string | null;
}

interface ImportResponse {
  imported: number;
  skipped_suppressed: number;
  skipped_duplicate: number;
}

interface RecipientsUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
}

type UploadMode = "lead-list" | "csv";

export default function RecipientsUploadModal({
  open,
  onOpenChange,
  campaignId,
}: RecipientsUploadModalProps) {
  const router = useRouter();
  const [mode, setMode] = useState<UploadMode>("lead-list");
  const [lists, setLists] = useState<LeadList[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    setListsError(null);
    setListsLoading(true);
    fetch("/api/leads/lists", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        const arr: LeadList[] = Array.isArray(json) ? json : json?.lists || [];
        setLists(arr);
        if (arr.length > 0 && !selectedListId) {
          setSelectedListId(arr[0].id);
        }
      })
      .catch((err) => {
        setListsError(err instanceof Error ? err.message : "Failed to load lists");
      })
      .finally(() => setListsLoading(false));
  }, [open]);

  const selectedList = lists.find((l) => l.id === selectedListId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (mode !== "lead-list") {
      setSubmitError("CSV upload is not yet supported — use the Lead List path.");
      return;
    }
    if (!selectedListId) {
      setSubmitError("Select a lead list");
      return;
    }

    setSubmitting(true);
    try {
      const filter: Record<string, unknown> = { lead_list_id: selectedListId };
      if (verifiedOnly) {
        filter.email_status = "valid";
      }
      const response = await fetch("/api/lead-contacts/import-to-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId, filter }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = json?.error || "Failed to import recipients";
        setSubmitError(msg);
        toast.error(msg);
        return;
      }
      const result = json as ImportResponse;
      toast.success(
        `Added ${result.imported} recipients (skipped ${result.skipped_duplicate} duplicates, ${result.skipped_suppressed} suppressed)`
      );
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-gray-900 border border-gray-800 rounded-lg shadow-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">Add Recipients</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setMode("lead-list")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                mode === "lead-list"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              From Lead List
            </button>
            <button
              type="button"
              onClick={() => setMode("csv")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                mode === "csv"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              From CSV
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "lead-list" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Lead List
                  </label>
                  {listsLoading ? (
                    <div className="text-gray-400 text-sm py-2">Loading lists…</div>
                  ) : listsError ? (
                    <div className="text-red-400 text-sm py-2">{listsError}</div>
                  ) : lists.length === 0 ? (
                    <div className="text-gray-400 text-sm py-2">
                      No lead lists yet. Create one in Leads → Lists.
                    </div>
                  ) : (
                    <select
                      value={selectedListId}
                      onChange={(e) => setSelectedListId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.total_leads ?? 0} leads)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedList && (
                  <div className="text-xs text-gray-400 bg-gray-800/50 rounded p-3">
                    <div>Region: <span className="text-gray-300">{selectedList.region || "—"}</span></div>
                    <div>Vertical: <span className="text-gray-300">{selectedList.vertical || "—"}</span></div>
                    <div>Total leads: <span className="text-gray-300">{selectedList.total_leads ?? 0}</span></div>
                    <div>Last scrape: <span className="text-gray-300">{selectedList.last_scrape_status || "—"}</span></div>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={verifiedOnly}
                    onChange={(e) => setVerifiedOnly(e.target.checked)}
                    className="rounded border-gray-700 bg-gray-800"
                  />
                  Add only verified emails (email_status = valid)
                </label>
              </>
            )}

            {mode === "csv" && (
              <div className="p-4 bg-gray-800/50 rounded text-sm text-gray-400">
                CSV upload is not yet supported. Use a Lead List for now —
                follow-up CC will add CSV ingestion.
              </div>
            )}

            {submitError && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                {submitError}
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
                disabled={submitting || mode === "csv" || lists.length === 0}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {submitting ? "Adding…" : "Add Recipients"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
