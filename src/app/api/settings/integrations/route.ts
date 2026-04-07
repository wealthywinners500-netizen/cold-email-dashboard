import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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

function maskApiKey(key: string | undefined | null): string {
  if (!key) return "not configured";
  if (key.length <= 4) return "*".repeat(key.length);
  return "*".repeat(key.length - 4) + key.slice(-4);
}

export async function GET(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const supabase = await createAdminClient();
    const { data: org, error } = await supabase
      .from("organizations")
      .select("integrations")
      .eq("id", orgId)
      .single();

    if (error || !org) {
      return NextResponse.json(
        { error: "Failed to fetch integrations" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const integrations = org.integrations || {};
    const masked = {
      outscraper_api_key: maskApiKey(integrations.outscraper_api_key),
      reoon_api_key: maskApiKey(integrations.reoon_api_key),
      // Include other integration keys with masking if they exist
      ...(integrations.sendgrid_api_key && {
        sendgrid_api_key: maskApiKey(integrations.sendgrid_api_key),
      }),
      ...(integrations.snovia_api_key && {
        snovia_api_key: maskApiKey(integrations.snovia_api_key),
      }),
    };

    return NextResponse.json(masked, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching integrations:", error);
    return NextResponse.json(
      { error: "Failed to fetch integrations" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await request.json();
    const { outscraper_api_key, reoon_api_key } = body;

    const supabase = await createAdminClient();

    // Get existing integrations
    const { data: org, error: fetchError } = await supabase
      .from("organizations")
      .select("integrations")
      .eq("id", orgId)
      .single();

    if (fetchError || !org) {
      return NextResponse.json(
        { error: "Failed to fetch organization" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const existingIntegrations = org.integrations || {};

    // Merge with existing integrations
    const updatedIntegrations = {
      ...existingIntegrations,
      ...(outscraper_api_key && { outscraper_api_key }),
      ...(reoon_api_key && { reoon_api_key }),
    };

    // Check if we need to test an API key
    const testParam = request.nextUrl.searchParams.get("test");
    let testResult = null;

    if (testParam === "outscraper" && outscraper_api_key) {
      try {
        const { testApiKey: testOutscraperKey } = await import(
          "@/lib/leads/outscraper-service"
        );
        testResult = await testOutscraperKey(outscraper_api_key);
      } catch (error) {
        console.error("Error testing Outscraper key:", error);
        testResult = { success: false };
      }
    } else if (testParam === "reoon" && reoon_api_key) {
      try {
        const { testApiKey: testReoonKey } = await import(
          "@/lib/leads/verification-service"
        );
        testResult = await testReoonKey(reoon_api_key);
      } catch (error) {
        console.error("Error testing Reoon key:", error);
        testResult = { success: false };
      }
    }

    // Update organization
    const { data: updated, error: updateError } = await supabase
      .from("organizations")
      .update({ integrations: updatedIntegrations })
      .eq("id", orgId)
      .select("integrations")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to update integrations" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const masked = {
      outscraper_api_key: maskApiKey(updated.integrations.outscraper_api_key),
      reoon_api_key: maskApiKey(updated.integrations.reoon_api_key),
      ...(testResult && { test: testResult }),
    };

    return NextResponse.json(masked, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error updating integrations:", error);
    return NextResponse.json(
      { error: "Failed to update integrations" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
