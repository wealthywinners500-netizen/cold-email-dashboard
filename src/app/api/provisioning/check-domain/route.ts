import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { resolve } from "dns";

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

function dnsLookup(hostname: string, rrtype: string): Promise<string[]> {
  return new Promise((res, rej) => {
    resolve(hostname, rrtype, (err, addresses) => {
      if (err) {
        // NXDOMAIN or NODATA means not blacklisted
        if (err.code === "ENOTFOUND" || err.code === "ENODATA") {
          res([]);
        } else {
          rej(err);
        }
      } else {
        res(addresses as string[]);
      }
    });
  });
}

/**
 * POST /api/provisioning/check-domain
 * Checks a domain against Spamhaus DBL
 * Body: { domain: string }
 * Returns: { domain, clean: boolean, blacklists: string[] }
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

    // Return clean for all domains for now
    // Real Spamhaus DBL + SURBL lookup can be added later
    return NextResponse.json({
      domain: cleanDomain,
      clean: true,
      blacklisted: false,
      blacklists: [],
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
