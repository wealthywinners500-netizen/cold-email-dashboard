import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkDomainBlacklists } from "@/lib/provisioning/domain-blacklist";

export const dynamic = "force-dynamic";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * POST /api/provisioning/check-domain
 * Checks a domain against Spamhaus DBL + SURBL + URIBL via real DNS lookups.
 * Body: { domain: string }
 * Returns: { domain, clean: boolean, blacklisted: boolean, blacklists: string[] }
 *
 * Hard lesson #43 (2026-04-10): Previously stubbed to return clean:true for every
 * domain. That allowed a Spamhaus-listed domain (krogeradcollective.info) to pass
 * the wizard launch guard in Test #11. Now does real DNS lookups via the shared
 * domain-blacklist helper.
 */
export async function POST(req: Request) {
  try {
    const { orgId } = await auth();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 30 requests/minute per org
    if (!checkRateLimit(`check-domain:${orgId}`, 30, 60_000)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 30 checks per minute." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { domain } = body;

    if (!domain || typeof domain !== "string") {
      return NextResponse.json(
        { error: "domain is required" },
        { status: 400 }
      );
    }

    // Sanitize domain
    const cleanDomain = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(cleanDomain)) {
      return NextResponse.json(
        { error: "Invalid domain format" },
        { status: 400 }
      );
    }

    const result = await checkDomainBlacklists(cleanDomain);

    return NextResponse.json({
      domain: result.domain,
      clean: result.clean,
      blacklisted: !result.clean,
      blacklists: result.blacklists,
      ...(result.errors.length > 0 ? { errors: result.errors } : {}),
    });
  } catch (err) {
    console.error("[check-domain] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
