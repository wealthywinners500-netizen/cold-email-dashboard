/**
 * Saga sending_domains INSERT contract — vs migration 021
 *
 * Replicates (does NOT import) the EXACT INSERT shape the saga produces in
 * src/app/api/provisioning/[jobId]/worker-callback/route.ts:357-375 — the
 * three-field row { pair_id, domain, primary_server_id }. Drives that shape
 * against live Supabase post-migration to prove:
 *
 *   1. The INSERT still succeeds with no required-field errors
 *   2. The new migration-021 columns populate with their schema defaults:
 *        last_dbl_check_at  IS NULL
 *        dbl_check_history  = []
 *        dbl_first_burn_at  IS NULL
 *
 * If this test ever fails, the migration broke the saga's INSERT path —
 * ROLL BACK the migration before any other action. P0. Fix-forward is
 * forbidden because the saga is the only thing that writes sending_domains
 * during provisioning.
 *
 * GATING: This test hits live Supabase. It is opt-in via RUN_LIVE_CONTRACT_TESTS=1
 * so test:gate0 doesn't hammer prod every CI run. Required env:
 *   RUN_LIVE_CONTRACT_TESTS=1
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CONTRACT_TEST_ORG_ID  (an existing organizations.id — the test creates
 *                          and cleans up a throwaway server_pair beneath it)
 *
 * NOT imported: pair-provisioning-saga.ts, worker-callback/route.ts. The
 * INSERT shape is replicated literally below so the saga code is not pulled
 * into this test's compile graph.
 *
 * Run: RUN_LIVE_CONTRACT_TESTS=1 \
 *      NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *      CONTRACT_TEST_ORG_ID=org_... \
 *      npx tsx src/__tests__/saga-sending-domains-insert-contract.test.ts
 */

import { createClient } from '@supabase/supabase-js';

function assert(condition: unknown, label: string): void {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

async function main() {
  console.log('--- saga sending_domains INSERT contract vs migration 021 ---');

  if (process.env.RUN_LIVE_CONTRACT_TESTS !== '1') {
    console.log(
      'SKIP: RUN_LIVE_CONTRACT_TESTS != 1 — this test hits live Supabase. ' +
        'Run manually after applying migration 021 to prod.'
    );
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orgId = process.env.CONTRACT_TEST_ORG_ID;

  if (!url || !key || !orgId) {
    console.error(
      'FAIL: live contract test requires NEXT_PUBLIC_SUPABASE_URL + ' +
        'SUPABASE_SERVICE_ROLE_KEY + CONTRACT_TEST_ORG_ID env vars'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false },
  });

  // Use a high pair_number to minimise collision risk with real pairs.
  // The (org_id, pair_number) UNIQUE constraint means we'd error early on
  // a collision, which is recoverable — the test bails before mutating.
  const testPairNumber = 9999;
  const testNsDomain = `contract-test-${Date.now()}.invalid`;
  const testDomain = `sd-contract-${Date.now()}.invalid`;

  // Defensive cleanup: a prior run that crashed before the finally-block
  // could leave a (org_id, pair_number=9999) row behind, which would make
  // this run's INSERT trip the UNIQUE constraint. Delete any such residue
  // before attempting the throwaway INSERT.
  const { error: cleanupResidueErr } = await supabase
    .from('server_pairs')
    .delete()
    .eq('org_id', orgId)
    .eq('pair_number', testPairNumber);
  if (cleanupResidueErr) {
    console.warn(
      `[contract] residue cleanup warning (non-fatal): ${cleanupResidueErr.message}`
    );
  }

  // 1. Create a throwaway server_pair under the requested org.
  // server_pairs requires a number of NOT NULL columns beyond what the
  // saga's worker-callback ever needs to populate (s1_ip / s1_hostname /
  // s2_ip / s2_hostname). Supply harmless RFC 5737 reserved-test addresses
  // and `.invalid` hostnames — the row is purely for the FK target on the
  // synthetic sending_domain insert and never reaches any real network.
  console.log(
    `[contract] inserting throwaway server_pair (org=${orgId} #${testPairNumber} ns=${testNsDomain})`
  );
  const { data: pair, error: pairErr } = await supabase
    .from('server_pairs')
    .insert({
      org_id: orgId,
      pair_number: testPairNumber,
      ns_domain: testNsDomain,
      s1_ip: '192.0.2.1',          // RFC 5737 TEST-NET-1 — never routed
      s1_hostname: 'test-s1.invalid',
      s2_ip: '192.0.2.2',          // RFC 5737 TEST-NET-1 — never routed
      s2_hostname: 'test-s2.invalid',
      status: 'planned',
    })
    .select('id')
    .single();

  if (pairErr || !pair) {
    console.error('FAIL: could not create throwaway server_pair:', pairErr);
    process.exit(1);
  }
  const pairId = pair.id as string;
  console.log(`[contract] throwaway pair id=${pairId}`);

  let exitCode = 0;
  try {
    // 2. INSERT the EXACT row shape the saga's worker-callback produces.
    //    Source: src/app/api/provisioning/[jobId]/worker-callback/route.ts:364-368
    //
    //      const sdRows = sendingDomainsList.map((domain: string) => ({
    //        pair_id: serverPair.id,
    //        domain,
    //        primary_server_id: server1DomainsSet.has(domain) ? 's1' : 's2',
    //      }));
    //
    //    Three fields. Everything else must default cleanly.
    const sagaShapedRow = {
      pair_id: pairId,
      domain: testDomain,
      primary_server_id: 's1',
    };

    console.log('[contract] inserting saga-shaped sending_domains row');
    const { error: sdInsertErr } = await supabase
      .from('sending_domains')
      .insert(sagaShapedRow);
    assert(
      sdInsertErr === null,
      `saga's sending_domains INSERT shape still works post-migration (${sdInsertErr?.message ?? 'ok'})`
    );

    // 3. Read back the row and verify migration-021 defaults populated cleanly.
    interface ReadBackRow {
      pair_id: string;
      domain: string;
      primary_server_id: string;
      blacklist_status: string;
      last_dbl_check_at: string | null;
      dbl_check_history: unknown;
      dbl_first_burn_at: string | null;
    }
    const { data: readBackRaw, error: readErr } = await supabase
      .from('sending_domains')
      .select(
        'pair_id, domain, primary_server_id, blacklist_status, ' +
          'last_dbl_check_at, dbl_check_history, dbl_first_burn_at'
      )
      .eq('pair_id', pairId)
      .eq('domain', testDomain)
      .single();
    const readBack = readBackRaw as unknown as ReadBackRow | null;

    assert(readErr === null, `read-back succeeded (${readErr?.message ?? 'ok'})`);
    assert(readBack !== null, 'row was actually persisted');

    // Saga-shape preservation
    assert(
      readBack?.pair_id === pairId,
      'pair_id round-trips unchanged'
    );
    assert(
      readBack?.domain === testDomain,
      'domain round-trips unchanged'
    );
    assert(
      readBack?.primary_server_id === 's1',
      'primary_server_id round-trips unchanged'
    );

    // Pre-existing default still works
    assert(
      readBack?.blacklist_status === 'clean',
      "pre-existing default blacklist_status='clean' still applied"
    );

    // Migration 021 defaults
    assert(
      readBack?.last_dbl_check_at === null,
      'migration 021: last_dbl_check_at defaults to NULL'
    );
    assert(
      readBack?.dbl_first_burn_at === null,
      'migration 021: dbl_first_burn_at defaults to NULL'
    );
    // PostgREST returns jsonb '[]'::jsonb as the JS array []. Accept either
    // representation defensively in case driver coercion changes.
    const history = readBack?.dbl_check_history;
    const isEmptyArray =
      (Array.isArray(history) && history.length === 0) || history === '[]';
    assert(
      isEmptyArray,
      `migration 021: dbl_check_history defaults to [] (got ${JSON.stringify(history)})`
    );

    console.log('--- contract test: all PASS ---');
  } catch (err) {
    console.error('FATAL:', err);
    exitCode = 1;
  } finally {
    // 4. Cleanup. server_pairs has ON DELETE CASCADE for sending_domains
    //    (see migration 001) so deleting the pair removes the synthetic
    //    domain row too.
    console.log('[contract] cleaning up throwaway pair + cascaded domain');
    const { error: cleanupErr } = await supabase
      .from('server_pairs')
      .delete()
      .eq('id', pairId);
    if (cleanupErr) {
      console.error(
        `[contract] WARNING — cleanup of throwaway pair ${pairId} failed: ${cleanupErr.message}`
      );
      console.error(
        '[contract] manually delete the row to avoid clutter:'
      );
      console.error(
        `[contract]   DELETE FROM server_pairs WHERE id = '${pairId}';`
      );
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
