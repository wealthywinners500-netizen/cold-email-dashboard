// V8 Phase 1 re-scope (2026-04-30): pure helpers for SequenceComposerModal.
// Co-located so the modal and its tsx-script test can both import without
// pulling in next/navigation, @radix-ui/react-dialog, or sonner (which the
// .tsx file does, and which break under plain `tsx` test execution per
// pair-detail-client.test.ts:7-15).
//
// CC #UI-2 (2026-05-02): extended for subsequence creation. Default args
// preserve backward-compat for primary callers. Trigger-event display strings
// are mapped to snake_case so the persisted shape matches what
// `sequence-engine.handleReply` queries (`'reply_classified'` / `'no_reply'`)
// — confirmed against current main since zero existing rows in production.

import type { SequenceStep, CampaignSequence } from "@/lib/supabase/types";

export type ComposerMode = "create" | "edit";
export type SequenceType = "primary" | "subsequence";

export interface ComposerInput {
  name: string;
  persona: string;
  steps: SequenceStep[];
}

export interface SubsequenceTriggerConfig {
  trigger_event: string;
  trigger_condition: Record<string, unknown>;
  trigger_priority: number;
  persona: string;
}

export interface ComposerErrors {
  name?: string;
  persona?: string;
  steps?: string;
  trigger_event?: string;
  trigger_condition?: string;
  trigger_priority?: string;
}

// Display strings emitted by SubsequenceTriggerEditor → DB-canonical snake_case
// values that sequence-engine.ts:337,540 queries. Pass-through for already-
// snake_case values so an existing-row edit doesn't double-map.
const TRIGGER_EVENT_TO_DB: Record<string, string> = {
  "Reply Classified": "reply_classified",
  "No Reply": "no_reply",
  "Opened": "opened",
  "Clicked": "clicked",
};

export function normalizeTriggerEvent(raw: string): string {
  return TRIGGER_EVENT_TO_DB[raw] ?? raw;
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

export function validateComposerInput(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): ComposerErrors {
  const errors: ComposerErrors = {};
  if (!input.name?.trim()) errors.name = "Sequence name is required";
  if (!input.persona?.trim() && sequenceType === "primary") {
    errors.persona = "Persona is required";
  }
  if (!input.steps?.length) errors.steps = "At least one step is required";

  if (sequenceType === "subsequence") {
    if (!triggerConfig) {
      errors.trigger_event = "Trigger configuration is required for subsequences";
      return errors;
    }
    if (!triggerConfig.trigger_event?.trim()) {
      errors.trigger_event = "Trigger event is required";
    }
    const event = triggerConfig.trigger_event;
    const condition = triggerConfig.trigger_condition || {};
    if (event === "Reply Classified" || event === "reply_classified") {
      if (!condition.classification) {
        errors.trigger_condition = "Classification is required for Reply Classified trigger";
      }
    } else if (event === "No Reply" || event === "no_reply") {
      const days = Number(condition.days);
      if (!Number.isFinite(days) || days < 1) {
        errors.trigger_condition = "Days must be at least 1 for No Reply trigger";
      }
    }
    if (!Number.isFinite(triggerConfig.trigger_priority) || triggerConfig.trigger_priority < 1) {
      errors.trigger_priority = "Priority must be at least 1";
    }
    if (!triggerConfig.persona?.trim()) {
      errors.persona = "Persona is required";
    }
  }

  return errors;
}

export function hasErrors(errors: ComposerErrors): boolean {
  return Boolean(
    errors.name ||
      errors.persona ||
      errors.steps ||
      errors.trigger_event ||
      errors.trigger_condition ||
      errors.trigger_priority
  );
}

export type CreateSubsequencePayload = {
  name: string;
  persona: string;
  sequence_type: "subsequence";
  trigger_event: string;
  trigger_condition: Record<string, unknown>;
  trigger_priority: number;
  steps: SequenceStep[];
};

export type CreatePayload =
  | { name: string; persona: string; sequence_type: "primary"; steps: SequenceStep[] }
  | CreateSubsequencePayload;

export function buildCreatePayload(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): CreatePayload {
  if (sequenceType === "subsequence") {
    if (!triggerConfig) {
      throw new Error("buildCreatePayload(subsequence) requires triggerConfig");
    }
    return {
      name: input.name.trim(),
      persona: triggerConfig.persona.trim(),
      sequence_type: "subsequence",
      trigger_event: normalizeTriggerEvent(triggerConfig.trigger_event),
      trigger_condition: triggerConfig.trigger_condition || {},
      trigger_priority: triggerConfig.trigger_priority,
      steps: input.steps,
    };
  }
  return {
    name: input.name.trim(),
    persona: input.persona.trim(),
    sequence_type: "primary",
    steps: input.steps,
  };
}

export type UpdateSubsequencePayload = {
  name: string;
  persona: string;
  trigger_event: string;
  trigger_condition: Record<string, unknown>;
  trigger_priority: number;
  steps: SequenceStep[];
};

export type UpdatePayload =
  | { name: string; persona: string; steps: SequenceStep[] }
  | UpdateSubsequencePayload;

export function buildUpdatePayload(
  input: ComposerInput,
  sequenceType: SequenceType = "primary",
  triggerConfig?: SubsequenceTriggerConfig | null
): UpdatePayload {
  if (sequenceType === "subsequence") {
    if (!triggerConfig) {
      throw new Error("buildUpdatePayload(subsequence) requires triggerConfig");
    }
    return {
      name: input.name.trim(),
      persona: triggerConfig.persona.trim(),
      trigger_event: normalizeTriggerEvent(triggerConfig.trigger_event),
      trigger_condition: triggerConfig.trigger_condition || {},
      trigger_priority: triggerConfig.trigger_priority,
      steps: input.steps,
    };
  }
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
