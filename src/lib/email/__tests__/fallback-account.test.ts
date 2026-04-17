import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectFallbackAccount, type FallbackCandidate } from '../fallback-account';

/**
 * Supabase stub tailored to fallback-account's two queries:
 *   1. email_accounts.select(...).eq('org_id').eq('status','active').neq('id', excluded)
 *   2. email_send_log.select('account_id').eq('recipient_id').eq('status','sent').in('account_id', ids)
 */
function makeSupabase(opts: {
  accounts: FallbackCandidate[];
  sentToRecipient?: Array<{ account_id: string }>;
}): SupabaseClient {
  const from = vi.fn((table: string) => {
    if (table === 'email_accounts') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              neq: async () => ({ data: opts.accounts, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'email_send_log') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({ data: opts.sentToRecipient ?? [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

function acct(overrides: Partial<FallbackCandidate> = {}): FallbackCandidate {
  return {
    id: overrides.id ?? 'acc-1',
    email: overrides.email ?? 'a@example.com',
    server_pair_id: overrides.server_pair_id ?? 'pair-1',
    daily_send_limit: overrides.daily_send_limit ?? 100,
    sends_today: overrides.sends_today ?? 0,
    status: overrides.status ?? 'active',
    tags: overrides.tags ?? [],
  };
}

const BASE_ARGS = {
  orgId: 'org-1',
  recipientId: 'rec-1',
  excludeAccountId: 'acc-excluded',
};

describe('selectFallbackAccount', () => {
  it('returns null when no active accounts exist (only excluded)', async () => {
    const sb = makeSupabase({ accounts: [] });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    expect(r).toBeNull();
  });

  it('excludes snov-warmup-tagged accounts', async () => {
    const sb = makeSupabase({
      accounts: [
        acct({ id: 'warmup-1', email: 'warmup@x', tags: ['snov-warmup'] }),
      ],
    });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    expect(r).toBeNull();
  });

  it('excludes accounts that already sent to the recipient', async () => {
    const sb = makeSupabase({
      accounts: [acct({ id: 'acc-1' })],
      sentToRecipient: [{ account_id: 'acc-1' }],
    });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    expect(r).toBeNull();
  });

  it('excludes accounts at or above their daily_send_limit', async () => {
    const sb = makeSupabase({
      accounts: [acct({ id: 'acc-full', sends_today: 100, daily_send_limit: 100 })],
    });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    expect(r).toBeNull();
  });

  it('prefers same preferServerPairId when a match exists', async () => {
    const sb = makeSupabase({
      accounts: [
        acct({ id: 'other-pair', email: 'o@x', server_pair_id: 'pair-9', sends_today: 0, daily_send_limit: 500 }),
        acct({ id: 'same-pair', email: 's@x', server_pair_id: 'pair-1', sends_today: 50, daily_send_limit: 100 }),
      ],
    });
    const r = await selectFallbackAccount({
      ...BASE_ARGS,
      preferServerPairId: 'pair-1',
      supabase: sb,
    });
    expect(r?.id).toBe('same-pair');
  });

  it('falls back to any pair when no same-pair candidate is eligible', async () => {
    const sb = makeSupabase({
      accounts: [acct({ id: 'any-pair', server_pair_id: 'pair-9' })],
    });
    const r = await selectFallbackAccount({
      ...BASE_ARGS,
      preferServerPairId: 'pair-1',
      supabase: sb,
    });
    expect(r?.id).toBe('any-pair');
  });

  it('tie-breaks on remaining headroom (picks account with more headroom)', async () => {
    const sb = makeSupabase({
      accounts: [
        acct({ id: 'tight',   sends_today: 90,  daily_send_limit: 100, server_pair_id: 'pair-1' }),
        acct({ id: 'loose',   sends_today: 10,  daily_send_limit: 100, server_pair_id: 'pair-1' }),
        acct({ id: 'medium',  sends_today: 50,  daily_send_limit: 100, server_pair_id: 'pair-1' }),
      ],
    });
    const r = await selectFallbackAccount({
      ...BASE_ARGS,
      preferServerPairId: 'pair-1',
      supabase: sb,
    });
    expect(r?.id).toBe('loose');
  });

  it('ties on headroom break deterministically on id', async () => {
    const sb = makeSupabase({
      accounts: [
        acct({ id: 'z-acc', sends_today: 10, daily_send_limit: 100 }),
        acct({ id: 'a-acc', sends_today: 10, daily_send_limit: 100 }),
        acct({ id: 'm-acc', sends_today: 10, daily_send_limit: 100 }),
      ],
    });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    // localeCompare → 'a-acc' < 'm-acc' < 'z-acc'
    expect(r?.id).toBe('a-acc');
  });

  it('excludes non-active statuses (the RPC filter enforces this — mock matches)', async () => {
    // Our stub returns exactly what the DB query would: accounts already
    // filtered to status='active'. This test documents the contract.
    const sb = makeSupabase({
      accounts: [acct({ id: 'acc-1', status: 'active' })],
    });
    const r = await selectFallbackAccount({ ...BASE_ARGS, supabase: sb });
    expect(r?.id).toBe('acc-1');
    expect(r?.status).toBe('active');
  });
});
