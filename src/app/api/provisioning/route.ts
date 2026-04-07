import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
 * GET /api/provisioning — List provisioning jobs for org
 */
export async function GET() {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
      .from("provisioning_jobs")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/provisioning — Start a new provisioning job
 * Body: {
 *   vps_provider_id, dns_registrar_id, ns_domain,
 *   sending_domains[], mail_accounts_per_domain,
 *   mail_account_style, admin_email, config
 * }
 */
export async function POST(req: Request) {
  try {
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      vps_provider_id,
      dns_registrar_id,
      ns_domain,
      sending_domains,
      mail_accounts_per_domain,
      mail_account_style,
      admin_email,
      config,
    } = body;

    // Validation
    if (!vps_provider_id || !dns_registrar_id || !ns_domain) {
      return NextResponse.json(
        {
          error:
            "vps_provider_id, dns_registrar_id, and ns_domain are required",
        },
        { status: 400 }
      );
    }

    if (
      !sending_domains ||
      !Array.isArray(sending_domains) ||
      sending_domains.length === 0
    ) {
      return NextResponse.json(
        { error: "sending_domains must be a non-empty array" },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();

    // Verify provider and registrar belong to this org
    const { data: vpsProvider } = await supabase
      .from("vps_providers")
      .select("id")
      .eq("id", vps_provider_id)
      .eq("org_id", orgId)
      .single();

    const { data: dnsReg } = await supabase
      .from("dns_registrars")
      .select("id")
      .eq("id", dns_registrar_id)
      .eq("org_id", orgId)
      .single();

    if (!vpsProvider || !dnsReg) {
      return NextResponse.json(
        { error: "VPS provider or DNS registrar not found for this organization" },
        { status: 404 }
      );
    }

    // Create provisioning job
    const { data: job, error: jobError } = await supabase
      .from("provisioning_jobs")
      .insert({
        org_id: orgId,
        vps_provider_id,
        dns_registrar_id,
        ns_domain,
        sending_domains,
        mail_accounts_per_domain: mail_accounts_per_domain || 3,
        mail_account_style: mail_account_style || "random_names",
        admin_email: admin_email || null,
        status: "pending",
        progress_pct: 0,
        config: config || {},
      })
      .select()
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { error: jobError?.message || "Failed to create job" },
        { status: 500 }
      );
    }

    // Create 8 provisioning step rows
    const stepTypes = [
      "create_vps",
      "set_ptr",
      "configure_registrar",
      "install_hestiacp",
      "setup_dns_zones",
      "setup_mail_domains",
      "security_hardening",
      "verification_gate",
    ] as const;

    for (let i = 0; i < stepTypes.length; i++) {
      await supabase.from("provisioning_steps").insert({
        job_id: job.id,
        step_type: stepTypes[i],
        step_order: i + 1,
        status: "pending",
        metadata: {},
      });
    }

    // Enqueue pg-boss job
    // Note: pg-boss enqueue happens via the worker's connection.
    // For the API side, we just mark the job as pending and the
    // worker polls for pending jobs, OR we use a direct pg-boss
    // send via admin client.
    // For now, store the job and let the worker pick it up.
    // The worker will query for pending provisioning_jobs on interval.
    //
    // Alternative: use Supabase edge function or direct pg-boss send.
    // We store a 'queued_at' timestamp so the worker knows to process it.
    await supabase
      .from("provisioning_jobs")
      .update({
        config: {
          ...(job.config || {}),
          queued_at: new Date().toISOString(),
        },
      })
      .eq("id", job.id);

    return NextResponse.json(
      { jobId: job.id, status: "pending" },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
