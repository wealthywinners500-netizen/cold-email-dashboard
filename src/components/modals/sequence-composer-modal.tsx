"use client";

// V8 Phase 1 re-scope (2026-04-30): wires the dead "Create Sequence" button at
// campaign-detail-client.tsx:343 and adds Edit affordance to existing sequence
// cards. The original prompt assumed greenfield UI; ground-verify (Phase 0)
// found 2,168 LOC of pre-existing campaigns/sequence UI. This modal CONSUMES
// the existing <SequenceStepEditor> (321 LOC, fully write-capable, currently
// only invoked with readOnly={true}) — does not rebuild it.
//
// API contract consumed (NOT modified — see V8 NO-GO):
//   POST   /api/campaigns/[id]/sequences           — create primary sequence
//   PATCH  /api/campaigns/[id]/sequences/[seqId]  — update existing sequence
// See src/app/api/campaigns/[id]/sequences/route.ts (POST validates persona
// required + primary uniqueness) and .../sequences/[seqId]/route.ts (PATCH).
//
// V3 standard (per ~/.auto-memory/project_email_copy_agent.md): each step
// authors A/B/C/D variants with unique body copy. The existing
// <SequenceStepEditor> already enforces the variant tab UX.

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { SequenceStepEditor } from "@/components/sequence/sequence-step-editor";
import type { SequenceStep, CampaignSequence } from "@/lib/supabase/types";
import {
  type ComposerMode,
  initialStepsFor,
  validateComposerInput,
  hasErrors,
  buildCreatePayload,
  buildUpdatePayload,
  endpointFor,
  methodFor,
} from "./sequence-composer-helpers";

interface SequenceComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  mode: ComposerMode;
  existingSequence?: CampaignSequence;
  onSuccess?: (seq: CampaignSequence) => void;
}

export default function SequenceComposerModal({
  open,
  onOpenChange,
  campaignId,
  mode,
  existingSequence,
  onSuccess,
}: SequenceComposerModalProps) {
  const router = useRouter();

  const [name, setName] = useState<string>(existingSequence?.name ?? "");
  const [persona, setPersona] = useState<string>(existingSequence?.persona ?? "");
  const [steps, setSteps] = useState<SequenceStep[]>(initialStepsFor(mode, existingSequence));
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; persona?: string; steps?: string }>({});

  useEffect(() => {
    if (open) {
      setName(existingSequence?.name ?? "");
      setPersona(existingSequence?.persona ?? "");
      setSteps(initialStepsFor(mode, existingSequence));
      setApiError(null);
      setFieldErrors({});
    }
  }, [open, mode, existingSequence]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const errors = validateComposerInput({ name, persona, steps });
    setFieldErrors(errors);
    if (hasErrors(errors)) return;

    setLoading(true);
    try {
      const url = endpointFor(mode, campaignId, existingSequence?.id);
      const method = methodFor(mode);
      const body =
        mode === "create"
          ? buildCreatePayload({ name, persona, steps })
          : buildUpdatePayload({ name, persona, steps });

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = json?.error || `Failed to ${mode === "create" ? "create" : "update"} sequence`;
        setApiError(message);
        toast.error(message);
        return;
      }

      toast.success(mode === "create" ? "Sequence created" : "Sequence updated");
      onSuccess?.(json as CampaignSequence);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setApiError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-800 rounded-lg shadow-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">
              {mode === "create" ? "New Primary Sequence" : "Edit Sequence"}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Sequence Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Atlanta dentist intro v3"
              />
              {fieldErrors.name && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Persona
              </label>
              <input
                type="text"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Victor"
              />
              {fieldErrors.persona && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.persona}</p>
              )}
            </div>

            <div className="text-xs text-gray-500">
              Sequence type: <span className="text-gray-300 font-mono">primary</span>
              {" "}— subsequences are authored separately.
            </div>

            <div className="border-t border-gray-800 pt-4">
              <SequenceStepEditor steps={steps} onChange={setSteps} />
              {fieldErrors.steps && (
                <p className="text-red-400 text-xs mt-2">{fieldErrors.steps}</p>
              )}
            </div>

            {apiError && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                {apiError}
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
                {loading ? "Saving…" : mode === "create" ? "Create Sequence" : "Save Changes"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
