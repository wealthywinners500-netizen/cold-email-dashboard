import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Simple in-memory cache
const regionsCache = new Map<string, { data: unknown; expiresAt: number }>();

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("clerk_org_id", orgId)
    .single();
  return data?.id || null;
}

/**
 * GET /api/vps-providers/[id]/regions
 * Returns available regions for a VPS provider
 * Cached for 5 minutes
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const supabase = await createAdminClient();
    const { data: provider, error } = await supabase
      .from("vps_providers")
      .select("*")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();

    if (error || !provider) {
      return NextResponse.json(
        { error: "VPS provider not found" },
        { status: 404 }
      );
    }

    // Check cache
    const cacheKey = `regions:${id}`;
    const cached = regionsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.data);
    }

    // Return static regions based on provider type
    // In production, this would call the provider's API via the provider abstraction
    const regions = getStaticRegions(provider.provider_type);

    // Cache for 5 minutes
    regionsCache.set(cacheKey, {
      data: regions,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return NextResponse.json(regions);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function getStaticRegions(providerType: string) {
  switch (providerType) {
    case "clouding":
      return [
        { id: "es-bcn", name: "Barcelona, Spain", slug: "es-bcn", available: true },
      ];
    case "hetzner":
      return [
        { id: "fsn1", name: "Falkenstein, Germany", slug: "fsn1", available: true },
        { id: "nbg1", name: "Nuremberg, Germany", slug: "nbg1", available: true },
        { id: "hel1", name: "Helsinki, Finland", slug: "hel1", available: true },
        { id: "ash", name: "Ashburn, VA, USA", slug: "ash", available: true },
        { id: "hil", name: "Hillsboro, OR, USA", slug: "hil", available: true },
      ];
    case "linode":
      return [
        { id: "us-east", name: "Newark, NJ, USA", slug: "us-east", available: true },
        { id: "us-central", name: "Dallas, TX, USA", slug: "us-central", available: true },
        { id: "us-west", name: "Fremont, CA, USA", slug: "us-west", available: true },
        { id: "eu-west", name: "London, UK", slug: "eu-west", available: true },
        { id: "eu-central", name: "Frankfurt, Germany", slug: "eu-central", available: true },
      ];
    case "vultr":
      return [
        { id: "ewr", name: "New Jersey, USA", slug: "ewr", available: true },
        { id: "ord", name: "Chicago, USA", slug: "ord", available: true },
        { id: "dfw", name: "Dallas, USA", slug: "dfw", available: true },
        { id: "lax", name: "Los Angeles, USA", slug: "lax", available: true },
        { id: "ams", name: "Amsterdam, Netherlands", slug: "ams", available: true },
        { id: "fra", name: "Frankfurt, Germany", slug: "fra", available: true },
      ];
    case "digitalocean":
      return [
        { id: "nyc1", name: "New York 1", slug: "nyc1", available: true },
        { id: "nyc3", name: "New York 3", slug: "nyc3", available: true },
        { id: "sfo3", name: "San Francisco 3", slug: "sfo3", available: true },
        { id: "ams3", name: "Amsterdam 3", slug: "ams3", available: true },
        { id: "fra1", name: "Frankfurt 1", slug: "fra1", available: true },
      ];
    case "contabo":
      return [
        { id: "eu-de-1", name: "Nuremberg, Germany", slug: "eu-de-1", available: true },
        { id: "eu-de-2", name: "Munich, Germany", slug: "eu-de-2", available: true },
        { id: "us-central-1", name: "St. Louis, MO, USA", slug: "us-central-1", available: true },
        { id: "us-east-1", name: "New York, USA", slug: "us-east-1", available: true },
      ];
    default:
      return [
        { id: "default", name: "Default Region", slug: "default", available: true },
      ];
  }
}
