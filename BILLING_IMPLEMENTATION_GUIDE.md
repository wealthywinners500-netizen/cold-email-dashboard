# B6.5 Billing System — Implementation Guide

## Overview
Complete end-to-end Stripe billing integration for the cold-email dashboard. Supports Starter ($29/mo) and Pro ($79/mo) plans with 14-day trials, full Billing Portal access, and webhook-driven plan management.

## Files Created

### 1. API Endpoints

#### POST `/api/billing/checkout`
**Purpose:** Initiate subscription checkout

**Request:**
```json
{
  "plan": "starter" | "pro"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

**Flow:**
1. Validates plan parameter
2. Looks up org in Supabase by Clerk orgId
3. Gets or creates Stripe customer
4. Updates org with stripe_customer_id
5. Creates Checkout Session with:
   - mode: 'subscription'
   - 14-day trial
   - success_url: /dashboard?billing=success
   - cancel_url: /pricing
6. Returns checkout URL

**Environment vars needed:**
- STRIPE_SECRET_KEY
- STRIPE_STARTER_PRICE_ID (price_xxx)
- STRIPE_PRO_PRICE_ID (price_xxx)
- NEXT_PUBLIC_APP_URL

---

#### POST `/api/billing/portal`
**Purpose:** Access Stripe Billing Portal for plan management

**Request:** None (uses Clerk auth context)

**Response:**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

**Flow:**
1. Gets Clerk orgId from auth
2. Fetches org's stripe_customer_id from Supabase
3. Creates Billing Portal session
4. Returns portal URL (return_url points to /dashboard/settings)

**Notes:**
- Returns 404 if customer not found
- User must have active subscription (from checkout first)

---

#### POST `/api/webhooks/stripe`
**Purpose:** Handle Stripe webhook events (public endpoint)

**Events handled:**

**checkout.session.completed**
- Triggered: After successful payment during checkout
- Action: Update organizations table with:
  - plan_tier: 'starter' or 'pro' (determined from price ID)
  - stripe_customer_id: Customer ID from session
  - stripe_subscription_id: New subscription ID
- Metadata used: metadata.org_id to find the org

**customer.subscription.updated**
- Triggered: When subscription is modified (plan change, etc.)
- Action: Update organizations.plan_tier if price ID differs
- Metadata used: metadata.org_id

**customer.subscription.deleted**
- Triggered: When subscription is canceled
- Action: Reset organizations.plan_tier to 'starter'
- Metadata used: metadata.org_id

**invoice.payment_failed**
- Triggered: When payment fails
- Action: Log error to console with customer and subscription IDs

**Verification:**
- Uses Stripe secret to verify webhook signature
- export const dynamic = 'force-dynamic' for real-time processing

---

### 2. Client Components

#### BillingButton Component
File: `src/app/dashboard/settings/billing-button.tsx`

**Features:**
- Calls /api/billing/portal on click
- Shows loading state
- Detects ?billing=success query param (from checkout success redirect)
- Displays green success toast for 3 seconds
- Auto-removes query param

**Usage in settings page:**
```tsx
import { BillingButton } from './billing-button';

<div>
  <BillingButton />
</div>
```

---

#### Pricing Page
File: `src/app/pricing/page.tsx`

**Changes:**
- Converted to 'use client' (was server component)
- Starter/Pro buttons now POST to /api/billing/checkout
- Pass plan: 'starter' | 'pro' in request body
- Buttons show loading state during checkout
- Enterprise button remains mailto link
- Visual layout 100% unchanged

**Flow:**
1. User clicks "Get Started"
2. Button is disabled, shows "Loading..."
3. Fetches /api/billing/checkout with plan
4. Redirects to Stripe checkout URL
5. Stripe handles payment flow
6. Success: redirects to /dashboard?billing=success

---

### 3. Configuration

#### Security Headers (next.config.ts)
```typescript
X-Frame-Options: DENY           // Prevent clickjacking
X-Content-Type-Options: nosniff // Prevent MIME sniffing
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

#### Global Error Handler (src/app/global-error.tsx)
- Catches unhandled errors in the app
- Logs to console
- Shows user-friendly error message
- Provides "Try again" button

---

### 4. Database

#### Migration: 002_billing_columns.sql
```sql
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
```

**Note:** stripe_customer_id already exists in original schema

**Schema:**
```typescript
organizations {
  id: string
  clerk_org_id: string
  name: string
  plan_tier: string    // 'starter' | 'pro' | 'enterprise'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
}
```

---

## Setup Instructions

### 1. Environment Variables
Add to your `.env.local` or hosting platform:

```env
# Stripe keys
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Price IDs (from Stripe Dashboard)
STRIPE_STARTER_PRICE_ID=price_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx

# App URL (for redirect after checkout)
NEXT_PUBLIC_APP_URL=http://localhost:3000  # dev
# or
NEXT_PUBLIC_APP_URL=https://yourdomain.com  # prod
```

### 2. Create Stripe Products & Prices
In Stripe Dashboard:

1. Create Product "Starter Plan"
   - Price: $29/month, recurring
   - Copy price ID to STRIPE_STARTER_PRICE_ID

2. Create Product "Pro Plan"
   - Price: $79/month, recurring
   - Copy price ID to STRIPE_PRO_PRICE_ID

### 3. Configure Webhook
In Stripe Dashboard → Developers → Webhooks:

1. Add endpoint: `https://yourdomain.com/api/webhooks/stripe`
2. Events to listen:
   - checkout.session.completed
   - customer.subscription.updated
   - customer.subscription.deleted
   - invoice.payment_failed
3. Copy signing secret to STRIPE_WEBHOOK_SECRET

### 4. Run Database Migration
```bash
npx supabase migration up
```

This adds stripe_subscription_id column to organizations table.

### 5. Test Locally (optional)
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Use test cards
# Visa: 4242 4242 4242 4242
# Any future expiry and any CVC
```

---

## Data Flow

### Happy Path: New Subscription
```
User clicks "Get Started"
  ↓
Pricing page → fetch /api/billing/checkout (plan: 'starter')
  ↓
Checkout route → Get org → Get/create Stripe customer
  ↓
Create checkout session with trial (14 days)
  ↓
Redirect to Stripe checkout URL
  ↓
User enters card, completes payment
  ↓
Stripe creates subscription
  ↓
Stripe sends checkout.session.completed webhook
  ↓
Webhook handler → Update org:
  - plan_tier = 'starter'
  - stripe_customer_id = cus_xxx
  - stripe_subscription_id = sub_xxx
  ↓
Stripe redirects to /dashboard?billing=success
  ↓
User sees success toast for 3 seconds
```

### Plan Change Flow
```
User in Stripe Portal changes plan (Pro)
  ↓
Stripe sends customer.subscription.updated webhook
  ↓
Webhook handler:
  - Gets price ID from subscription
  - Maps to plan_tier ('pro')
  - Updates organizations.plan_tier = 'pro'
  ↓
User's dashboard reflects Pro limits immediately
```

### Cancellation Flow
```
User cancels subscription in Portal
  ↓
Stripe sends customer.subscription.deleted webhook
  ↓
Webhook handler → Update org:
  - plan_tier = 'starter' (free tier fallback)
  ↓
User can still access app with Starter limits
```

---

## Testing Checklist

### Checkout Flow
- [ ] Click "Get Started" on pricing page
- [ ] Loader shows while creating session
- [ ] Redirects to Stripe checkout
- [ ] Can enter test card: 4242 4242 4242 4242
- [ ] After payment, redirects to /dashboard?billing=success
- [ ] Success toast appears and disappears after 3 seconds
- [ ] Database updated: stripe_customer_id, stripe_subscription_id, plan_tier='starter'

### Billing Portal
- [ ] Click "Manage Billing" in settings
- [ ] Redirects to Stripe Billing Portal
- [ ] Can change payment method
- [ ] Can upgrade/downgrade plan
- [ ] After changes, webhook fires and dashboard updates

### Webhook Events
- [ ] checkout.session.completed: Creates subscription, updates plan_tier
- [ ] customer.subscription.updated: Changes plan_tier if plan changed
- [ ] customer.subscription.deleted: Resets plan_tier to 'starter'
- [ ] invoice.payment_failed: Logs error (check console)

### Error Handling
- [ ] /api/billing/checkout with no orgId: 401 Unauthorized
- [ ] /api/billing/checkout with invalid plan: 400 Bad Request
- [ ] /api/billing/portal with no stripe_customer_id: 404 Not Found
- [ ] Webhook with invalid signature: 400 Bad Request

### Settings Page
- [ ] Current Plan badge shows correct tier
- [ ] Plan Limits show correct values for tier
- [ ] "Manage Billing" button is functional
- [ ] Button disabled while loading

### Pricing Page
- [ ] Starter/Pro buttons functional
- [ ] Enterprise button links to mailto
- [ ] Loading state shows on buttons
- [ ] Visual layout unchanged

---

## Troubleshooting

### "Stripe customer not found" error on billing portal
**Cause:** User hasn't completed a checkout yet
**Solution:** Direct user to pricing page first

### Webhook not processing
**Check:**
1. Webhook endpoint accessible from internet
2. Webhook secret correct in env vars
3. Events enabled in Stripe Dashboard
4. Check Stripe Dashboard → Webhooks → Recent deliveries for errors

### Subscription not showing in database
**Check:**
1. Webhook processing (check server logs)
2. org_id in metadata matches Supabase org.id
3. Price ID mapping correct (STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID)

### Trial not applying
**In Stripe Dashboard:**
1. Go to Products → [Plan]
2. Ensure "Default trial period" is set to 14 days
3. Or explicitly set in checkout session (already done in code)

---

## Security Notes

- Stripe Secret Key never exposed to client
- Webhook signature verified before processing
- Clerk auth required for checkout/portal endpoints
- Stripe subscription linked to org via metadata
- Price IDs validated before use
- All database updates use org_id for safety

---

## Next Steps (Optional)

1. **Email Notifications:** Send confirmation emails on subscription/cancellation
2. **Dunning Management:** Handle failed payment retry logic
3. **Usage Tracking:** Implement metered billing if needed
4. **Seat Licensing:** Enforce max users per plan
5. **Invoice History:** Show user invoices from Stripe Portal
6. **Plan Downgrade:** Add confirmation before downgrading plan

