import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const dynamic = 'force-dynamic';

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

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  try {
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
