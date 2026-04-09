import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { getDNSRegistrar } from "@/lib/provisioning/provider-registry";
import { decrypt } from "@/lib/provisioning/encryption";
import type { DNSRegistrarRow, DomainInfo } from "@/lib/provisioning/types";

export const dynamic = "force-dynamic";

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
 * GET /api/dns-registrars/[id]/domains
 * Fetch all domains from the connected registrar, filtered for availability.
 * Query params:
 *   - refresh=true — bypass cache and force re-fetch
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: registrarId } = await params;
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    const supabase = await createAdminClient();

    // 1. Fetch registrar row by ID + org_id (multi-tenant isolation)
    const { data: registrar, error: regError } = await supabase
      .from("dns_registrars")
      .select("*")
      .eq("id", registrarId)
      .eq("org_id", orgId)
      .single();

    if (regError || !registrar) {
      return NextResponse.json(
        { error: "DNS registrar not found" },
        { status: 404 }
      );
    }

    const reg = registrar as DNSRegistrarRow;

    // 2. Check cache (1 hour TTL)
    const config = (reg.config || {}) as Record<string, unknown>;
    const domainCache = config.domainCache as
      | { domains: DomainInfo[]; fetchedAt: string }
      | undefined;

    if (!forceRefresh && domainCache?.fetchedAt && domainCache.domains) {
      const cacheAge = Date.now() - new Date(domainCache.fetchedAt).getTime();
      const ONE_HOUR = 60 * 60 * 1000;
      if (cacheAge < ONE_HOUR) {
        const domains = await filterUsedDomains(supabase, orgId, domainCache.domains);
        return NextResponse.json({
          domains,
          cached: true,
          fetchedAt: domainCache.fetchedAt,
          registrarName: reg.name,
          registrarType: reg.registrar_type,
        });
      }
    }

    // 3. Decrypt API keys and instantiate registrar
    let apiKey = "";
    let apiSecret: string | null = null;

    if (reg.api_key_encrypted) {
      try {
        apiKey = decrypt(reg.api_key_encrypted);
      } catch {
        return NextResponse.json(
          { error: "Failed to decrypt API key. Re-enter credentials." },
          { status: 500 }
        );
      }
    }

    if (reg.api_secret_encrypted) {
      try {
        apiSecret = decrypt(reg.api_secret_encrypted);
      } catch {
        return NextResponse.json(
          { error: "Failed to decrypt API secret. Re-enter credentials." },
          { status: 500 }
        );
      }
    }

    const registrarConfig = { ...config, apiKey, apiSecret };
    const registrarInstance = await getDNSRegistrar(reg.registrar_type, registrarConfig);

    // 4. Fetch domains from registrar
    let rawDomains: DomainInfo[];
    try {
      rawDomains = await registrarInstance.listDomains();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error fetching domains";
      return NextResponse.json(
        { error: `Failed to fetch domains: ${message}` },
        { status: 502 }
      );
    }

    // 5. Cache the result
    const now = new Date().toISOString();
    const updatedConfig = {
      ...config,
      domainCache: { domains: rawDomains, fetchedAt: now },
    };

    await supabase
      .from("dns_registrars")
      .update({ config: updatedConfig, updated_at: now })
      .eq("id", registrarId)
      .eq("org_id", orgId);

    // 6. Filter out used domains
    const domains = await filterUsedDomains(supabase, orgId, rawDomains);

    return NextResponse.json({
      domains,
      cached: false,
      fetchedAt: now,
      registrarName: reg.name,
      registrarType: reg.registrar_type,
    });
  } catch (err) {
    console.error("[dns-registrars/domains] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Cross-reference domains with the sending_domains table
 * to mark already-used domains.
 */
async function filterUsedDomains(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  orgId: string,
  domains: DomainInfo[]
): Promise<(DomainInfo & { inUse?: boolean })[]> {
  const { data: usedDomains } = await supabase
    .from("sending_domains")
    .select("domain_name")
    .eq("org_id", orgId);

  const usedSet = new Set(
    (usedDomains || []).map(
      (d: { domain_name: string }) => d.domain_name.toLowerCase()
    )
  );

  return domains.map((d) => {
    const inUse = usedSet.has(d.domain.toLowerCase());
    return {
      ...d,
      isAvailable: d.isAvailable && !inUse,
      ...(inUse ? { inUse: true } : {}),
    };
  });
}
