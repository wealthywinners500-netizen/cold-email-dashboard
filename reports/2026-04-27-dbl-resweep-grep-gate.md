# dbl-resweep PR — pre-PR-open evidence

**PR:** [#21](https://github.com/wealthywinners500-netizen/cold-email-dashboard/pull/21)
**Branch:** `feat/dbl-resweep-2026-04-27`
**Captured at:** 2026-04-27

This report consolidates the saga-preservation evidence required before the PR is merged: the literal grep gate, typecheck output, full `test:gate0` chain output, and commit SHAs of every commit on the branch.

## Commit SHAs on the branch (in order)

| sha | subject |
|---|---|
| `8975454` | `feat: weekly post-launch DBL re-sweep job + admin monitor panel` |
| `0ed23d8` | `docs: golden saga sha256 snapshot pre-dbl-resweep` |
| `a288e90` | `test: lock saga isolation invariant for dbl-resweep PR` |
| `486c7a0` | `test: saga sending_domains INSERT contract vs migration 021` |
| `6565b95` | `fix(handler): exclude Clouding-imported pairs from default cron scope` |

## Grep gate (literal command)

```sh
git diff --name-only origin/main...HEAD | grep -E "lib/provisioning/(pair-provisioning-saga|provision-step|pair-verify|serverless-steps|auto-fix|dns-templates|domain-blacklist|domain-listing|encryption|cloud-init-templates|csv-generator|dnsbl-liveness)|provisioning/checks/(intodns|mxtoolbox)|app/api/provisioning|app/dashboard/(provisioning|pairs)" && echo "❌ HALT — saga file modified" && exit 1 || echo "✓ No saga files modified"
```

**Output:**

```
✓ No saga files modified
```

## Files this branch DID modify

```
package.json
reports/2026-04-27-golden-saga-snapshot-pre-dbl-resweep.md
src/__tests__/dbl-resweep-saga-isolation.test.ts
src/__tests__/saga-sending-domains-insert-contract.test.ts
src/app/api/admin/dbl-monitor/route.ts
src/app/api/admin/dbl-monitor/run/route.ts
src/app/dashboard/admin/dbl-monitor/page.tsx
src/app/dashboard/admin/dbl-monitor/run-now-button.tsx
src/worker/handlers/__tests__/dbl-resweep.test.ts
src/worker/handlers/dbl-resweep.ts
src/worker/index.ts
supabase/migrations/021_dbl_resweep.sql
```

Zero files match the saga-territory patterns. Confirmed by both the literal grep gate above and by `src/__tests__/dbl-resweep-saga-isolation.test.ts` (now wired into `test:gate0`).

## `npm run typecheck`

```
> cold-email-dashboard@0.1.0 typecheck
> tsc --noEmit
```

Exit 0. No errors.

## `npm run test:gate0`

Full chain green — 23 prior test files plus the two new ones (`dbl-resweep.test.ts`, `dbl-resweep-saga-isolation.test.ts`). The live contract test (`saga-sending-domains-insert-contract.test.ts`) is gated behind `RUN_LIVE_CONTRACT_TESTS=1` and intentionally NOT in the gate-0 chain.

Tail of the run:

```
[dbl-resweep] Completed sweep — orgs=1 runs=1 pairs=1 domains=1 newBurns=0
PASS: case4: only one pair scanned
PASS: case4: only requested pair's domain was probed
PASS: case4: unscanned domains untouched
[dbl-resweep] Completed sweep — orgs=1 runs=1 pairs=1 domains=1 newBurns=0
PASS: case5a: default scope scans only the saga-generated pair
PASS: case5a: Clouding-imported pair's domain is NOT probed by default cron
PASS: case5a: Clouding-imported sending_domain is untouched
PASS: case5a: Clouding-imported sending_domain has zero history entries (no code path ran)
PASS: case5a: Clouding-imported sending_domain has no dbl_first_burn_at
PASS: case5a: zero system_alerts attributed to the Clouding pair
[dbl-resweep] Completed sweep — orgs=1 runs=1 pairs=1 domains=1 newBurns=0
PASS: case5b: explicit override scans the Clouding pair
PASS: case5b: explicit pair_ids include the Clouding-imported pair
--- dbl-resweep handler tests: all PASS ---
--- dbl-resweep saga-isolation invariant ---
[saga-isolation] base=origin/main files-changed=12
PASS: (a) zero saga files modified by this branch
PASS: (b) zero provisioning/pairs UI or API paths modified
--- saga-isolation invariant: all PASS ---
```

Exit 0.

## Live contract test — deferred

`src/__tests__/saga-sending-domains-insert-contract.test.ts` cannot run until migration 021 is applied to live Supabase. The test prints SKIP unless `RUN_LIVE_CONTRACT_TESTS=1` is set:

```
$ npx tsx src/__tests__/saga-sending-domains-insert-contract.test.ts
--- saga sending_domains INSERT contract vs migration 021 ---
SKIP: RUN_LIVE_CONTRACT_TESTS != 1 — this test hits live Supabase. Run manually after applying migration 021 to prod.
```

Manual run command (after migration 021 is applied):

```sh
RUN_LIVE_CONTRACT_TESTS=1 \
  NEXT_PUBLIC_SUPABASE_URL="https://<your-project>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
  CONTRACT_TEST_ORG_ID="org_3C2CaqUMSFDyZ9wTXmvFRGPoO0q" \
  npx tsx src/__tests__/saga-sending-domains-insert-contract.test.ts
```

## Hard rule (escalation)

If the live contract test ever fails on a future migration, **roll back the migration before any other action.** Broken saga is P0; fix-forward is forbidden, because the saga is the only thing that writes `sending_domains` during provisioning and a broken INSERT shape blocks every new pair.
