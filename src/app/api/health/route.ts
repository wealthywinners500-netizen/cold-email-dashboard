// Public liveness probe. No auth, no DB, tiny response.
// Downstream sessions (Gate 4 observe, uptime monitors) depend on this being
// unauthenticated and cheap. Do NOT add readiness-style checks here — if you
// need DB/worker status, use /api/health/hands-free instead.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel injects VERCEL_GIT_COMMIT_SHA at build time. Falls back to the
// generic COMMIT_SHA if someone sets it manually; ultimately 'unknown' so the
// endpoint never fails because a build env var is missing.
const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  "unknown";

// Captured at module load — the closest we get to "when this server binary
// was deployed" inside Vercel's serverless runtime.
const DEPLOYED_AT = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      commit: COMMIT,
      deployedAt: DEPLOYED_AT,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
