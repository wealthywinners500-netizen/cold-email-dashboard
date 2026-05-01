export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { initializeSequence } from "@/lib/email/sequence-engine";
import { initBoss } from "@/lib/email/campaign-queue";
import { NextResponse } from "next/server";
import {
  validatePrimarySequenceContent,
  buildSendResponse,
} from "./route-helpers";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    const orgId = await getInternalOrgId();
    if (!orgId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createAdminClient();

    // Fetch campaign
    const { data: campaign, error: campaignErr } = await supabase
      .from("campaigns")
      .select("id, status, subject_lines")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();

    if (campaignErr || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const errors: string[] = [];

    // Pending recipient count
    const { count: recipientCount } = await supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    if (!recipientCount || recipientCount === 0) {
      errors.push("No pending recipients found");
    }

    // Subject lines
    if (
      !campaign.subject_lines ||
      !Array.isArray(campaign.subject_lines) ||
      campaign.subject_lines.length === 0
    ) {
      errors.push("No subject lines configured");
    }

    // Primary sequence + body content (replaces the legacy
    // `campaigns.body_html` check — body content now lives in
    // campaign_sequences.steps[N].body_html / .ab_variants[V].body_html).
    const { data: primarySeq } = await supabase
      .from("campaign_sequences")
      .select("id, steps")
      .eq("campaign_id", campaignId)
      .eq("sequence_type", "primary")
      .eq("status", "active")
      .maybeSingle();

    if (!primarySeq) {
      errors.push("No active primary sequence configured");
    } else {
      const v = validatePrimarySequenceContent(primarySeq.steps);
      if (!v.ok) errors.push(v.reason!);
    }

    // Active email accounts
    const { count: accountCount } = await supabase
      .from("email_accounts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "active");

    if (!accountCount || accountCount === 0) {
      errors.push("No active email accounts available");
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", details: errors },
        { status: 400 }
      );
    }

    // Idempotency: if state rows already exist for this campaign, skip
    // initializeSequence and just re-affirm campaigns.status='sending'.
    // The UNIQUE(recipient_id, campaign_id, sequence_id) constraint at
    // mig 004:45 makes a re-init's `.insert` throw on collision, so the
    // pre-check is the explicit, debuggable guard.
    const { count: existingStateCount } = await supabase
      .from("lead_sequence_state")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    if (existingStateCount && existingStateCount > 0) {
      await supabase
        .from("campaigns")
        .update({ status: "sending" })
        .eq("id", campaignId);

      return NextResponse.json(
        buildSendResponse({
          alreadyInitialized: true,
          existingStateCount,
          recipientCount: recipientCount ?? undefined,
          accountCount: accountCount ?? undefined,
        })
      );
    }

    // TODO(CC-#5+): for >1k-recipient campaigns the synchronous
    // initializeSequence call here can exceed Vercel's 60s default function
    // timeout (one await per recipient × ~50ms each). Move to an async
    // pgboss `init-campaign` job and return 202 immediately when Dean
    // begins running real-volume launches. CC #4's smoke uses 1 recipient,
    // far under any limit.
    // pg-boss must be started before initializeSequence's internal boss.send.
    // Pattern matches src/app/api/pairs/[id]/verify/route.ts:85 and
    // src/app/api/admin/dbl-monitor/run/route.ts:80 — initBoss is idempotent
    // (boss.start() resolves immediately if already running) so each cold-
    // start serverless invocation safely re-runs it.
    await initBoss();

    let statesInitialized: number;
    try {
      statesInitialized = await initializeSequence(campaignId, orgId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: "Failed to initialize sequence", detail: message },
        { status: 500 }
      );
    }

    await supabase
      .from("campaigns")
      .update({
        status: "sending",
        started_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return NextResponse.json(
      buildSendResponse({
        statesInitialized,
        recipientCount: recipientCount ?? undefined,
        accountCount: accountCount ?? undefined,
      })
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
