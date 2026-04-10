/**
 * POST /api/auth/bootstrap-org
 *
 * Lazy organization bootstrap — the dashboard calls this on mount so that
 * any signed-in Clerk user who has an active org also has a matching row in
 * `public.organizations`. This makes the app self-healing when the
 * `/api/webhooks/clerk` path is misconfigured, failing, or hasn't been set
 * up yet. See `src/lib/org-bootstrap.ts` for the full rationale.
 *
 * Contract:
 *   - Auth required (Clerk). 401 if no userId.
 *   - If the user has no active orgId, returns 200 with `{ status: 'no_org' }`
 *     (not an error — the user hasn't picked an org yet, which is legit on
 *     /org-selection or during initial Clerk setup).
 *   - Otherwise ensures a row exists and returns 200 with its state.
 *   - NEVER overwrites plan_tier on an existing row — developer/comped stays
 *     developer/comped.
 *
 * This route is in the Clerk middleware `/api(.*)` public allowlist (per the
 * project's Hard Lesson #35), so the handler enforces auth itself via
 * `auth()`.
 */

import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ensureOrgRow } from "@/lib/org-bootstrap";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!orgId) {
      // User is signed in but hasn't selected / created an organization yet.
      // This is a legitimate intermediate state (e.g., mid-onboarding on
      // /org-selection), not an error. Dashboard layout will retry once the
      // user picks an org.
      return NextResponse.json(
        { status: "no_org" },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Best-effort: look up the Clerk org name so newly-bootstrapped rows
    // have a human-readable label in the admin panel. Failures here are
    // non-fatal — we fall back to `Organization {orgId}`.
    let fallbackName: string | undefined;
    try {
      const clerk = await clerkClient();
      const clerkOrg = await clerk.organizations.getOrganization({
        organizationId: orgId,
      });
      fallbackName = clerkOrg?.name || clerkOrg?.slug || undefined;
    } catch (clerkErr) {
      console.warn(
        `[bootstrap-org] Could not fetch Clerk org name for ${orgId}:`,
        clerkErr instanceof Error ? clerkErr.message : String(clerkErr)
      );
    }

    const result = await ensureOrgRow(orgId, fallbackName);

    if (result.status === "error") {
      return NextResponse.json(
        { error: result.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        status: result.status,
        orgId: result.orgId,
        planTier: result.planTier,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[bootstrap-org] Unexpected error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "bootstrap-org failed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
