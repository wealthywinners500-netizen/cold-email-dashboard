/**
 * Phase 3 — shared Anthropic client + usage logger.
 *
 * Lazy client per Hard Lesson #34: never instantiate at module scope, because
 * process.env may not be fully resolved at import time in Next.js edge cases.
 *
 * Cost estimates are hardcoded from Anthropic's published per-1M-token rates
 * at 2026-04-17; if prices change, update RATES and move on. Wrong costs
 * shouldn't block a send — the column is audit-only.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _anthropic: Anthropic | null = null;

/**
 * Lazy Anthropic client. Throws a clear error if ANTHROPIC_API_KEY is unset.
 */
export function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('anthropic_not_configured');
  }
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

/**
 * Model ids used by Phase 3. Centralised so the three routes don't drift.
 */
export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
} as const;

/**
 * Cents per token (NOT per million — we do the math explicitly so the final
 * cost_cents is an integer we can safely Math.ceil). Rates current as of
 * 2026-04-17; revisit periodically.
 */
const RATES: Record<string, { inCentsPerTok: number; outCentsPerTok: number }> = {
  [MODELS.haiku]: { inCentsPerTok: 0.0001, outCentsPerTok: 0.0005 },
  [MODELS.sonnet]: { inCentsPerTok: 0.0003, outCentsPerTok: 0.0015 },
};

export interface LogUsageArgs {
  orgId: string;
  userId: string | null;
  endpoint: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'ok' | 'error' | 'rate_limited';
  errorMessage?: string;
  /** For tests — swap in a mock client. */
  supabase?: SupabaseClient;
}

export function estimateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = RATES[model] ?? { inCentsPerTok: 0, outCentsPerTok: 0 };
  return Math.ceil(
    inputTokens * rates.inCentsPerTok + outputTokens * rates.outCentsPerTok
  );
}

/**
 * Insert one row into ai_usage_events. Never throws — logging is best-effort.
 */
export async function logAiUsage(args: LogUsageArgs): Promise<void> {
  try {
    const supabase =
      args.supabase ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );
    const cost = estimateCostCents(args.model, args.inputTokens, args.outputTokens);
    await supabase.from('ai_usage_events').insert({
      org_id: args.orgId,
      user_id: args.userId,
      endpoint: args.endpoint,
      model: args.model,
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      cost_cents: cost,
      latency_ms: args.latencyMs,
      status: args.status,
      error_message: args.errorMessage ?? null,
    });
  } catch (err) {
    console.error('[ai/usage] logAiUsage failed:', err);
  }
}
