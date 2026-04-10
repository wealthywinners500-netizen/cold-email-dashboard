/**
 * Organization bootstrap — single source of truth for lazily creating
 * a `public.organizations` row when it doesn't already exist.
 *
 * Why this exists
 * ---------------
 * The intended flow is: user creates an org in Clerk → Clerk fires an
 * `organization.created` webhook → `/api/webhooks/clerk` inserts the matching
 * row into Supabase → dashboard API routes find the row and serve real data.
 *
 * The webhook path has three failure modes that break that flow in production:
 *   1. `CLERK_WEBHOOK_SECRET` is unset in the hosting environment, so every
 *      webhook delivery returns HTTP 500 before any DB write happens.
 *   2. The Clerk → Svix endpoint was never configured in the Clerk dashboard,
 *      so no webhook is ever sent.
 *   3. The webhook delivery network-fails between Clerk and the edge, and
 *      Svix retry budgets eventually exhaust.
 *
 * In any of those cases the dashboard is completely unusable for the affected
 * user: every API route 401s with "organization not found" and billing
 * checkout 404s, so the user can't even subscribe to unblock themselves.
 *
 * The fix is to treat the webhook as a best-effort fast path and make the
 * dashboard self-healing: any authenticated request with a valid Clerk orgId
 * can call `ensureOrgRow()`, which upserts the row if missing. The dashboard
 * layout calls this on mount so the row exists before the first data fetch.
 *
 * Design invariants
 * -----------------
 *   - NEVER overwrite `plan_tier` on an existing row. A developer/comped
 *     account that already exists must not be silently downgraded by a
 *     bootstrap call. Only new rows get `plan_tier: 'starter'`.
 *   - NEVER overwrite `stripe_customer_id` / `stripe_subscription_id` on an
 *     existing row — those are owned by the Stripe webhook path.
 *   - Idempotent: calling twice in a row with the same clerkOrgId is a no-op
 *     on the second call (returns the existing row).
 *   - Safe to call from any authenticated server context; uses the admin
 *     client (service role) so it bypasses RLS.
 */

import { createAdminClient } from "@/lib/supabase/server";

export type BootstrapResult =
  | { status: "existed"; orgId: string; planTier: string }
  | { status: "created"; orgId: string; planTier: "starter" }
  | { status: "error"; message: string };

/**
 * Ensure a row exists in `public.organizations` for the given Clerk org id.
 *
 * Lookup order: matches on `clerk_org_id` first, then on `id` (which is the
 * Clerk org id for any row created after the 2026-04-07 typo fix, but may
 * still differ on legacy rows). If neither finds a row, inserts a new one
 * with `id = clerk_org_id = clerkOrgId` and `plan_tier = 'starter'`.
 *
 * @param clerkOrgId — The Clerk organization id (e.g., `org_abc123...`)
 * @param fallbackName — Human-readable name to use if the row does not yet
 *   exist. The caller is responsible for passing the real Clerk org name when
 *   available; otherwise a generic placeholder is used.
 */
export async function ensureOrgRow(
  clerkOrgId: string,
  fallbackName?: string
): Promise<BootstrapResult> {
  if (!clerkOrgId || typeof clerkOrgId !== "string") {
    return { status: "error", message: "clerkOrgId is required" };
  }

  const supabase = await createAdminClient();

  // Step 1: look up existing row by either clerk_org_id or id. We use `or=`
  // instead of two separate queries because (a) most rows have id == clerk_org_id
  // post-2026-04-07, and (b) legacy rows may have a typo id but the correct
  // clerk_org_id — either match is valid.
  const { data: existing, error: lookupErr } = await supabase
    .from("organizations")
    .select("id, plan_tier")
    .or(`clerk_org_id.eq.${clerkOrgId},id.eq.${clerkOrgId}`)
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.error(
      `[org-bootstrap] Lookup failed for clerk_org_id=${clerkOrgId}:`,
      lookupErr
    );
    return { status: "error", message: lookupErr.message };
  }

  if (existing) {
    return {
      status: "existed",
      orgId: existing.id as string,
      planTier: (existing.plan_tier as string) || "starter",
    };
  }

  // Step 2: no row exists — insert a fresh starter row. We MUST NOT use the
  // supabase-js typed builder here because `organizations` has columns
  // (`stripe_subscription_id`, `integrations`, `worker_*`) that are not in
  // `src/lib/supabase/types.ts`; the generated Insert type would reject the
  // payload. Raw fetch to PostgREST sidesteps the type mismatch while the
  // canonical pattern is to fall back to the untyped client.
  const name = (fallbackName || `Organization ${clerkOrgId}`).trim();

  const insertPayload = {
    id: clerkOrgId,
    clerk_org_id: clerkOrgId,
    name,
    plan_tier: "starter",
  };

  // Use the untyped form via `as unknown as never` to bypass the narrow
  // generated Insert type — this matches how the clerk webhook handler
  // historically inserted the same row shape.
  const { error: insertErr } = await supabase
    .from("organizations")
    .insert(insertPayload as unknown as never);

  if (insertErr) {
    // Race: a concurrent bootstrap / webhook delivery beat us to the insert.
    // Any unique-constraint violation means the row now exists, which is the
    // exact outcome we wanted. Re-read and return it.
    const isDuplicate =
      insertErr.code === "23505" ||
      /duplicate key|already exists/i.test(insertErr.message);

    if (isDuplicate) {
      const { data: refetch, error: refetchErr } = await supabase
        .from("organizations")
        .select("id, plan_tier")
        .or(`clerk_org_id.eq.${clerkOrgId},id.eq.${clerkOrgId}`)
        .limit(1)
        .maybeSingle();

      if (refetchErr || !refetch) {
        console.error(
          `[org-bootstrap] Duplicate on insert but refetch failed for ${clerkOrgId}:`,
          refetchErr
        );
        return {
          status: "error",
          message: "duplicate_on_insert_refetch_failed",
        };
      }

      return {
        status: "existed",
        orgId: refetch.id as string,
        planTier: (refetch.plan_tier as string) || "starter",
      };
    }

    console.error(
      `[org-bootstrap] Insert failed for ${clerkOrgId}:`,
      insertErr
    );
    return { status: "error", message: insertErr.message };
  }

  return { status: "created", orgId: clerkOrgId, planTier: "starter" };
}
