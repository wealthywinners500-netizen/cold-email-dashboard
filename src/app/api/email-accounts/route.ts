export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { testConnection } from "@/lib/email/smtp-manager";

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
      .from("email_accounts")
      .select("*")
      .eq("org_id", orgId)
      .order("email", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Strip smtp_pass from response
    const sanitized = (data || []).map(({ smtp_pass, ...rest }) => rest);
    return NextResponse.json(sanitized);
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
    const { email, display_name, smtp_host, smtp_port, smtp_user, smtp_pass, daily_send_limit } = body;

    if (!email || !smtp_host || !smtp_user || !smtp_pass) {
      return NextResponse.json(
        { error: "Missing required fields: email, smtp_host, smtp_user, smtp_pass" },
        { status: 400 }
      );
    }

    // Test SMTP connection before saving
    const test = await testConnection(
      smtp_host,
      smtp_port || 587,
      body.smtp_secure || false,
      smtp_user,
      smtp_pass
    );

    if (!test.success) {
      return NextResponse.json(
        { error: `SMTP connection failed: ${test.error}` },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("email_accounts")
      .insert([{
        org_id: orgId,
        email,
        display_name: display_name || null,
        smtp_host,
        smtp_port: smtp_port || 587,
        smtp_secure: body.smtp_secure || false,
        smtp_user,
        smtp_pass,
        daily_send_limit: daily_send_limit || 50,
      }])
      .select();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Email account already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Strip smtp_pass from response
    const { smtp_pass: _, ...sanitized } = data![0];
    return NextResponse.json(sanitized, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
