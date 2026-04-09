import { createClient } from '@supabase/supabase-js';

/**
 * Plan Resource Types — Keys that map to specific plan limits
 */
export enum PlanResource {
  SERVER_PAIRS = 'server_pairs',
  EMAIL_ACCOUNTS = 'email_accounts',
  CAMPAIGNS = 'campaigns',
  DAILY_SENDS = 'daily_sends',
  LEAD_CONTACTS = 'lead_contacts',
  TEAM_MEMBERS = 'team_members',
}

/**
 * Plan tier definitions
 */
export type PlanTier = 'starter' | 'pro' | 'enterprise';

/**
 * Plan limits structure
 */
export interface PlanLimits {
  server_pairs: number;
  email_accounts: number;
  campaigns: number;
  daily_sends: number;
  lead_contacts: number;
  team_members: number;
}

/**
 * Response from checkPlanLimit — tells caller if an action is allowed
 */
export interface PlanLimitCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  plan: PlanTier;
}

/**
 * Hard limits per plan tier
 * Starter ($29/mo): limited features
 * Pro ($79/mo): full features
 * Enterprise (custom): unlimited
 */
const PLAN_TIERS: Record<PlanTier, PlanLimits> = {
  starter: {
    server_pairs: 2,
    email_accounts: 20,
    campaigns: 5,
    daily_sends: 500,
    lead_contacts: 1000,
    team_members: 1,
  },
  pro: {
    server_pairs: 10,
    email_accounts: 150,
    campaigns: 50,
    daily_sends: 5000,
    lead_contacts: 25000,
    team_members: 5,
  },
  enterprise: {
    server_pairs: 999,
    email_accounts: 999,
    campaigns: 999,
    daily_sends: 50000,
    lead_contacts: 999,
    team_members: 25,
  },
};

/**
 * Lazy-init Supabase client with service role key
 * Service role bypasses RLS for server-side plan enforcement
 */
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    }
  );
}

/**
 * Get plan limits for a specific tier
 * @param planTier — 'starter' | 'pro' | 'enterprise'
 * @returns PlanLimits object with all resource limits
 */
export function getPlanLimits(planTier: string): PlanLimits {
  const tier = (planTier.toLowerCase() as PlanTier) || 'starter';
  return PLAN_TIERS[tier] || PLAN_TIERS.starter;
}

/**
 * Fetch current usage count for a specific resource in an organization
 * @param orgId — Organization ID
 * @param resource — PlanResource type
 * @returns Current count of the resource
 */
async function getCurrentUsage(
  orgId: string,
  resource: PlanResource
): Promise<number> {
  const supabase = getSupabase();

  try {
    switch (resource) {
      case PlanResource.SERVER_PAIRS: {
        const { count, error } = await supabase
          .from('server_pairs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId);

        if (error) throw error;
        return count || 0;
      }

      case PlanResource.EMAIL_ACCOUNTS: {
        const { count, error } = await supabase
          .from('email_accounts')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId);

        if (error) throw error;
        return count || 0;
      }

      case PlanResource.CAMPAIGNS: {
        const { count, error } = await supabase
          .from('campaigns')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .neq('status', 'archived');

        if (error) throw error;
        return count || 0;
      }

      case PlanResource.DAILY_SENDS: {
        const { data, error } = await supabase
          .from('email_accounts')
          .select('sends_today')
          .eq('org_id', orgId);

        if (error) throw error;
        return (
          data?.reduce((sum, row) => sum + (row.sends_today || 0), 0) || 0
        );
      }

      case PlanResource.LEAD_CONTACTS: {
        const { count, error } = await supabase
          .from('lead_contacts')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId);

        if (error) throw error;
        return count || 0;
      }

      case PlanResource.TEAM_MEMBERS: {
        // Team members are tracked via org_members table
        const { count, error } = await supabase
          .from('org_members')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId);

        if (error) throw error;
        return count || 0;
      }

      default:
        throw new Error(`Unknown plan resource: ${resource}`);
    }
  } catch (error) {
    console.error(`Failed to fetch usage for ${resource} in org ${orgId}:`, error);
    // If query fails, deny the action (fail-safe for payment enforcement)
    throw new Error(`Failed to enforce plan limit for ${resource}`);
  }
}

/**
 * Check if an organization is allowed to add/use a resource
 *
 * CRITICAL: This is the authoritative gate for resource creation.
 * All API routes that create resources must call this before proceeding.
 *
 * @param orgId — Organization ID
 * @param resource — PlanResource type (e.g., 'server_pairs')
 * @param currentCount — (Optional) Pre-calculated current usage count. If not provided, queries DB.
 * @returns { allowed: boolean, limit: number, current: number, plan: string }
 *
 * Example:
 *   const check = await checkPlanLimit('org_123', PlanResource.SERVER_PAIRS);
 *   if (!check.allowed) {
 *     return res.status(403).json({ error: `Limit reached. You have ${check.current}/${check.limit} server pairs.` });
 *   }
 */
export async function checkPlanLimit(
  orgId: string,
  resource: PlanResource,
  currentCount?: number
): Promise<PlanLimitCheckResult> {
  const supabase = getSupabase();

  // Step 1: Fetch organization to get plan_tier
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('plan_tier')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    console.error(`Organization not found: ${orgId}`, orgError);
    throw new Error(`Organization ${orgId} not found`);
  }

  // Step 2: Get plan limits for this tier
  const planTier = (org.plan_tier as PlanTier) || 'starter';
  const limits = getPlanLimits(planTier);
  const limit = limits[resource as keyof PlanLimits];

  // Step 3: Get current usage (use provided count or query DB)
  const current: number = currentCount !== undefined
    ? currentCount
    : await getCurrentUsage(orgId, resource);

  // Step 4: Return result
  return {
    allowed: current < limit,
    limit,
    current,
    plan: planTier,
  };
}

/**
 * Batch check multiple resources at once
 * Useful for dashboard display or multi-field validation
 *
 * @param orgId — Organization ID
 * @param resources — Array of PlanResource types to check
 * @returns Map of resource -> PlanLimitCheckResult
 */
export async function checkMultiplePlanLimits(
  orgId: string,
  resources: PlanResource[]
): Promise<Map<PlanResource, PlanLimitCheckResult>> {
  const results = new Map<PlanResource, PlanLimitCheckResult>();

  for (const resource of resources) {
    try {
      const check = await checkPlanLimit(orgId, resource);
      results.set(resource, check);
    } catch (error) {
      console.error(`Failed to check limit for ${resource}:`, error);
      // Fail-safe: mark as not allowed if check fails
      results.set(resource, {
        allowed: false,
        limit: 0,
        current: 0,
        plan: 'starter',
      });
    }
  }

  return results;
}

/**
 * Format a limit check result into a human-readable message
 * @param check — Result from checkPlanLimit
 * @param resource — The resource being checked
 * @returns Human-readable message
 */
export function formatLimitMessage(
  check: PlanLimitCheckResult,
  resource: PlanResource
): string {
  if (check.allowed) {
    return `${resource}: ${check.current}/${check.limit} (${check.plan} plan)`;
  }

  return `${resource} limit reached. You have ${check.current}/${check.limit} on your ${check.plan} plan. Upgrade to add more.`;
}
