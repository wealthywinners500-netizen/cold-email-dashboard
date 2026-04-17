"use client";

/**
 * Phase 5 — new follow-up subsequence creation modal.
 *
 * POSTs to /api/campaigns/[id]/sequences with sequence_type: 'subsequence'.
 * trigger_condition shape varies by trigger_event:
 *   - "Reply Classified" → { classification: <enum> }
 *   - "No Reply"         → { days: <number> }
 *   - "Opened" | "Clicked" → {}  (no condition needed; route still expects an object)
 *
 * Style conventions follow create-campaign-modal.tsx: Radix Dialog, bg-gray-900
 * surface, bg-gray-800 inputs, bg-blue-600 submit.
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { CampaignSequence } from "@/lib/supabase/types";

const TRIGGER_EVENTS = [
  "Reply Classified",
  "No Reply",
  "Opened",
  "Clicked",
] as const;

const CLASSIFICATIONS = [
  "INTERESTED",
  "OBJECTION",
  "POLITE_DECLINE",
  "NOT_INTERESTED",
  "AUTO_REPLY",
  "BOUNCE",
  "STOP",
] as const;

type TriggerEvent = (typeof TRIGGER_EVENTS)[number];
type Classification = (typeof CLASSIFICATIONS)[number];

export interface CreateSubsequenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onCreated: (seq: CampaignSequence) => void;
}

export function CreateSubsequenceModal({
  open,
  onOpenChange,
  campaignId,
  onCreated,
}: CreateSubsequenceModalProps) {
  const [name, setName] = React.useState("");
  const [persona, setPersona] = React.useState("");
  const [triggerEvent, setTriggerEvent] =
    React.useState<TriggerEvent>("Reply Classified");
  const [classification, setClassification] =
    React.useState<Classification>("INTERESTED");
  const [days, setDays] = React.useState<number>(3);
  const [priority, setPriority] = React.useState<number>(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function triggerConditionFor(evt: TriggerEvent): Record<string, unknown> {
    if (evt === "Reply Classified") return { classification };
    if (evt === "No Reply") return { days };
    return {};
  }

  function resetFormState() {
    setName("");
    setPersona("");
    setTriggerEvent("Reply Classified");
    setClassification("INTERESTED");
    setDays(3);
    setPriority(1);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!persona.trim()) {
      setError("Persona is required");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/campaigns/${campaignId}/sequences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sequence_type: "subsequence",
          trigger_event: triggerEvent,
          trigger_condition: triggerConditionFor(triggerEvent),
          trigger_priority: priority,
          persona: persona.trim(),
          steps: [],
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error ?? "Failed to create subsequence");
        return;
      }
      const created = (await resp.json()) as CampaignSequence;
      onCreated(created);
      resetFormState();
      onOpenChange(false);
    } catch {
      setError("Network error creating subsequence");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-800 rounded-lg p-6 w-full max-w-lg text-white z-50 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-semibold">
              New follow-up subsequence
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Decision-maker nudge"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Persona (required)
              </label>
              <input
                type="text"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="e.g., CFO, IT Admin"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Trigger Event
              </label>
              <select
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value as TriggerEvent)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              >
                {TRIGGER_EVENTS.map((evt) => (
                  <option key={evt} value={evt}>
                    {evt}
                  </option>
                ))}
              </select>
            </div>

            {triggerEvent === "Reply Classified" && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Classification
                </label>
                <select
                  value={classification}
                  onChange={(e) =>
                    setClassification(e.target.value as Classification)
                  }
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
                >
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {triggerEvent === "No Reply" && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Days Without Reply
                </label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
                />
              </div>
            )}

            {(triggerEvent === "Opened" || triggerEvent === "Clicked") && (
              <div className="text-xs text-gray-400">
                No additional condition needed for {triggerEvent}.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Priority (lower fires first)
              </label>
              <input
                type="number"
                min={1}
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {submitting ? "Creating…" : "Create subsequence"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default CreateSubsequenceModal;
