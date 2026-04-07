import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/provisioning/encryption";
import { NextResponse } from "next/server";

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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, provider_type, api_key, api_secret, config, is_default } = body;

    const supabase = await createAdminClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("vps_providers")
      .select("id")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // If setting as default, unset other defaults first
    if (is_default) {
      await supabase
        .from("vps_providers")
        .update({ is_default: false })
        .eq("org_id", orgId);
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updateData.name = name;
    if (provider_type !== undefined) updateData.provider_type = provider_type;
    if (api_key !== undefined) updateData.api_key_encrypted = api_key ? encrypt(api_key) : null;
    if (api_secret !== undefined) updateData.api_secret_encrypted = api_secret ? encrypt(api_secret) : null;
    if (config !== undefined) updateData.config = config;
    if (is_default !== undefined) updateData.is_default = is_default;

    const { data, error } = await supabase
      .from("vps_providers")
      .update(updateData)
      .eq("id", id)
      .eq("org_id", orgId)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data[0]);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
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

    // Check if provider is referenced by any provisioning jobs
    const { count } = await supabase
      .from("provisioning_jobs")
      .select("id", { count: "exact", head: true })
      .eq("vps_provider_id", id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: "Cannot delete provider that is referenced by provisioning jobs" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("vps_providers")
      .delete()
      .eq("id", id)
      .eq("org_id", orgId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // POST /api/vps-providers/[id] — test connection
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = await createAdminClient();

    const { data: provider } = await supabase
      .from("vps_providers")
      .select("*")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();

    if (!provider) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // For now, return a placeholder — actual provider implementations come in B15-2
    return NextResponse.json({
      ok: false,
      message: `Provider "${provider.provider_type}" test not yet implemented. Coming in B15 Phase 2.`,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
