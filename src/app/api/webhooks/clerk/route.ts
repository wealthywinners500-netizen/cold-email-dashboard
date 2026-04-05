import { Webhook } from "svix";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

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

  let evt: ClerkOrgEvent;
  try {
    evt = webhook.verify(body, svixHeaders) as ClerkOrgEvent;
  } catch (err) {
    console.error("Webhook verification failed:", err);
    return new Response("Webhook verification failed", { status: 401 });
  }

  // Use untyped admin client to avoid strict insert type issues
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const orgId = evt.data.id;
  const orgName = evt.data.name || evt.data.slug || `Organization ${orgId}`;

  try {
    switch (evt.type) {
      case "organization.created": {
        const { error } = await adminClient.from("organizations").insert({
          id: orgId,
          clerk_org_id: orgId,
          name: orgName,
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
    return new Response("Database error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
