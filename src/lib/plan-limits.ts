// NOTE: This is the legacy per-plan limits table used by the server-pairs
// CRUD route and the settings page. The newer PLAN_TIERS in plan-enforcement.ts
// is the authoritative source used by the provisioning gate. Keep these two
// in sync when adding a new tier.
//
// 'developer' and 'comped' are admin-granted free tiers (see plan-enforcement.ts
// for the doc comment). 'developer' has enterprise-level ceilings; 'comped' has
// starter-level ceilings.
export const PLAN_LIMITS = {
  starter: { maxServerPairs: 3, maxUsers: 1, apiAccess: false },
  comped: { maxServerPairs: 3, maxUsers: 1, apiAccess: false },
  pro: { maxServerPairs: Infinity, maxUsers: 5, apiAccess: true },
  developer: { maxServerPairs: Infinity, maxUsers: Infinity, apiAccess: true },
  enterprise: { maxServerPairs: Infinity, maxUsers: Infinity, apiAccess: true },
} as const;

export type PlanTier = keyof typeof PLAN_LIMITS;

export function getPlanLimits(planTier: string) {
  return PLAN_LIMITS[planTier as PlanTier] || PLAN_LIMITS.starter;
}

export function checkLimit(
  planTier: string,
  resource: keyof (typeof PLAN_LIMITS)["starter"],
  currentCount: number
): boolean {
  const limits = getPlanLimits(planTier);
  const limit = limits[resource];
  if (typeof limit === "number") return currentCount < limit;
  return true;
}
