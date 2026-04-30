/**
 * V1a: cost preview unit tests.
 * Run via: tsx src/lib/outscraper/__tests__/cost.test.ts
 */

import { COST_PER_LEAD_USD, estimateCostCents, formatCostUsd } from '../cost';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

let tests = 0;
let failed = 0;
function test(name: string, fn: () => Promise<void> | void) {
  tests++;
  return Promise.resolve()
    .then(() => fn())
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${(err as Error).message}`);
    });
}

console.log('\noutscraper cost util tests\n');

(async () => {
  await test('COST_PER_LEAD_USD matches lead-gen-pipeline skill ($0.0047)', () => {
    assert(COST_PER_LEAD_USD === 0.0047, `expected 0.0047, got ${COST_PER_LEAD_USD}`);
  });

  await test('estimateCostCents(100) = $0.47 = 47 cents', () => {
    const cents = estimateCostCents(100);
    assert(cents === 47, `expected 47, got ${cents}`);
  });

  await test('estimateCostCents(1000) = $4.70 = 470 cents', () => {
    const cents = estimateCostCents(1000);
    assert(cents === 470, `expected 470, got ${cents}`);
  });

  await test('estimateCostCents(0) = 0', () => {
    assert(estimateCostCents(0) === 0, 'zero leads = zero cents');
  });

  await test('estimateCostCents handles invalid inputs', () => {
    assert(estimateCostCents(-5) === 0, 'negative -> 0');
    assert(estimateCostCents(NaN) === 0, 'NaN -> 0');
    assert(estimateCostCents(Infinity) === 0, 'Infinity -> 0');
  });

  await test('formatCostUsd renders dollar string', () => {
    assert(formatCostUsd(47) === '$0.47', 'expected $0.47');
    assert(formatCostUsd(470) === '$4.70', 'expected $4.70');
    assert(formatCostUsd(0) === '$0.00', 'expected $0.00');
    assert(formatCostUsd(-1) === '$0.00', 'negative clamps');
  });

  console.log(`\n${tests - failed}/${tests} passed`);
  if (failed > 0) process.exit(1);
})();
