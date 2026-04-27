# Saga `sending_domains` INSERT contract — validation against post-migration prod

**Project:** `ziaszamgvovjgybfyoxz` (cold-email-dashboard)
**Branch:** `feat/dbl-resweep-2026-04-27` (PR #21)
**Captured at:** 2026-04-27, immediately after migration 021 was applied
**Test:** `src/__tests__/saga-sending-domains-insert-contract.test.ts` (commit 48ee53a)

## Result: GREEN — all 10 assertions pass against live post-migration schema

```
$ RUN_LIVE_CONTRACT_TESTS=1 \
    CONTRACT_TEST_ORG_ID=org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q \
    npx tsx src/__tests__/saga-sending-domains-insert-contract.test.ts

--- saga sending_domains INSERT contract vs migration 021 ---
[contract] inserting throwaway server_pair (org=org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q #9999 ns=contract-test-1777313311070.invalid)
[contract] throwaway pair id=c39c1afd-d7ca-48a4-a770-62072dcc0e3e
[contract] inserting saga-shaped sending_domains row
PASS: saga's sending_domains INSERT shape still works post-migration (ok)
PASS: read-back succeeded (ok)
PASS: row was actually persisted
PASS: pair_id round-trips unchanged
PASS: domain round-trips unchanged
PASS: primary_server_id round-trips unchanged
PASS: pre-existing default blacklist_status='clean' still applied
PASS: migration 021: last_dbl_check_at defaults to NULL
PASS: migration 021: dbl_first_burn_at defaults to NULL
PASS: migration 021: dbl_check_history defaults to [] (got [])
--- contract test: all PASS ---
[contract] cleaning up throwaway pair + cascaded domain
EXIT 0
```

## What this proves

The saga's literal three-field INSERT shape (`pair_id, domain, primary_server_id`) — replicated literally from `src/app/api/provisioning/[jobId]/worker-callback/route.ts:364-368` and **NOT imported** to keep the saga compile graph isolated — round-trips unchanged against the post-migration schema. Migration 021's three new columns populate with their declared defaults on a fresh INSERT:

- `last_dbl_check_at` → `NULL`
- `dbl_check_history` → `[]`
- `dbl_first_burn_at` → `NULL`

The pre-existing `blacklist_status='clean'` default is also preserved. The saga's `sending_domains` INSERT path is unaffected by migration 021.

## Cleanup verified

```
$ curl ... /rest/v1/server_pairs?pair_number=eq.9999
[]
$ curl ... /rest/v1/sending_domains?or=(domain.like.contract-test-*,domain.like.sd-contract-*)
[]
```

Throwaway pair + cascaded synthetic sending_domain row both deleted by the test's `finally` block. No residue.

## Path notes

- First attempt of this test (commit `486c7a0`) errored at fixture setup with `null value in column "s1_ip"` because the throwaway-pair INSERT only supplied 4 of the 8 required NOT NULL columns on `server_pairs`. Discovery: bug in the test, not in the migration. Fixed in commit `48ee53a` by supplying RFC 5737 TEST-NET-1 reserved addresses + `*.invalid` hostnames for `s1_ip / s1_hostname / s2_ip / s2_hostname`. Test now runs cleanly.
- Migration 021 was applied via the Management API SQL endpoint (`npx supabase db query --linked --file ...`), NOT `supabase db push`, because the Supabase CLI tracker (`supabase_migrations.schema_migrations`) was empty for migrations 001–020 in prod. See [reports/2026-04-27-migration-tracking-repair.md](2026-04-27-migration-tracking-repair.md) for the full diagnosis and tracker-state details.
- Tracker row for `version='021'` was inserted via the same path; future `db push` calls will recognize 021 as applied.

## Hard rule (escalation)

If this contract test ever fails on a future migration, **roll back the migration before any other action.** Broken saga is P0; fix-forward is forbidden. The saga is the only thing that writes `sending_domains` during provisioning; a broken INSERT shape blocks every new pair.
