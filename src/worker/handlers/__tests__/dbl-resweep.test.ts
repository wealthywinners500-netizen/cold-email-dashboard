/**
 * dbl-resweep handler tests
 *
 * Plain-tsx test runner (matches the rest of the gate-0 suite). No Jest /
 * Vitest. We mock the Supabase client with an in-memory fake that supports
 * just enough of the fluent query API the handler uses, and inject a
 * deterministic checkDomain + clock.
 *
 * Coverage:
 *   1. all-clean — 0 burns, 0 alerts, history + last_dbl_check_at updated
 *   2. new-burn — 1 alert + flip blacklist_status='burnt' + dbl_first_burn_at
 *   3. already-burnt — idempotent (no new alert), still updates timestamps
 *   4. scoped pair_ids — only requested pairs scanned, override bypass works
 *   5. Clouding-exclusion — default scope skips provisioning_job_id=NULL pairs;
 *                            explicit pair_ids includes them
 *
 * Run: tsx src/worker/handlers/__tests__/dbl-resweep.test.ts
 */

import {
  dblResweepHandler,
  type DblResweepDeps,
} from '../dbl-resweep';
import type { BlacklistResult } from '@/lib/provisioning/domain-blacklist';

// ============================================
// Test helpers
// ============================================

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

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
// Mock Supabase client
//
// Supports:
//   .from(table) → builder
//   .select(cols) → builder (chainable)
//   .eq(col, val), .in(col, vals), .not(col, 'is', val) → builder (filters)
//   .order(col, opts), .limit(n) → builder (no-op for tests except limit slices)
//   .single(), .maybeSingle() → terminal (returns single row)
//   .insert(row) → builder; .select().single() returns inserted row
//   .update(patch).eq(...) → terminal {error} + applies patch
//
// Builder is thenable so `await query` resolves to {data, error}.
// ============================================

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

interface OperationLog {
  table: string;
  op: 'select' | 'insert' | 'update';
  patch?: Row;
  rows?: Row[];
}

class MockDb {
  tables: Record<string, Row[]> = {};
  log: OperationLog[] = [];
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
  private projection: string | null = null;
  private limitN: number | null = null;
  private terminal: 'single' | 'maybeSingle' | 'none' = 'none';

  constructor(
    private db: MockDb,
    private table: string
  ) {}

  // Chainable methods ----------------------------------------------------
  select(cols?: string): this {
    if (this.mode === 'insert') {
      this.projection = cols ?? null;
      return this;
    }
    this.mode = 'select';
    this.projection = cols ?? null;
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
    if (op !== 'is') {
      throw new Error(`MockBuilder.not only supports 'is', got '${op}'`);
    }
    if (val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    } else {
      this.filters.push((r) => r[col] !== val);
    }
    return this;
  }

  order(_col: string, _opts?: unknown): this {
    // tests don't depend on order
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

  // Thenable -----------------------------------------------------------
  then<R = unknown>(
    resolve: (value: { data: unknown; error: null }) => R,
    _reject?: (reason: unknown) => R
  ): Promise<R> {
    return Promise.resolve(this._exec()).then(resolve);
  }

  private _exec(): { data: unknown; error: null } {
    const rows = this.db.rows(this.table);

    if (this.mode === 'insert') {
      const newRow = { id: this.db.newId(), ...this.insertRow };
      rows.push(newRow);
      this.db.tables[this.table] = rows;
      this.db.log.push({ table: this.table, op: 'insert', patch: newRow });

      if (this.terminal === 'single' || this.terminal === 'maybeSingle') {
        return { data: newRow, error: null };
      }
      return { data: null, error: null };
    }

    const matching = rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.mode === 'update') {
      for (const r of matching) {
        Object.assign(r, this.updatePatch);
      }
      this.db.log.push({
        table: this.table,
        op: 'update',
        patch: this.updatePatch ?? undefined,
        rows: matching.map((r) => ({ ...r })),
      });
      return { data: null, error: null };
    }

    // SELECT
    let result = matching;
    if (this.limitN !== null) result = result.slice(0, this.limitN);

    if (this.terminal === 'single') {
      if (result.length === 0) {
        return { data: null, error: null };
      }
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
// Fixture builders
// ============================================

interface Fixture {
  db: MockDb;
  pairsScanned: () => Row[];
}

function buildFixture(opts: {
  pairs: Array<{
    id: string;
    pair_number: number;
    ns_domain: string;
    org_id?: string;
    provisioning_job_id?: string | null;
    status?: string;
  }>;
  domains: Array<{
    id: string;
    pair_id: string;
    domain: string;
    blacklist_status?: string;
    dbl_check_history?: unknown[];
  }>;
  orgs?: Array<{ id: string }>;
}): Fixture {
  const db = new MockDb();
  db.seed('organizations', opts.orgs ?? [{ id: 'org_test' }]);
  db.seed(
    'server_pairs',
    opts.pairs.map((p) => ({
      org_id: 'org_test',
      status: 'active',
      provisioning_job_id: 'job_default',
      ...p,
    }))
  );
  db.seed(
    'sending_domains',
    opts.domains.map((d) => ({
      blacklist_status: 'clean',
      dbl_check_history: [],
      ...d,
    }))
  );
  db.seed('system_alerts', []);
  db.seed('dbl_sweep_runs', []);

  return {
    db,
    pairsScanned: () => db.rows('server_pairs'),
  };
}

// ============================================
// Run tests
// ============================================

async function main() {
console.log('--- dbl-resweep handler tests ---');

const NOW = '2026-04-27T13:00:00.000Z';

// -------------------------------------------------------------------
// Case 1 — all clean
// -------------------------------------------------------------------
{
  const f = buildFixture({
    pairs: [{ id: 'pair_1', pair_number: 5, ns_domain: 'ns.kroger5.info' }],
    domains: [
      { id: 'sd_a', pair_id: 'pair_1', domain: 'a.kroger5.info' },
      { id: 'sd_b', pair_id: 'pair_1', domain: 'b.kroger5.info' },
    ],
  });

  const summary = await dblResweepHandler(
    { triggered_by: 'test' },
    {
      supabase: mockSupabase(f.db),
      checkDomain: async (d) => clean(d),
      now: fixedNow(NOW),
    }
  );

  assert(summary.runs.length === 1, 'case1: one sweep_run created');
  assert(summary.runs[0].newBurns === 0, 'case1: zero new burns');
  assert(summary.runs[0].domainsScanned === 2, 'case1: 2 domains scanned');
  assert(
    f.db.rows('system_alerts').length === 0,
    'case1: no system_alerts inserted'
  );
  const sds = f.db.rows('sending_domains');
  assert(
    sds.every((s) => s.last_dbl_check_at === NOW),
    'case1: every sending_domain has last_dbl_check_at set'
  );
  assert(
    sds.every((s) => s.blacklist_status === 'clean'),
    'case1: blacklist_status remains clean'
  );
  const run = f.db.rows('dbl_sweep_runs')[0];
  assert(run.status === 'completed', 'case1: sweep_run completed');
  assert(run.pairs_scanned === 1, 'case1: pairs_scanned=1');
  assert(run.domains_scanned === 2, 'case1: domains_scanned=2');
  assert(run.new_burns_found === 0, 'case1: new_burns_found=0');
}

// -------------------------------------------------------------------
// Case 2 — one domain newly listed
// -------------------------------------------------------------------
{
  const f = buildFixture({
    pairs: [{ id: 'pair_1', pair_number: 7, ns_domain: 'ns.engage7.info' }],
    domains: [
      { id: 'sd_clean', pair_id: 'pair_1', domain: 'clean.engage7.info' },
      { id: 'sd_burnt', pair_id: 'pair_1', domain: 'burnt.engage7.info' },
    ],
  });

  const summary = await dblResweepHandler(
    { triggered_by: 'test' },
    {
      supabase: mockSupabase(f.db),
      checkDomain: async (d) =>
        d === 'burnt.engage7.info' ? listed(d) : clean(d),
      now: fixedNow(NOW),
    }
  );

  assert(summary.runs[0].newBurns === 1, 'case2: 1 new burn surfaced');

  const alerts = f.db.rows('system_alerts');
  assert(alerts.length === 1, 'case2: exactly one system_alert inserted');
  assert(alerts[0].alert_type === 'dbl_burn', 'case2: alert_type=dbl_burn');
  assert(alerts[0].severity === 'critical', 'case2: severity=critical');
  assert(
    typeof alerts[0].title === 'string' &&
      (alerts[0].title as string).includes('burnt.engage7.info'),
    'case2: alert title names the burnt domain'
  );
  const details = alerts[0].details as Record<string, unknown>;
  assert(details.domain === 'burnt.engage7.info', 'case2: details.domain set');
  assert(details.pair_number === 7, 'case2: details.pair_number set');

  const burntDomain = f.db
    .rows('sending_domains')
    .find((d) => d.domain === 'burnt.engage7.info');
  assert(burntDomain?.blacklist_status === 'burnt', 'case2: status flipped to burnt');
  assert(burntDomain?.dbl_first_burn_at === NOW, 'case2: dbl_first_burn_at stamped');

  const cleanDomain = f.db
    .rows('sending_domains')
    .find((d) => d.domain === 'clean.engage7.info');
  assert(
    cleanDomain?.blacklist_status === 'clean',
    'case2: clean domain stays clean'
  );
}

// -------------------------------------------------------------------
// Case 3 — already-burnt domain (idempotent)
// -------------------------------------------------------------------
{
  const f = buildFixture({
    pairs: [{ id: 'pair_1', pair_number: 9, ns_domain: 'ns.kroger9.info' }],
    domains: [
      {
        id: 'sd_burnt',
        pair_id: 'pair_1',
        domain: 'old-burnt.kroger9.info',
        blacklist_status: 'burnt',
      },
    ],
  });

  const summary = await dblResweepHandler(
    { triggered_by: 'test' },
    {
      supabase: mockSupabase(f.db),
      checkDomain: async (d) => listed(d), // still listed
      now: fixedNow(NOW),
    }
  );

  assert(summary.runs[0].newBurns === 0, 'case3: no new burns counted');
  assert(
    f.db.rows('system_alerts').length === 0,
    'case3: no duplicate alert inserted'
  );
  const sd = f.db.rows('sending_domains')[0];
  assert(sd.last_dbl_check_at === NOW, 'case3: last_dbl_check_at still updated');
  assert(sd.blacklist_status === 'burnt', 'case3: blacklist_status remains burnt');
  assert(
    sd.dbl_first_burn_at === undefined || sd.dbl_first_burn_at === null,
    'case3: dbl_first_burn_at NOT overwritten on re-detect'
  );
}

// -------------------------------------------------------------------
// Case 4 — scoped pair_ids (only those pairs scanned)
// -------------------------------------------------------------------
{
  const f = buildFixture({
    pairs: [
      { id: 'pair_a', pair_number: 1, ns_domain: 'ns.a.info' },
      { id: 'pair_b', pair_number: 2, ns_domain: 'ns.b.info' },
      { id: 'pair_c', pair_number: 3, ns_domain: 'ns.c.info' },
    ],
    domains: [
      { id: 'sd_a', pair_id: 'pair_a', domain: 'a.info' },
      { id: 'sd_b', pair_id: 'pair_b', domain: 'b.info' },
      { id: 'sd_c', pair_id: 'pair_c', domain: 'c.info' },
    ],
  });

  const probedDomains: string[] = [];
  const summary = await dblResweepHandler(
    { triggered_by: 'manual', pair_ids: ['pair_b'] },
    {
      supabase: mockSupabase(f.db),
      checkDomain: async (d) => {
        probedDomains.push(d);
        return clean(d);
      },
      now: fixedNow(NOW),
    }
  );

  assert(summary.runs[0].pairsScanned === 1, 'case4: only one pair scanned');
  assert(
    probedDomains.length === 1 && probedDomains[0] === 'b.info',
    'case4: only requested pair\'s domain was probed'
  );

  // The unscanned pairs' sending_domains should NOT have last_dbl_check_at set
  const unscanned = f.db
    .rows('sending_domains')
    .filter((d) => d.pair_id !== 'pair_b');
  assert(
    unscanned.every((d) => !d.last_dbl_check_at),
    'case4: unscanned domains untouched'
  );
}

// -------------------------------------------------------------------
// Case 5 — Clouding-exclusion (provisioning_job_id IS NULL skipped by default,
//          included only via explicit pair_ids override)
// -------------------------------------------------------------------
{
  // Default scope: only saga-generated pair touched
  {
    const f = buildFixture({
      pairs: [
        {
          id: 'pair_saga',
          pair_number: 10,
          ns_domain: 'ns.saga.info',
          provisioning_job_id: 'job_abc',
        },
        {
          id: 'pair_clouding',
          pair_number: 1,
          ns_domain: 'ns.clouding.info',
          provisioning_job_id: null,
        },
      ],
      domains: [
        { id: 'sd_saga', pair_id: 'pair_saga', domain: 'saga.info' },
        { id: 'sd_clouding', pair_id: 'pair_clouding', domain: 'clouding.info' },
      ],
    });

    const probed: string[] = [];
    const summary = await dblResweepHandler(
      { triggered_by: 'cron' },
      {
        supabase: mockSupabase(f.db),
        checkDomain: async (d) => {
          probed.push(d);
          return clean(d);
        },
        now: fixedNow(NOW),
      }
    );

    assert(
      summary.runs[0].pairsScanned === 1,
      'case5a: default scope scans only the saga-generated pair'
    );
    assert(
      probed.length === 1 && probed[0] === 'saga.info',
      'case5a: Clouding-imported pair\'s domain is NOT probed by default cron'
    );
    const cloudingDomain = f.db
      .rows('sending_domains')
      .find((d) => d.id === 'sd_clouding');
    assert(
      !cloudingDomain?.last_dbl_check_at,
      'case5a: Clouding-imported sending_domain is untouched'
    );
    // Stronger pin: the row must be FULLY untouched, not just status-clean.
    // This catches a regression where someone updates timestamp-only without
    // re-introducing the filter. dbl_check_history must remain its seeded
    // empty array; no probe means no entry.
    const cloudingHistory = cloudingDomain?.dbl_check_history;
    assert(
      Array.isArray(cloudingHistory) && cloudingHistory.length === 0,
      'case5a: Clouding-imported sending_domain has zero history entries (no code path ran)'
    );
    assert(
      cloudingDomain?.dbl_first_burn_at === undefined ||
        cloudingDomain?.dbl_first_burn_at === null,
      'case5a: Clouding-imported sending_domain has no dbl_first_burn_at'
    );
    // And no system_alerts could have been fired against the Clouding pair
    const cloudingAlerts = f.db
      .rows('system_alerts')
      .filter((a) => {
        const det = a.details as Record<string, unknown> | undefined;
        return det?.pair_id === 'pair_clouding';
      });
    assert(
      cloudingAlerts.length === 0,
      'case5a: zero system_alerts attributed to the Clouding pair'
    );
  }

  // Explicit pair_ids override: Clouding pair IS scanned
  {
    const f = buildFixture({
      pairs: [
        {
          id: 'pair_saga',
          pair_number: 10,
          ns_domain: 'ns.saga.info',
          provisioning_job_id: 'job_abc',
        },
        {
          id: 'pair_clouding',
          pair_number: 1,
          ns_domain: 'ns.clouding.info',
          provisioning_job_id: null,
        },
      ],
      domains: [
        { id: 'sd_saga', pair_id: 'pair_saga', domain: 'saga.info' },
        { id: 'sd_clouding', pair_id: 'pair_clouding', domain: 'clouding.info' },
      ],
    });

    const probed: string[] = [];
    const summary = await dblResweepHandler(
      { triggered_by: 'manual', pair_ids: ['pair_clouding'] },
      {
        supabase: mockSupabase(f.db),
        checkDomain: async (d) => {
          probed.push(d);
          return clean(d);
        },
        now: fixedNow(NOW),
      }
    );

    assert(
      summary.runs[0].pairsScanned === 1,
      'case5b: explicit override scans the Clouding pair'
    );
    assert(
      probed.length === 1 && probed[0] === 'clouding.info',
      'case5b: explicit pair_ids include the Clouding-imported pair'
    );
  }
}

console.log('--- dbl-resweep handler tests: all PASS ---');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
