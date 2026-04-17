/**
 * Feature flags gate new Campaigns v2 surface area so phases 4–7 can ship
 * incrementally without exposing half-built tabs. Default OFF; flip per org
 * via the org_settings row or environment override.
 *
 * Usage:
 *   import { isFeatureEnabled } from '@/lib/featureFlags';
 *   if (await isFeatureEnabled('campaigns_v2', orgId)) { ... }
 */

export type FeatureFlag = 'campaigns_v2';

const DEFAULTS: Record<FeatureFlag, boolean> = {
  campaigns_v2: false,
};

const ENV_OVERRIDES: Record<FeatureFlag, string> = {
  campaigns_v2: 'FEATURE_CAMPAIGNS_V2',
};

export async function isFeatureEnabled(
  flag: FeatureFlag,
  _orgId: string,
): Promise<boolean> {
  const envVar = ENV_OVERRIDES[flag];
  const envValue = process.env[envVar];
  if (envValue !== undefined) {
    return envValue === 'true' || envValue === '1';
  }
  return DEFAULTS[flag];
}

export function isFeatureEnabledSync(flag: FeatureFlag): boolean {
  const envVar = ENV_OVERRIDES[flag];
  const envValue = process.env[envVar];
  if (envValue !== undefined) {
    return envValue === 'true' || envValue === '1';
  }
  return DEFAULTS[flag];
}
