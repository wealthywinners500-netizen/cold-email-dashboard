// V8 Phase 1 re-scope (2026-04-30): pure helpers for SequenceComposerModal.
// Co-located so the modal and its tsx-script test can both import without
// pulling in next/navigation, @radix-ui/react-dialog, or sonner (which the
// .tsx file does, and which break under plain `tsx` test execution per
// pair-detail-client.test.ts:7-15).

import type { SequenceStep, CampaignSequence } from "@/lib/supabase/types";

export type ComposerMode = "create" | "edit";

export interface ComposerInput {
  name: string;
  persona: string;
  steps: SequenceStep[];
}

export interface ComposerErrors {
  name?: string;
  persona?: string;
  steps?: string;
}

export function makeDefaultStep(stepNumber: number = 1): SequenceStep {
  return {
    step_number: stepNumber,
    delay_days: 0,
    delay_hours: 0,
    subject: "",
    body_html: "",
    body_text: "",
    send_in_same_thread: stepNumber > 1,
    ab_variants: [
      { variant: "A", subject: "", body_html: "", body_text: "" },
    ],
  };
}

export function initialStepsFor(mode: ComposerMode, existing?: CampaignSequence): SequenceStep[] {
  if (mode === "edit" && existing?.steps?.length) {
    return existing.steps;
  }
  return [makeDefaultStep(1)];
}

export function validateComposerInput(input: ComposerInput): ComposerErrors {
  const errors: ComposerErrors = {};
  if (!input.name?.trim()) errors.name = "Sequence name is required";
  if (!input.persona?.trim()) errors.persona = "Persona is required";
  if (!input.steps?.length) errors.steps = "At least one step is required";
  return errors;
}

export function hasErrors(errors: ComposerErrors): boolean {
  return Boolean(errors.name || errors.persona || errors.steps);
}

export function buildCreatePayload(input: ComposerInput): {
  name: string;
  persona: string;
  sequence_type: "primary";
  steps: SequenceStep[];
} {
  return {
    name: input.name.trim(),
    persona: input.persona.trim(),
    sequence_type: "primary",
    steps: input.steps,
  };
}

export function buildUpdatePayload(input: ComposerInput): {
  name: string;
  persona: string;
  steps: SequenceStep[];
} {
  return {
    name: input.name.trim(),
    persona: input.persona.trim(),
    steps: input.steps,
  };
}

export function endpointFor(mode: ComposerMode, campaignId: string, seqId?: string): string {
  if (mode === "create") return `/api/campaigns/${campaignId}/sequences`;
  if (!seqId) throw new Error("edit mode requires seqId");
  return `/api/campaigns/${campaignId}/sequences/${seqId}`;
}

export function methodFor(mode: ComposerMode): "POST" | "PATCH" {
  return mode === "create" ? "POST" : "PATCH";
}
