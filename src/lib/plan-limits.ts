export const PLAN_LIMITS = {
  starter: { maxServerPairs: 3, maxUsers: 1, apiAccess: false },
  pro: { maxServerPairs: Infinity, maxUsers: 5, apiAccess: true },
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
