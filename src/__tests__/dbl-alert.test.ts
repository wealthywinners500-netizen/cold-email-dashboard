/**
 * dbl-alert (never-again 2026-05-13) tests
 *
 * Pins the admin-alert wiring in the dbl-resweep handler. The handler
 * already writes a system_alerts row on every clean→burnt transition
 * (lines 222-246 of src/worker/handlers/dbl-resweep.ts). This PR adds
 * one more side-effect inside that branch: a sendAdminAlert(...) call
 * to deliver the listing email to dean.hofer@thestealthmail.com.
 *
 * Plain tsx + assert(). Re-uses an in-memory Supabase mock kept
 * self-contained to this file (matches the dbl-resweep.test.ts style)
 * plus a stub AdminAlertSender that records calls.
 *
 * Coverage:
 *   1. clean→burnt transition → alertSender called once with [DBL ALERT] subject
 *   2. already-burnt → burnt (no transition) → alertSender NOT called
 *   3. clean→clean (no listing) → alertSender NOT called
 *
 * Run: tsx src/__tests__/dbl-alert.test.ts
 */

import { dblResweepHandler, type DblResweepDeps } from '../worker/handlers/dbl-resweep';
import type { BlacklistResult } from '@/lib/provisioning/domain-blacklist';
import type {
  AdminAlertInput,
  AdminAlertResult,
} from '../lib/email/admin-alert';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

console.log('--- dbl-alert (never-again 2026-05-13) ---');

function fixedNow(iso: string): () => string {
  return () => iso;
}
function clean(domain: string): BlacklistResult {
  return {
    domain,
    status: 'clean',
    lists: [],
    raw: { dbl: [] },
    method: 'dqs',
    clean: true,
    blacklists: [],
  };
}
function listed(domain: string): BlacklistResult {
  return {
    domain,
    status: 'listed',
    lists: ['dbl.dq.spamhaus.net'],
    raw: { dbl: ['127.0.1.2'] },
    method: 'dqs',
    clean: false,
    blacklists: ['dbl.dq.spamhaus.net'],
  };
}

// ============================================
// Minimal in-memory Supabase
// ============================================

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

class MockDb {
  tables: Record<string, Row[]> = {};
  _idCounter = 0;
  newId(): string {
    return `row_${++this._idCounter}`;
  }
  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }));
  }
  rows(table: string): Row[] {
    return this.tables[table] || [];
  }
}

class MockBuilder {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private insertRow: Row | null = null;
  private updatePatch: Row | null = null;
  private limitN: number | null = null;
  private terminal: 'single' | 'maybeSingle' | 'none' = 'none';
  constructor(private db: MockDb, private table: string) {}
  select(_cols?: string): this {
    if (this.mode === 'insert') return this;
    this.mode = 'select';
    return this;
  }
  insert(row: Row | Row[]): this {
    this.mode = 'insert';
    this.insertRow = Array.isArray(row) ? row[0] : row;
    return this;
  }
  update(patch: Row): this {
    this.mode = 'update';
    this.updatePatch = patch;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    const set = new Set(vals);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op !== 'is') throw new Error(`only 'is' supported`);
    if (val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    } else {
      this.filters.push((r) => r[col] !== val);
    }
    return this;
  }
  order(_c: string, _o?: unknown): this {
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.terminal = 'single';
    return this;
  }
  maybeSingle(): this {
    this.terminal = 'maybeSingle';
    return this;
  }
  then<R = unknown>(
    resolve: (v: { data: unknown; error: null }) => R
  ): Promise<R> {
    return Promise.resolve(this._exec()).then(resolve);
  }
  private _exec(): { data: unknown; error: null } {
    const rows = this.db.rows(this.table);
    if (this.mode === 'insert') {
      const newRow = { id: this.db.newId(), ...this.insertRow };
      rows.push(newRow);
      this.db.tables[this.table] = rows;
      if (this.terminal === 'single' || this.terminal === 'maybeSingle') {
        return { data: newRow, error: null };
      }
      return { data: null, error: null };
    }
    const matching = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of matching) Object.assign(r, this.updatePatch);
      return { data: null, error: null };
    }
    let result = matching;
    if (this.limitN !== null) result = result.slice(0, this.limitN);
    if (this.terminal === 'single') {
      if (result.length === 0) return { data: null, error: null };
      return { data: { ...result[0] }, error: null };
    }
    if (this.terminal === 'maybeSingle') {
      return {
        data: result.length > 0 ? { ...result[0] } : null,
        error: null,
      };
    }
    return { data: result.map((r) => ({ ...r })), error: null };
  }
}

function mockSupabase(db: MockDb): DblResweepDeps['supabase'] {
  return {
    from: (table: string) => new MockBuilder(db, table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ============================================
// Fixture
// ============================================

function buildDb(blacklistStatus: 'clean' | 'burnt'): MockDb {
  const db = new MockDb();
  db.seed('organizations', [{ id: 'org-test' }]);
  db.seed('server_pairs', [
    {
      id: 'pair-1',
      pair_number: 18,
      ns_domain: 'partnerwithkroger.store',
      org_id: 'org-test',
      status: 'active',
      provisioning_job_id: 'job-abc',
    },
  ]);
  db.seed('sending_domains', [
    {
      id: 'sd-1',
      pair_id: 'pair-1',
      domain: 'krogerpromopartners.info',
      blacklist_status: blacklistStatus,
      dbl_check_history: [],
    },
  ]);
  db.seed('dbl_sweep_runs', []);
  db.seed('system_alerts', []);
  return db;
}

interface CapturedAlert {
  input: AdminAlertInput;
}

function captureSender(): {
  sender: (i: AdminAlertInput) => Promise<AdminAlertResult>;
  calls: CapturedAlert[];
} {
  const calls: CapturedAlert[] = [];
  const sender = async (input: AdminAlertInput): Promise<AdminAlertResult> => {
    calls.push({ input });
    return { sent: true, messageId: `mock-${calls.length}` };
  };
  return { sender, calls };
}

// ============================================
// Test 1 — clean→burnt transition → alert fires
// ============================================

async function test1_cleanToBurnt(): Promise<void> {
  const db = buildDb('clean');
  const { sender, calls } = captureSender();
  await dblResweepHandler(
    { org_id: 'org-test', triggered_by: 'manual' },
    {
      supabase: mockSupabase(db),
      checkDomain: async (d) => listed(d),
      now: fixedNow('2026-05-13T22:00:00.000Z'),
      alertSender: sender,
    }
  );
  assert(calls.length === 1, 'Test 1: exactly 1 admin alert sent');
  assert(
    calls[0].input.to === 'dean.hofer@thestealthmail.com',
    'Test 1: to=dean.hofer@thestealthmail.com'
  );
  assert(
    calls[0].input.subject.includes('[DBL ALERT]') &&
      calls[0].input.subject.includes('krogerpromopartners.info'),
    `Test 1: subject contains [DBL ALERT] + domain (got "${calls[0].input.subject}")`
  );
  assert(
    calls[0].input.body.includes('krogerpromopartners.info') &&
      calls[0].input.body.includes('dbl.dq.spamhaus.net'),
    'Test 1: body contains domain + listing source'
  );
  // Underlying blacklist_status flipped to burnt
  const sd = db.rows('sending_domains').find((r) => r.id === 'sd-1');
  assert(sd?.blacklist_status === 'burnt', 'Test 1: blacklist_status flipped to burnt');
  // system_alerts row written
  assert(
    db.rows('system_alerts').length === 1,
    'Test 1: system_alerts row inserted (durable record)'
  );
}

// ============================================
// Test 2 — already-burnt → still burnt (no new transition) → NO alert
// ============================================

async function test2_burntToBurnt(): Promise<void> {
  const db = buildDb('burnt');
  const { sender, calls } = captureSender();
  await dblResweepHandler(
    { org_id: 'org-test', triggered_by: 'manual' },
    {
      supabase: mockSupabase(db),
      checkDomain: async (d) => listed(d),
      now: fixedNow('2026-05-13T22:00:00.000Z'),
      alertSender: sender,
    }
  );
  assert(calls.length === 0, 'Test 2: no admin alert on burnt→burnt (idempotent)');
  assert(
    db.rows('system_alerts').length === 0,
    'Test 2: no system_alerts row either (no new burn)'
  );
}

// ============================================
// Test 3 — clean→clean (still not listed) → NO alert
// ============================================

async function test3_cleanToClean(): Promise<void> {
  const db = buildDb('clean');
  const { sender, calls } = captureSender();
  await dblResweepHandler(
    { org_id: 'org-test', triggered_by: 'manual' },
    {
      supabase: mockSupabase(db),
      checkDomain: async (d) => clean(d),
      now: fixedNow('2026-05-13T22:00:00.000Z'),
      alertSender: sender,
    }
  );
  assert(calls.length === 0, 'Test 3: no admin alert on clean→clean');
  // last_dbl_check_at still gets updated though
  const sd = db.rows('sending_domains').find((r) => r.id === 'sd-1');
  assert(
    sd?.last_dbl_check_at === '2026-05-13T22:00:00.000Z',
    'Test 3: last_dbl_check_at still refreshed'
  );
  assert(sd?.blacklist_status === 'clean', 'Test 3: blacklist_status stays clean');
}

(async () => {
  await test1_cleanToBurnt();
  await test2_burntToBurnt();
  await test3_cleanToClean();
  console.log('--- dbl-alert: all PASS ---');
})().catch((err) => {
  console.error('FAIL: unexpected exception', err);
  process.exit(1);
});
