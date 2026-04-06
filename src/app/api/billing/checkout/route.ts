import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { plan } = body;

    if (!plan || (plan !== 'starter' && plan !== 'pro')) {
      return NextResponse.json(
        { error: 'Invalid plan. Must be "starter" or "pro"' },
        { status: 400 }
      );
    }

    // Look up org in Supabase
    const supabase = await createAdminClient();

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, stripe_customer_id')
      .eq('clerk_org_id', orgId)
      .single();

    if (orgError || !org) {
      console.error('Organization lookup failed:', orgError);
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Map plan to price ID
    let priceId: string;
    if (plan === 'starter') {
      priceId = process.env.STRIPE_STARTER_PRICE_ID!;
    } else {
      priceId = process.env.STRIPE_PRO_PRICE_ID!;
    }

    if (!priceId) {
      console.error(`Missing price ID for plan: ${plan}`);
      return NextResponse.json(
        { error: 'Price configuration error' },
        { status: 500 }
      );
    }

    // Get or create Stripe customer
    let customerId = org.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: {
          org_id: org.id,
          clerk_org_id: orgId,
        },
      });
      customerId = customer.id;

      // Update org with customer ID
      await supabase
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', org.id);
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          org_id: org.id,
          clerk_org_id: orgId,
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?billing=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
      metadata: {
        org_id: org.id,
        clerk_org_id: orgId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
