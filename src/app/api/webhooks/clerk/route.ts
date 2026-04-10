import { Webhook } from "svix";
import { headers } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ClerkEventType =
  | "organization.created"
  | "organization.updated"
  | "organization.deleted";

interface ClerkOrgEvent {
  type: ClerkEventType;
  data: {
    id: string;
    name?: string;
    slug?: string;
    [key: string]: unknown;
  };
}

/**
 * Best-effort system_alerts write for webhook failures.
 * Never throws — webhook handlers must still return a response even if the
 * alert insert fails. Alerts are viewed via the Admin panel.
 */
async function recordWebhookAlert(
  adminClient: SupabaseClient,
  params: {
    severity: "error" | "warning" | "info";
    source: string;
    message: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await adminClient.from("system_alerts").insert({
      severity: params.severity,
      source: params.source,
      message: params.message,
      details: params.details || {},
    });
  } catch (alertErr) {
    // swallow — we can't recover from an alert table failure mid-webhook
    console.error("[Clerk Webhook] Failed to write system_alerts row:", alertErr);
  }
}

/**
 * Clerk webhook handler that syncs organization events to Supabase.
 * Uses Svix to verify webhook signature.
 * Admin client (service role) bypasses RLS.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  const headersList = await headers();
  const svixHeaders = {
    "svix-id": headersList.get("svix-id") || "",
    "svix-timestamp": headersList.get("svix-timestamp") || "",
    "svix-signature": headersList.get("svix-signature") || "",
  };

  const body = await req.text();
  const webhook = new Webhook(webhookSecret);

  // Use untyped admin client to avoid strict insert type issues
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let evt: ClerkOrgEvent;
  try {
    evt = webhook.verify(body, svixHeaders) as ClerkOrgEvent;
  } catch (err) {
    console.error("Webhook verification failed:", err);
    await recordWebhookAlert(adminClient, {
      severity: "error",
      source: "clerk_webhook",
      message: "Svix signature verification failed",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return new Response("Webhook verification failed", { status: 401 });
  }

  const orgId = evt.data.id;
  const orgName = evt.data.name || evt.data.slug || `Organization ${orgId}`;

  try {
    switch (evt.type) {
      case "organization.created": {
        // Explicit plan_tier='starter' makes the default visible at the
        // call site rather than relying on the DB default from migration 001.
        // New orgs have no stripe_subscription_id, so the billing gate in
        // POST /api/provisioning will block them with HTTP 402 until they
        // subscribe (or an admin flips them to plan_tier='comped').
        const { error } = await adminClient.from("organizations").insert({
          id: orgId,
          clerk_org_id: orgId,
          name: orgName,
          plan_tier: "starter",
        });
        if (error) throw error;
        console.log(`[Clerk Webhook] Organization created: ${orgId}`);
        break;
      }

      case "organization.updated": {
        const { error } = await adminClient
          .from("organizations")
          .update({ name: orgName })
          .eq("clerk_org_id", orgId);
        if (error) throw error;
        console.log(`[Clerk Webhook] Organization updated: ${orgId}`);
        break;
      }

      case "organization.deleted": {
        const { error } = await adminClient
          .from("organizations")
          .delete()
          .eq("clerk_org_id", orgId);
        if (error) throw error;
        console.log(`[Clerk Webhook] Organization deleted: ${orgId}`);
        break;
      }

      default:
        console.warn(`[Clerk Webhook] Unhandled event type: ${evt.type}`);
    }
  } catch (err) {
    console.error(`[Clerk Webhook] Database error for ${evt.type}:`, err);
    await recordWebhookAlert(adminClient, {
      severity: "error",
      source: "clerk_webhook",
      message: `Database error handling ${evt.type}`,
      details: {
        event_type: evt.type,
        clerk_org_id: orgId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return new Response("Database error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
