# B6.5 Production Hardening — Billing System Build Complete

## Files Created (9 total)

### API Endpoints (3 files)

1. **src/app/api/billing/checkout/route.ts**
   - POST endpoint for creating Stripe Checkout Sessions
   - Accepts plan: 'starter' | 'pro'
   - Maps plan to price ID from env vars (STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID)
   - Gets/creates Stripe customer
   - Returns { url: session.url }
   - 14-day trial included
   - Metadata includes org_id and clerk_org_id

2. **src/app/api/billing/portal/route.ts**
   - POST endpoint for Stripe Billing Portal
   - Requires Clerk authentication
   - Gets stripe_customer_id from Supabase
   - Returns { url: session.url }
   - Return URL points to /dashboard/settings

3. **src/app/api/webhooks/stripe/route.ts**
   - POST endpoint (public, no auth)
   - Verifies Stripe webhook signature
   - Handles events:
     - checkout.session.completed: Update plan_tier, stripe_customer_id, stripe_subscription_id
     - customer.subscription.updated: Update plan_tier if changed
     - customer.subscription.deleted: Reset to 'starter'
     - invoice.payment_failed: Log error
   - Uses getPlanTierFromPriceId() helper to map price IDs to plan names
   - export const dynamic = 'force-dynamic'

### Client Components (2 files)

4. **src/app/dashboard/settings/billing-button.tsx**
   - 'use client' component
   - Handles "Manage Billing" button
   - Calls /api/billing/portal
   - Shows success toast if ?billing=success param
   - Auto-removes param after 3 seconds

5. **src/app/pricing/page.tsx**
   - Converted to 'use client' component
   - Starter/Pro buttons now call /api/billing/checkout with plan name
   - Enterprise CTA remains mailto link
   - Loading state on checkout buttons
   - Visual layout unchanged

### Configuration & Migration (3 files)

6. **next.config.ts**
   - Added security headers:
     - X-Frame-Options: DENY
     - X-Content-Type-Options: nosniff
     - Referrer-Policy: strict-origin-when-cross-origin
     - Permissions-Policy: camera=(), microphone=(), geolocation=()

7. **src/app/global-error.tsx**
   - 'use client' component
   - Logs global errors to console
   - Shows error message with "Try again" button

8. **supabase/migrations/002_billing_columns.sql**
   - Adds stripe_subscription_id column to organizations table
   - stripe_customer_id already existed

9. **src/app/dashboard/settings/page.tsx** (updated)
   - Imported BillingButton component
   - Replaced "Manage Billing" link with BillingButton
   - Button calls /api/billing/portal on click

## Environment Variables Required

Set in your production environment:

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

## Middleware

No changes needed — `/api/webhooks(.*)` already public in middleware.ts

## Type Safety

- All TypeScript strict mode
- Custom Stripe event types for webhook handler
- Proper error handling throughout
- No implicit any types

## Database Integration

- Uses createAdminClient from @/lib/supabase/server
- Queries organizations table for stripe_customer_id and plan_tier updates
- Metadata stored on Stripe objects for org association

## Flow Summary

### Subscription Purchase
1. User clicks "Get Started" on pricing page
2. POST /api/billing/checkout { plan: 'starter' | 'pro' }
3. Creates/gets Stripe customer, initiates checkout
4. Stripe redirects to checkout URL
5. User completes payment
6. Stripe sends checkout.session.completed webhook
7. Webhook updates organizations.plan_tier, stripe_customer_id, stripe_subscription_id

### Billing Management
1. User clicks "Manage Billing" in settings
2. POST /api/billing/portal
3. Fetches stripe_customer_id from Supabase
4. Creates Stripe Portal session
5. Redirects to Stripe Portal
6. User can manage subscription, update payment method, etc.

### Plan Changes
- customer.subscription.updated webhook handles tier changes
- customer.subscription.deleted webhook resets to starter

## Testing Checklist

- [ ] Clerk auth middleware working (POST endpoints should fail without auth)
- [ ] Stripe client initialized with SECRET_KEY
- [ ] Webhook signature verification with WEBHOOK_SECRET
- [ ] Environment variables loaded correctly
- [ ] Pricing page checkout buttons functional
- [ ] Settings page billing button functional
- [ ] Stripe test mode webhooks received and processed
- [ ] Database columns populated on subscription
- [ ] Plan tier updates reflected in settings page
