import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function POST(request: NextRequest) {
  try {
    const stripe = getStripe();
    const { orgId } = await auth();
    const supabase = await createAdminClient();
    return NextResponse.json({
      ok: true,
      hasStripe: !!stripe,
      orgId: orgId || 'none',
      hasSupabase: !!supabase,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
