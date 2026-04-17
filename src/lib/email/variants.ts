/**
 * Phase 1 — Thompson-sampling variant bandit.
 *
 * Replaces the uniform Math.random() pick in sequence-engine. The algorithm:
 *   1. Load step.ab_variants to discover which variant labels exist.
 *   2. If 0 or 1 variant → return the only label (default 'A').
 *   3. Count per-variant sends for (campaign_id, sequence_id, step). While any
 *      variant is below campaign.variant_exploration_threshold (default 100),
 *      pick uniformly among the under-threshold variants. Randomness is seeded
 *      on recipient_id + step so pg-boss retries produce the same variant.
 *   4. Once every variant clears the threshold, Thompson-sample from
 *      Beta(successes+1, failures+1) per variant and return argmax.
 *
 * "Success" = campaign_recipients.replied_at IS NOT NULL for recipients
 * assigned this variant on this campaign (step-aware via lead_sequence_state
 * history). "Failure" = assigned this variant AND sent >7d ago AND no reply.
 *
 * Production call uses the real jstat Beta sampler (which reads Math.random).
 * Tests stub Math.random to drive determinism — see __tests__/variants.test.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beta as jStatBeta } from 'jstat';

type SendCounts = Record<string, { sends: number; successes: number; failures: number }>;

function getSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Deterministic 32-bit hash → uniform [0,1).
 * Used to seed the exploration pick so pg-boss retries land on the same
 * variant for the same (recipientId, step) tuple.
 */
function seededUnit(recipientId: string, step: number): number {
  const seed = `${recipientId}:${step}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Mulberry32 one-iteration scramble of the FNV hash.
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Count sends / successes / failures per variant for a given campaign+sequence+step.
 *
 * - sends: count of lead_sequence_state rows whose history contains a 'sent'
 *   event at the given step, grouped by assigned_variant.
 * - successes: of those, how many have campaign_recipients.replied_at set.
 * - failures: of those, how many were sent >7d ago and have no replied_at.
 */
async function loadStats(
  supabase: SupabaseClient,
  campaignId: string,
  sequenceId: string,
  step: number,
  variants: string[]
): Promise<SendCounts> {
  // Seed result object so every variant has a zero row even with no matches.
  const out: SendCounts = Object.fromEntries(
    variants.map((v) => [v, { sends: 0, successes: 0, failures: 0 }])
  );

  // jsonb containment: left (history) contains [{event:'sent',step:N}] as subset.
  const containFilter = JSON.stringify([{ event: 'sent', step }]);

  const { data: states, error } = await supabase
    .from('lead_sequence_state')
    .select('assigned_variant, recipient_id, last_sent_at')
    .eq('campaign_id', campaignId)
    .eq('sequence_id', sequenceId)
    .filter('history', 'cs', containFilter);

  if (error) {
    // On error, fall back to uniform exploration (all zeros).
    console.error('[variants] loadStats failed:', error.message);
    return out;
  }

  if (!states || states.length === 0) return out;

  const recipientIds = states.map((s) => s.recipient_id as string);
  const { data: recipients } = await supabase
    .from('campaign_recipients')
    .select('id, replied_at')
    .in('id', recipientIds);

  const replyMap = new Map<string, string | null>();
  for (const r of recipients || []) {
    replyMap.set(r.id as string, (r.replied_at as string | null) ?? null);
  }

  const sevenDaysAgo = Date.now() - 7 * 86400000;

  for (const s of states) {
    const variant = (s.assigned_variant as string | null) ?? null;
    if (!variant || !(variant in out)) continue;
    out[variant].sends++;

    const repliedAt = replyMap.get(s.recipient_id as string) ?? null;
    if (repliedAt) {
      out[variant].successes++;
    } else {
      const lastSentAt = s.last_sent_at
        ? new Date(s.last_sent_at as string).getTime()
        : 0;
      if (lastSentAt && lastSentAt < sevenDaysAgo) {
        out[variant].failures++;
      }
    }
  }

  return out;
}

/**
 * Thompson-sample from Beta(successes+1, failures+1) per variant; return argmax.
 * Production uses jstat.beta.sample which reads Math.random internally.
 * Tests stub Math.random via vi.spyOn(Math, 'random') for determinism.
 */
function thompsonPick(stats: SendCounts, variants: string[]): string {
  let bestVariant = variants[0];
  let bestSample = -Infinity;
  for (const v of variants) {
    const { successes, failures } = stats[v];
    const sample = jStatBeta.sample(successes + 1, failures + 1);
    if (sample > bestSample) {
      bestSample = sample;
      bestVariant = v;
    }
  }
  return bestVariant;
}

export interface AssignVariantDeps {
  supabase?: SupabaseClient;
  /**
   * Injection seam for tests. Defaults to the seeded-FNV hash.
   */
  explorationRng?: (recipientId: string, step: number) => number;
}

/**
 * Assign a variant for the given (campaign, sequence, step, recipient).
 *
 * @returns variant label matching one of step.ab_variants[].variant (e.g. 'A')
 */
export async function assignVariant(
  campaignId: string,
  sequenceId: string,
  step: number,
  recipientId: string,
  deps: AssignVariantDeps = {}
): Promise<string> {
  const supabase = deps.supabase ?? getSupabase();
  const rng = deps.explorationRng ?? seededUnit;

  // Load the sequence step to discover variants.
  const { data: seq, error: seqErr } = await supabase
    .from('campaign_sequences')
    .select('steps')
    .eq('id', sequenceId)
    .single();

  if (seqErr || !seq) {
    console.error('[variants] sequence not found:', seqErr?.message);
    return 'A';
  }

  const steps = Array.isArray(seq.steps) ? (seq.steps as Array<Record<string, unknown>>) : [];
  const stepData = steps[step];
  if (!stepData) return 'A';

  const abVariants = (stepData.ab_variants as Array<{ variant: string }> | undefined) ?? [];
  const labels = abVariants.map((v) => v.variant).filter((v): v is string => typeof v === 'string');

  if (labels.length === 0) return 'A';
  if (labels.length === 1) return labels[0];

  // Load campaign exploration threshold.
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('variant_exploration_threshold')
    .eq('id', campaignId)
    .single();

  const threshold =
    typeof campaign?.variant_exploration_threshold === 'number'
      ? (campaign.variant_exploration_threshold as number)
      : 100;

  const stats = await loadStats(supabase, campaignId, sequenceId, step, labels);

  // Exploration: if ANY variant is under-threshold, pick uniformly among under-threshold variants.
  const underThreshold = labels.filter((v) => stats[v].sends < threshold);
  if (underThreshold.length > 0) {
    const u = rng(recipientId, step);
    const idx = Math.floor(u * underThreshold.length) % underThreshold.length;
    return underThreshold[idx];
  }

  // Exploitation: Thompson sampling.
  return thompsonPick(stats, labels);
}

// Exposed for unit tests.
export const __internal = {
  seededUnit,
  loadStats,
  thompsonPick,
};
