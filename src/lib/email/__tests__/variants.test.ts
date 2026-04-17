import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assignVariant, __internal } from '../variants';

// ---- Supabase stub -------------------------------------------------------
// A minimal in-memory fake that answers the three queries assignVariant uses:
//   campaign_sequences.select('steps').eq('id', sequenceId).single()
//   lead_sequence_state.select(...).eq('campaign_id').eq('sequence_id').filter('history','cs',...)
//   campaign_recipients.select('id,replied_at').in('id', recipientIds)
//   campaigns.select('variant_exploration_threshold').eq('id', campaignId).single()
//
// This is intentionally coarse — we only need "table name → fixed answer"
// resolution for the bandit flow.

type TableAnswers = Record<string, unknown>;

function makeSupabase(answers: {
  sequence: { steps: unknown[] };
  campaign: { variant_exploration_threshold: number };
  states: Array<{ assigned_variant: string | null; recipient_id: string; last_sent_at: string | null }>;
  recipients: Array<{ id: string; replied_at: string | null }>;
}): SupabaseClient {
  // Build a chainable thenable mock for each table.
  const fromFn = vi.fn((table: string) => {
    if (table === 'campaign_sequences') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: answers.sequence, error: null }),
          }),
        }),
      };
    }
    if (table === 'campaigns') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: answers.campaign, error: null }),
          }),
        }),
      };
    }
    if (table === 'lead_sequence_state') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              filter: async () => ({ data: answers.states, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'campaign_recipients') {
      return {
        select: () => ({
          in: async () => ({ data: answers.recipients, error: null }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from: fromFn } as unknown as SupabaseClient;
}

const VARIANTS_AB = [{ variant: 'A' }, { variant: 'B' }];

function stepsWith(abVariants: Array<{ variant: string }>): unknown[] {
  return [
    {
      step_number: 0,
      delay_days: 0,
      delay_hours: 0,
      subject: 's',
      body_html: 'b',
      body_text: 't',
      send_in_same_thread: false,
      ab_variants: abVariants,
    },
  ];
}

describe('assignVariant — exploration phase', () => {
  it('returns deterministic variant for (recipientId, step) via seeded RNG', async () => {
    const sb = makeSupabase({
      sequence: { steps: stepsWith(VARIANTS_AB) },
      campaign: { variant_exploration_threshold: 100 },
      states: [], // no prior sends → everyone under threshold
      recipients: [],
    });

    const a1 = await assignVariant('c1', 's1', 0, 'recipient-abc', { supabase: sb });
    const a2 = await assignVariant('c1', 's1', 0, 'recipient-abc', { supabase: sb });
    expect(a1).toBe(a2); // determinism across retries
    expect(['A', 'B']).toContain(a1);
  });

  it('different recipients can land on different variants', async () => {
    const sb = makeSupabase({
      sequence: { steps: stepsWith(VARIANTS_AB) },
      campaign: { variant_exploration_threshold: 100 },
      states: [],
      recipients: [],
    });

    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      picks.add(await assignVariant('c1', 's1', 0, `r-${i}`, { supabase: sb }));
    }
    expect(picks.size).toBeGreaterThanOrEqual(2); // hits both A and B
  });

  it('returns "A" when step has no ab_variants', async () => {
    const sb = makeSupabase({
      sequence: { steps: stepsWith([]) },
      campaign: { variant_exploration_threshold: 100 },
      states: [],
      recipients: [],
    });
    const a = await assignVariant('c1', 's1', 0, 'r', { supabase: sb });
    expect(a).toBe('A');
  });

  it('returns the sole variant label when only one exists', async () => {
    const sb = makeSupabase({
      sequence: { steps: stepsWith([{ variant: 'A' }]) },
      campaign: { variant_exploration_threshold: 100 },
      states: [],
      recipients: [],
    });
    const a = await assignVariant('c1', 's1', 0, 'r', { supabase: sb });
    expect(a).toBe('A');
  });
});

describe('assignVariant — exploitation phase', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exploits Beta(successes+1,failures+1) once every variant clears threshold', async () => {
    // Build 100 sent states for A (all replied — pure success) and 100 sent
    // states for B (all failed — 7+ days old, no reply). Threshold=100 so
    // every variant just clears the floor. Thompson should heavily prefer A.
    const longAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const states = [
      ...Array.from({ length: 100 }, (_, i) => ({
        assigned_variant: 'A',
        recipient_id: `rA${i}`,
        last_sent_at: longAgo,
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        assigned_variant: 'B',
        recipient_id: `rB${i}`,
        last_sent_at: longAgo,
      })),
    ];
    const recipients = [
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `rA${i}`,
        replied_at: new Date().toISOString(),
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `rB${i}`,
        replied_at: null,
      })),
    ];

    const sb = makeSupabase({
      sequence: { steps: stepsWith(VARIANTS_AB) },
      campaign: { variant_exploration_threshold: 100 },
      states,
      recipients,
    });

    // Run many samples. With ~100 successes for A and ~100 failures for B,
    // Beta(101,1) and Beta(1,101) are essentially disjoint — the A pick rate
    // should be >95%.
    let aCount = 0;
    for (let i = 0; i < 200; i++) {
      const pick = await assignVariant('c', 's', 0, `r${i}`, { supabase: sb });
      if (pick === 'A') aCount++;
    }
    expect(aCount).toBeGreaterThan(190);
  });
});

describe('seededUnit — deterministic hash', () => {
  it('is pure (same input → same output)', () => {
    const a = __internal.seededUnit('abc', 0);
    const b = __internal.seededUnit('abc', 0);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('changes output when step changes', () => {
    expect(__internal.seededUnit('abc', 0)).not.toBe(__internal.seededUnit('abc', 1));
  });
});

describe('thompsonPick — correctness on known inputs', () => {
  it('picks the variant with overwhelmingly higher successes most of the time', () => {
    const stats = {
      A: { sends: 100, successes: 99, failures: 1 },
      B: { sends: 100, successes: 1, failures: 99 },
    };
    let aCount = 0;
    for (let i = 0; i < 500; i++) {
      if (__internal.thompsonPick(stats, ['A', 'B']) === 'A') aCount++;
    }
    expect(aCount).toBeGreaterThan(475);
  });
});
