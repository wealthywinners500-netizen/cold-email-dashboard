/**
 * Pure helpers for /api/campaigns/[id]/send.
 *
 * No I/O — these are unit-testable in isolation under tsx (no jest/vitest in
 * this codebase). The route handler in ./route.ts is the only consumer.
 */

export interface PrimarySequenceStep {
  step_number?: number;
  body_html?: string;
  body_text?: string;
  ab_variants?: Array<{
    variant?: string;
    subject?: string;
    body_html?: string;
    body_text?: string;
  }>;
}

export interface ContentValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate that a primary sequence's `steps` JSONB has at least one step
 * with body content (either step-level body_html or any variant's body_html).
 *
 * The legacy `campaigns.body_html` column is no longer authoritative — body
 * content lives in `campaign_sequences.steps[N].body_html` (and per-variant
 * at `steps[N].ab_variants[V].body_html`) ever since the new sequences
 * composer (PR #36 / sha 70efb58) shipped.
 */
export function validatePrimarySequenceContent(
  steps: unknown
): ContentValidation {
  if (!Array.isArray(steps)) {
    return { ok: false, reason: "Primary sequence has no steps" };
  }
  if (steps.length === 0) {
    return { ok: false, reason: "Primary sequence has no steps" };
  }

  const hasContent = (steps as PrimarySequenceStep[]).some((step) => {
    if (typeof step?.body_html === "string" && step.body_html.trim().length > 0) {
      return true;
    }
    if (Array.isArray(step?.ab_variants)) {
      return step.ab_variants.some(
        (v) =>
          typeof v?.body_html === "string" && v.body_html.trim().length > 0
      );
    }
    return false;
  });

  if (!hasContent) {
    return { ok: false, reason: "No email body configured in primary sequence" };
  }
  return { ok: true };
}

export interface SendResponseInput {
  recipientCount?: number | null;
  accountCount?: number | null;
  statesInitialized?: number;
  alreadyInitialized?: boolean;
  existingStateCount?: number;
}

export interface SendResponseBody {
  success: true;
  recipients_queued?: number;
  accounts_assigned?: number;
  states_initialized?: number;
  already_initialized?: true;
  existing_state_count?: number;
  status?: "sending";
}

/**
 * Pure response shaper. Keeps the route handler readable and the assertions
 * in route-helpers.test.ts deterministic.
 */
export function buildSendResponse(input: SendResponseInput): SendResponseBody {
  const body: SendResponseBody = { success: true };
  if (typeof input.recipientCount === "number") {
    body.recipients_queued = input.recipientCount;
  }
  if (typeof input.accountCount === "number") {
    body.accounts_assigned = input.accountCount;
  }
  if (input.alreadyInitialized) {
    body.already_initialized = true;
    body.status = "sending";
    if (typeof input.existingStateCount === "number") {
      body.existing_state_count = input.existingStateCount;
    }
  } else if (typeof input.statesInitialized === "number") {
    body.states_initialized = input.statesInitialized;
  }
  return body;
}
