import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

type CheckoutSessionCompletedEvent = Stripe.Event & {
  data: {
    object: Stripe.Checkout.Session;
  };
};

type SubscriptionEvent = Stripe.Event & {
  data: {
    object: Stripe.Subscription;
  };
};

type InvoiceEvent = Stripe.Event & {
  data: {
    object: Stripe.Invoice;
  };
};

async function getPlanTierFromPriceId(priceId: string): Promise<string | null> {
  const starterPriceId = process.env.STRIPE_STARTER_PRICE_ID;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;

  if (priceId === starterPriceId) {
    return 'starter';
  } else if (priceId === proPriceId) {
    return 'pro';
  }

  return null;
}

// Admin-granted free tiers are never automatically changed by Stripe webhook
// events. A developer or comped account that somehow ends up with a Stripe
// subscription must be managed manually — we will NOT silently overwrite the
// admin intent. Returns true if the org's current plan_tier should be left
// alone regardless of what Stripe is telling us.
async function isAdminGrantedFreeTier(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  orgId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('organizations')
    .select('plan_tier')
    .eq('id', orgId)
    .single();
  const current = data?.plan_tier as string | undefined;
  return current === 'developer' || current === 'comped';
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const body = await request.text();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    const supabase = await createAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = (event as CheckoutSessionCompletedEvent).data.object;
        const orgId = session.metadata?.org_id;
        const clerkOrgId = session.metadata?.clerk_org_id;

        if (!orgId || !session.subscription) {
          console.error('Invalid checkout session metadata or missing subscription');
          break;
        }

        // Get subscription to find price ID
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );

        const item = subscription.items.data[0];
        if (!item || !item.price.id) {
          console.error('No price found in subscription');
          break;
        }

        const planTier = await getPlanTierFromPriceId(item.price.id);

        if (!planTier) {
          console.error(`Unknown price ID: ${item.price.id}`);
          break;
        }

        // Admin-granted free tier guard: if this org is 'developer' or 'comped',
        // refuse to silently overwrite the admin intent. A Stripe checkout
        // against a dev/comped account is almost certainly an accident; at
        // minimum we want to surface it in logs rather than flip the tier.
        if (await isAdminGrantedFreeTier(supabase, orgId)) {
          console.warn(
            `[stripe-webhook] Skipping checkout.session.completed plan_tier update for admin-granted free org ${orgId} (subscription ${session.subscription}). Clear plan_tier manually if this was intentional.`
          );
          // Still store the customer/subscription IDs so future webhooks can
          // correlate, but DO NOT touch plan_tier.
          await supabase
            .from('organizations')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
            })
            .eq('id', orgId);
          break;
        }

        // Update organization
        await supabase
          .from('organizations')
          .update({
            plan_tier: planTier,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .eq('id', orgId);

        console.log(
          `Updated org ${orgId} to plan: ${planTier}, subscription: ${session.subscription}`
        );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = (event as SubscriptionEvent).data.object;
        const orgId = subscription.metadata?.org_id;

        if (!orgId) {
          console.error('No org ID in subscription metadata');
          break;
        }

        const item = subscription.items.data[0];
        if (!item || !item.price.id) {
          console.error('No price found in subscription');
          break;
        }

        const planTier = await getPlanTierFromPriceId(item.price.id);

        if (!planTier) {
          console.error(`Unknown price ID: ${item.price.id}`);
          break;
        }

        // Admin-granted free tier guard: see checkout.session.completed above.
        if (await isAdminGrantedFreeTier(supabase, orgId)) {
          console.warn(
            `[stripe-webhook] Skipping customer.subscription.updated plan_tier update for admin-granted free org ${orgId}.`
          );
          break;
        }

        await supabase
          .from('organizations')
          .update({ plan_tier: planTier })
          .eq('id', orgId);

        console.log(`Updated org ${orgId} plan to: ${planTier}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = (event as SubscriptionEvent).data.object;
        const orgId = subscription.metadata?.org_id;

        if (!orgId) {
          console.error('No org ID in subscription metadata');
          break;
        }

        // Admin-granted free tier guard: NEVER downgrade a developer or comped
        // account just because a Stripe subscription somewhere was cancelled.
        // This is the most important guard of the three — without it, any
        // stray subscription.deleted event would silently blow away the admin
        // intent and quietly put Dean's founder account back on starter caps.
        if (await isAdminGrantedFreeTier(supabase, orgId)) {
          console.warn(
            `[stripe-webhook] Skipping customer.subscription.deleted reset for admin-granted free org ${orgId}. plan_tier left untouched.`
          );
          break;
        }

        // Reset to starter plan
        await supabase
          .from('organizations')
          .update({ plan_tier: 'starter' })
          .eq('id', orgId);

        console.log(`Reset org ${orgId} to starter plan after subscription deletion`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = (event as InvoiceEvent).data.object;
        const invoiceCustomer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? 'unknown';
        console.error(
          `Payment failed for customer ${invoiceCustomer}, invoice ${invoice.id}`
        );
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 400 }
    );
  }
}
