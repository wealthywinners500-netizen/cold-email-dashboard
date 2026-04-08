import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/provisioning/encryption";
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
    const { name, registrar_type, api_key, api_secret, config, is_default } = body;

    const supabase = await createAdminClient();

    const { data: existing } = await supabase
      .from("dns_registrars")
      .select("id")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (is_default) {
      await supabase
        .from("dns_registrars")
        .update({ is_default: false })
        .eq("org_id", orgId);
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updateData.name = name;
    if (registrar_type !== undefined) updateData.registrar_type = registrar_type;
    if (api_key !== undefined) updateData.api_key_encrypted = api_key ? encrypt(api_key) : null;
    if (api_secret !== undefined) updateData.api_secret_encrypted = api_secret ? encrypt(api_secret) : null;
    if (config !== undefined) updateData.config = config;
    if (is_default !== undefined) updateData.is_default = is_default;

    const { data, error } = await supabase
      .from("dns_registrars")
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

    const { count } = await supabase
      .from("provisioning_jobs")
      .select("id", { count: "exact", head: true })
      .eq("dns_registrar_id", id);

    if (count && count > 0) {
      return NextResponse.json(
        { error: "Cannot delete registrar that is referenced by provisioning jobs" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("dns_registrars")
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
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const supabase = await createAdminClient();

    const { data: registrar } = await supabase
      .from("dns_registrars")
      .select("*")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();

    if (!registrar) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Decrypt credentials and test the registrar connection
    const apiKey = registrar.api_key_encrypted
      ? decrypt(registrar.api_key_encrypted)
      : "";
    const apiSecret = registrar.api_secret_encrypted
      ? decrypt(registrar.api_secret_encrypted)
      : null;

    // dry_run registrar doesn't need real credentials
    if (registrar.registrar_type === "dry_run") {
      return NextResponse.json({
        ok: true,
        message: "Test Mode registrar is always available.",
      });
    }

    // Require API key for real registrars
    if (!apiKey) {
      return NextResponse.json({
        ok: false,
        message: "No API key configured. Add an API key first.",
      });
    }

    try {
      const { getDNSRegistrar } = await import(
        "@/lib/provisioning/provider-registry"
      );
      const registrarInstance = await getDNSRegistrar(
        registrar.registrar_type,
        { apiKey, apiSecret, ...((registrar.config as Record<string, unknown>) || {}) }
      );
      const result = await registrarInstance.testConnection();
      return NextResponse.json(result);
    } catch (testErr) {
      return NextResponse.json({
        ok: false,
        message:
          testErr instanceof Error
            ? testErr.message
            : "Registrar test failed with unknown error",
      });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
