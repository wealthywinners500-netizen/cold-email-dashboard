// V1a + V8: cost preview for Outscraper scrapes.
//
// Per the lead-gen-pipeline skill, budget cap is $0.0047 per lead blended
// (Outscraper /tasks google_maps_service_v2 + contacts_n_leads enrichment).
// Documented in dashboard-app/reports/2026-04-30-outscraper-tasks-api-design.md §7.

export const COST_PER_LEAD_USD = 0.0047;

export function estimateCostCents(estimatedLeadCount: number): number {
  if (!Number.isFinite(estimatedLeadCount) || estimatedLeadCount <= 0) return 0;
  return Math.round(estimatedLeadCount * COST_PER_LEAD_USD * 100);
}

export function formatCostUsd(cents: number): string {
  if (cents < 0) return '$0.00';
  return `$${(cents / 100).toFixed(2)}`;
}
