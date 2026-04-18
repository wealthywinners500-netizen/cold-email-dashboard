// ============================================
// UI-only types for the Pair Verify detail page.
//
// Mirrors the backend contract from:
//   - src/app/api/pairs/[id]/verifications/route.ts
//   - src/app/api/pairs/[id]/verifications/[vid]/route.ts
//   - supabase/migrations/018_pair_verifications.sql
//
// Kept local to this route on purpose (per spec) so verification
// types do not sprawl into shared modules.
// ============================================

export type VerificationStatus = 'green' | 'yellow' | 'red' | 'running';
export type CheckResult = 'pass' | 'fail' | 'warn';

export interface VerificationCheck {
  name: string;
  result: CheckResult;
  details: unknown; // backend stores this as arbitrary JSON (string | object).
  is_sem_warning: boolean;
}

export interface VerificationRow {
  id: string;
  pair_id: string;
  run_at: string; // timestamptz
  run_by: string | null; // clerk user id
  status: VerificationStatus;
  checks: VerificationCheck[];
  duration_ms: number | null;
  completed_at?: string | null;
}

export interface PairSummary {
  id: string;
  pair_number: number;
  ns_domain: string;
  s1_ip: string;
  s1_hostname: string;
  s2_ip: string;
  s2_hostname: string;
  status: string;
  warmup_day: number;
}

// Polling constants — exported so the smoke test can assert them and so any
// future tuning is obvious.
export const POLL_INTERVAL_MS = 5_000;
export const POLL_MAX_MS = 5 * 60 * 1_000; // 5 minutes
