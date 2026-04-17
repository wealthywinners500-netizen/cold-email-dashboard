/**
 * Integration-style tests for handleProcessSequenceStep.
 *
 * Uses vitest module mocks to intercept:
 *   - createClient from @supabase/supabase-js
 *   - sendEmail from smtp-manager
 *   - assignVariant from variants
 *   - advanceStep from sequence-engine
 *   - selectFallbackAccount from fallback-account  (parameterized per test)
 *
 * Each test drives the Supabase mock to a specific state and asserts that
 * sendEmail was either called or skipped, and that the correct side-effects
 * (suppression update, reschedule, history append, fallback reassign) happened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ---------------------------------------------------------------
const sendEmailMock = vi.fn();
const assignVariantMock = vi.fn();
const advanceStepMock = vi.fn();
const fallbackMock = vi.fn();

// Hoisted initial mocks — re-stubbed inside loadHandler after resetModules.
vi.mock('../../../lib/email/smtp-manager', () => ({
  sendEmail: sendEmailMock,
  closeAll: vi.fn(),
}));
vi.mock('../../../lib/email/variants', () => ({
  assignVariant: assignVariantMock,
}));
vi.mock('../../../lib/email/sequence-engine', () => ({
  advanceStep: advanceStepMock,
}));
vi.mock('../../../lib/email/template-renderer', () => ({
  renderTemplate: (s: string) => s,
  renderSubjectLine: (arr: string[]) => (Array.isArray(arr) && arr[0]) || 'subject',
}));
vi.mock('../../../lib/email/email-preparer', () => ({
  prepareEmail: (html: string) => ({ html, applied: {} }),
}));
vi.mock('../../../lib/email/fallback-account', () => ({
  selectFallbackAccount: fallbackMock,
}));

// ---- Supabase stub -------------------------------------------------------
type Row = Record<string, unknown>;

interface DBState {
  lead_sequence_state?: Row;
  campaign_sequence?: Row;
  recipient?: Row;
  account?: Row;
  accountsById?: Record<string, Row>;
  campaign?: Row;
  suppressed?: boolean;
}

function makeDB(initial: DBState) {
  const db: DBState = { ...initial };
  const updates: Array<{ table: string; patch: Row }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];

  const fromFn = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const api = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      neq: () => api,
      in: () => api,
      filter: () => api,
      maybeSingle: async () => {
        if (table === 'suppression_list') {
          return { data: db.suppressed ? { id: 'sup-1' } : null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'lead_sequence_state') {
          return {
            data: db.lead_sequence_state,
            error: db.lead_sequence_state ? null : { message: 'not found' },
          };
        }
        if (table === 'campaign_sequences') return { data: db.campaign_sequence, error: null };
        if (table === 'campaign_recipients') return { data: db.recipient, error: null };
        if (table === 'email_accounts') {
          const id = filters.id as string | undefined;
          const byId = db.accountsById ?? {};
          if (id && byId[id]) return { data: byId[id], error: null };
          return { data: db.account, error: null };
        }
        if (table === 'campaigns') return { data: db.campaign, error: null };
        return { data: null, error: null };
      },
      update: (patch: Row) => ({
        eq: async () => {
          updates.push({ table, patch });
          return { data: null, error: null };
        },
      }),
      insert: async (row: Row) => {
        inserts.push({ table, row });
        return { data: null, error: null };
      },
    };
    return api;
  });

  return {
    supabase: { from: fromFn, rpc: vi.fn(async () => ({ data: null, error: null })) },
    updates,
    inserts,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sendEmailMock.mockReset();
  assignVariantMock.mockReset();
  advanceStepMock.mockReset();
  fallbackMock.mockReset();
  assignVariantMock.mockResolvedValue('A');
  sendEmailMock.mockResolvedValue({ messageId: '<msg-1@x>', response: '250 OK' });
  fallbackMock.mockResolvedValue(null); // default: no fallback available
});

async function loadHandler(db: ReturnType<typeof makeDB>) {
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => db.supabase,
  }));
  vi.doMock('../../../lib/email/smtp-manager', () => ({
    sendEmail: sendEmailMock,
    closeAll: vi.fn(),
  }));
  vi.doMock('../../../lib/email/variants', () => ({
    assignVariant: assignVariantMock,
  }));
  vi.doMock('../../../lib/email/sequence-engine', () => ({
    advanceStep: advanceStepMock,
  }));
  vi.doMock('../../../lib/email/template-renderer', () => ({
    renderTemplate: (s: string) => s,
    renderSubjectLine: (arr: string[]) => (Array.isArray(arr) && arr[0]) || 'subject',
  }));
  vi.doMock('../../../lib/email/email-preparer', () => ({
    prepareEmail: (html: string) => ({ html, applied: {} }),
  }));
  vi.doMock('../../../lib/email/fallback-account', () => ({
    selectFallbackAccount: fallbackMock,
  }));
  const mod = await import('../process-sequence-step');
  return mod.handleProcessSequenceStep;
}

const BASE_PAYLOAD = {
  stateId: 'state-1',
  recipientId: 'rec-1',
  sequenceId: 'seq-1',
  stepNumber: 0,
  campaignId: 'camp-1',
  orgId: 'org-1',
};

const ACTIVE_STATE: Row = {
  id: 'state-1',
  status: 'active',
  assigned_variant: 'A',
  assigned_account_id: 'acc-1',
  last_message_id: null,
  history: [],
};

const SEQUENCE_SINGLE_STEP: Row = {
  id: 'seq-1',
  steps: [
    {
      step_number: 0,
      delay_days: 0,
      delay_hours: 0,
      subject: 'Hi',
      body_html: '<p>hi</p>',
      body_text: 'hi',
      send_in_same_thread: false,
      ab_variants: [],
    },
  ],
};

function sequenceMultiStep(): Row {
  return {
    id: 'seq-1',
    steps: [
      {
        step_number: 0,
        delay_days: 0,
        delay_hours: 0,
        subject: 'Terraboost partnership',
        body_html: '<p>initial</p>',
        body_text: 'initial',
        send_in_same_thread: false,
        ab_variants: [],
      },
      {
        step_number: 1,
        delay_days: 2,
        delay_hours: 0,
        subject: '', // empty => inherit parent
        body_html: '<p>follow-up 1</p>',
        body_text: 'follow-up 1',
        send_in_same_thread: true,
        ab_variants: [],
      },
      {
        step_number: 2,
        delay_days: 4,
        delay_hours: 0,
        subject: '',
        body_html: '<p>follow-up 2</p>',
        body_text: 'follow-up 2',
        send_in_same_thread: true,
        ab_variants: [],
      },
    ],
  };
}

const RECIPIENT: Row = {
  id: 'rec-1',
  email: 'target@example.com',
  first_name: 'Sam',
  last_name: 'Test',
  company_name: 'Acme',
  custom_fields: {},
  status: 'pending',
};

const ACTIVE_ACCOUNT: Row = {
  id: 'acc-1',
  email: 'sender@example.com',
  display_name: null,
  status: 'active',
  daily_send_limit: 100,
  sends_today: 0,
  tags: [],
  server_pair_id: 'pair-1',
  smtp_host: 'h',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: 'u',
  smtp_pass: 'p',
};

const FALLBACK_ACCOUNT: Row = {
  id: 'acc-fallback',
  email: 'fallback@example.com',
  display_name: null,
  status: 'active',
  daily_send_limit: 100,
  sends_today: 10,
  tags: [],
  server_pair_id: 'pair-1',
  smtp_host: 'h',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: 'u2',
  smtp_pass: 'p2',
};

function campaignWithinWindow(overrides: Row = {}): Row {
  const allDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return {
    id: 'camp-1',
    status: 'sending',
    sending_schedule: {
      send_between_hours: [0, 24],
      timezone: 'UTC',
      days: allDays,
      max_per_day: 500,
      per_account_per_hour: 100,
    },
    ramp_enabled: false,
    track_opens: false,
    track_clicks: false,
    include_unsubscribe: false,
    variant_exploration_threshold: 100,
    ...overrides,
  };
}

// ---- Existing Phase 1 tests (preserved) ----------------------------------

describe('process-sequence-step — pre-send gates', () => {
  it('suppression short-circuits without sending', async () => {
    const db = makeDB({
      lead_sequence_state: ACTIVE_STATE,
      campaign_sequence: SEQUENCE_SINGLE_STEP,
      recipient: RECIPIENT,
      account: ACTIVE_ACCOUNT,
      campaign: campaignWithinWindow(),
      suppressed: true,
    });
    const handle = await loadHandler(db);
    await handle(BASE_PAYLOAD);

    expect(sendEmailMock).not.toHaveBeenCalled();
    const suppressUpdate = db.updates.find(
      (u) => u.table === 'campaign_recipients' && (u.patch as Row).status === 'suppressed'
    );
    expect(suppressUpdate).toBeDefined();
  });

  it('snov-warmup tag short-circuits and reschedules state', async () => {
    const db = makeDB({
      lead_sequence_state: ACTIVE_STATE,
      campaign_sequence: SEQUENCE_SINGLE_STEP,
      recipient: RECIPIENT,
      account: { ...ACTIVE_ACCOUNT, tags: ['snov-warmup'] },
      campaign: campaignWithinWindow(),
    });
    const handle = await loadHandler(db);
    await handle(BASE_PAYLOAD);

    expect(sendEmailMock).not.toHaveBeenCalled();
    const reschedule = db.updates.find(
      (u) => u.table === 'lead_sequence_state' && typeof (u.patch as Row).next_send_at === 'string'
    );
    expect(reschedule).toBeDefined();
  });

  it('outside window reschedules without sending', async () => {
    const db = makeDB({
      lead_sequence_state: ACTIVE_STATE,
      campaign_sequence: SEQUENCE_SINGLE_STEP,
      recipient: RECIPIENT,
      account: ACTIVE_ACCOUNT,
      campaign: campaignWithinWindow({
        sending_schedule: {
          send_between_hours: [9, 17],
          timezone: 'UTC',
          days: ['sun'],
        },
      }),
    });
    const handle = await loadHandler(db);
    const isSun = new Date().getUTCDay() === 0;
    await handle(BASE_PAYLOAD);

    if (!isSun) {
      expect(sendEmailMock).not.toHaveBeenCalled();
      const reschedule = db.updates.find(
        (u) =>
          u.table === 'lead_sequence_state' &&
          typeof (u.patch as Row).next_send_at === 'string'
      );
      expect(reschedule).toBeDefined();
    }
  });

  it('at-cap skips without sending or incrementing sends_today', async () => {
    const db = makeDB({
      lead_sequence_state: ACTIVE_STATE,
      campaign_sequence: SEQUENCE_SINGLE_STEP,
      recipient: RECIPIENT,
      account: { ...ACTIVE_ACCOUNT, sends_today: 100, daily_send_limit: 100 },
      campaign: campaignWithinWindow(),
    });
    const handle = await loadHandler(db);
    await handle(BASE_PAYLOAD);

    expect(sendEmailMock).not.toHaveBeenCalled();
    const sendIncrement = db.updates.find(
      (u) =>
        u.table === 'email_accounts' && typeof (u.patch as Row).sends_today === 'number'
    );
    expect(sendIncrement).toBeUndefined();
  });
});

// ---- Phase 2 — inactive-account fallback + history + References ----------

describe('process-sequence-step — inactive-account fallback (Phase 2)', () => {
  it('inactive assigned account + history > 0 → invokes fallback, reassigns, sends from fallback, history entry uses fallback account_id', async () => {
    const history = [
      {
        step_index: 0,
        message_id: '<step0@x>',
        sent_at: '2026-04-10T10:00:00Z',
        account_id: 'acc-1',
      },
    ];
    const db = makeDB({
      lead_sequence_state: { ...ACTIVE_STATE, history, last_message_id: '<step0@x>' },
      campaign_sequence: sequenceMultiStep(),
      recipient: RECIPIENT,
      account: { ...ACTIVE_ACCOUNT, status: 'disabled' },
      accountsById: {
        'acc-1': { ...ACTIVE_ACCOUNT, status: 'disabled' },
        'acc-fallback': FALLBACK_ACCOUNT,
      },
      campaign: campaignWithinWindow(),
    });
    fallbackMock.mockResolvedValueOnce({
      id: 'acc-fallback',
      email: 'fallback@example.com',
      server_pair_id: 'pair-1',
      daily_send_limit: 100,
      sends_today: 10,
      status: 'active',
      tags: [],
    });

    const handle = await loadHandler(db);
    await handle({ ...BASE_PAYLOAD, stepNumber: 1 });

    expect(fallbackMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledOnce();
    // Email was sent from the fallback account row.
    const sendArgs = sendEmailMock.mock.calls[0];
    expect((sendArgs[0] as Row).id).toBe('acc-fallback');

    // assigned_account_id reassigned.
    const reassign = db.updates.find(
      (u) =>
        u.table === 'lead_sequence_state' &&
        (u.patch as Row).assigned_account_id === 'acc-fallback'
    );
    expect(reassign).toBeDefined();

    // history entry appended with fallback account_id.
    const historyWrite = db.updates.find(
      (u) =>
        u.table === 'lead_sequence_state' &&
        Array.isArray((u.patch as Row).history)
    );
    expect(historyWrite).toBeDefined();
    const writtenHistory = (historyWrite!.patch as Row).history as Array<Record<string, unknown>>;
    expect(writtenHistory).toHaveLength(2);
    expect(writtenHistory[1].account_id).toBe('acc-fallback');
    expect(writtenHistory[1].step_index).toBe(1);
  });

  it('inactive assigned account + history === 0 → throws (no thread to preserve)', async () => {
    const db = makeDB({
      lead_sequence_state: { ...ACTIVE_STATE, history: [] },
      campaign_sequence: SEQUENCE_SINGLE_STEP,
      recipient: RECIPIENT,
      account: { ...ACTIVE_ACCOUNT, status: 'disabled' },
      campaign: campaignWithinWindow(),
    });
    const handle = await loadHandler(db);
    await expect(handle(BASE_PAYLOAD)).rejects.toThrow(/is not active/);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(fallbackMock).not.toHaveBeenCalled();
  });
});

describe('process-sequence-step — real-reply threading (Phase 2)', () => {
  it('step 2 success → history grows to 3, In-Reply-To = step 1, References = "s0 s1 s2"', async () => {
    const priorHistory = [
      {
        step_index: 0,
        message_id: '<step0@x>',
        sent_at: '2026-04-10T10:00:00Z',
        account_id: 'acc-1',
      },
      {
        step_index: 1,
        message_id: '<step1@x>',
        sent_at: '2026-04-12T10:00:00Z',
        account_id: 'acc-1',
      },
    ];
    sendEmailMock.mockResolvedValueOnce({ messageId: '<step2@x>', response: '250 OK' });

    const db = makeDB({
      lead_sequence_state: {
        ...ACTIVE_STATE,
        history: priorHistory,
        last_message_id: '<step1@x>',
      },
      campaign_sequence: sequenceMultiStep(),
      recipient: RECIPIENT,
      account: ACTIVE_ACCOUNT,
      campaign: campaignWithinWindow(),
    });
    const handle = await loadHandler(db);
    await handle({ ...BASE_PAYLOAD, stepNumber: 2 });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const extraHeaders = sendEmailMock.mock.calls[0][6] as Record<string, string>;
    expect(extraHeaders['In-Reply-To']).toBe('<step1@x>');
    expect(extraHeaders['References']).toBe('<step0@x> <step1@x>');

    const subject = sendEmailMock.mock.calls[0][2] as string;
    // Parent subject "Terraboost partnership" — step 2 subject is empty, so
    // subject inherits parent + single "Re:" prefix.
    expect(subject).toBe('Re: Terraboost partnership');

    const historyWrite = db.updates.find(
      (u) =>
        u.table === 'lead_sequence_state' &&
        Array.isArray((u.patch as Row).history)
    );
    expect(historyWrite).toBeDefined();
    const writtenHistory = (historyWrite!.patch as Row).history as Array<Record<string, unknown>>;
    expect(writtenHistory).toHaveLength(3);
    expect(writtenHistory[2].message_id).toBe('<step2@x>');
    expect(writtenHistory[2].step_index).toBe(2);
  });

  it('sendInSameThread=false + empty step subject + history > 0 → still treated as follow-up', async () => {
    // Build a sequence where step 1 has empty subject AND send_in_same_thread=false.
    const seq = {
      id: 'seq-1',
      steps: [
        {
          step_number: 0,
          delay_days: 0,
          delay_hours: 0,
          subject: 'Terraboost partnership',
          body_html: '<p>a</p>',
          body_text: 'a',
          send_in_same_thread: false,
          ab_variants: [],
        },
        {
          step_number: 1,
          delay_days: 2,
          delay_hours: 0,
          subject: '', // empty
          body_html: '<p>b</p>',
          body_text: 'b',
          send_in_same_thread: false, // explicitly not a same-thread step
          ab_variants: [],
        },
      ],
    };

    const priorHistory = [
      {
        step_index: 0,
        message_id: '<step0@x>',
        sent_at: '2026-04-10T10:00:00Z',
        account_id: 'acc-1',
      },
    ];
    sendEmailMock.mockResolvedValueOnce({ messageId: '<step1@x>', response: '250 OK' });

    const db = makeDB({
      lead_sequence_state: {
        ...ACTIVE_STATE,
        history: priorHistory,
        last_message_id: '<step0@x>',
      },
      campaign_sequence: seq,
      recipient: RECIPIENT,
      account: ACTIVE_ACCOUNT,
      campaign: campaignWithinWindow(),
    });
    const handle = await loadHandler(db);
    await handle({ ...BASE_PAYLOAD, stepNumber: 1 });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const extraHeaders = sendEmailMock.mock.calls[0][6] as Record<string, string>;
    expect(extraHeaders['In-Reply-To']).toBe('<step0@x>');
    expect(extraHeaders['References']).toBe('<step0@x>');
    const subject = sendEmailMock.mock.calls[0][2] as string;
    expect(subject).toBe('Re: Terraboost partnership'); // inherited parent
  });
});
