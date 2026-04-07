import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { encrypt, maskSecret } from "@/lib/provisioning/encryption";
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

export async function GET() {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("dns_registrars")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const masked = (data || []).map((r: Record<string, unknown>) => ({
      ...r,
      api_key_encrypted: r.api_key_encrypted ? maskSecret(String(r.api_key_encrypted)) : null,
      api_secret_encrypted: r.api_secret_encrypted ? maskSecret(String(r.api_secret_encrypted)) : null,
    }));

    return NextResponse.json(masked);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, registrar_type, api_key, api_secret, config, is_default } = body;

    if (!name || !registrar_type) {
      return NextResponse.json(
        { error: "name and registrar_type are required" },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();

    if (is_default) {
      await supabase
        .from("dns_registrars")
        .update({ is_default: false })
        .eq("org_id", orgId);
    }

    const { data, error } = await supabase
      .from("dns_registrars")
      .insert([
        {
          org_id: orgId,
          name,
          registrar_type,
          api_key_encrypted: api_key ? encrypt(api_key) : null,
          api_secret_encrypted: api_secret ? encrypt(api_secret) : null,
          config: config || {},
          is_default: is_default || false,
        },
      ])
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data[0], { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
