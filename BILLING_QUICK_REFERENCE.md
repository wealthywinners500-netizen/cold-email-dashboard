# B6.5 Billing System — Quick Reference

## 9 Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/api/billing/checkout/route.ts` | 112 | Initiate checkout session |
| `src/app/api/billing/portal/route.ts` | 47 | Access Stripe Billing Portal |
| `src/app/api/webhooks/stripe/route.ts` | 170 | Handle Stripe webhooks |
| `src/app/pricing/page.tsx` | 198 | Pricing page with checkout buttons |
| `src/app/dashboard/settings/billing-button.tsx` | 61 | Billing portal button + toast |
| `next.config.ts` | 19 | Security headers |
| `src/app/global-error.tsx` | 26 | Global error boundary |
| `supabase/migrations/002_billing_columns.sql` | 2 | Add stripe_subscription_id column |
| `src/app/dashboard/settings/page.tsx` | 240 | Updated with BillingButton |

**Total: 875 lines of new/updated code**

---

## Environment Variables Required

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
NEXT_PUBLIC_APP_URL=https://...
```

---

## API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/billing/checkout` | POST | Clerk | Create checkout session |
| `/api/billing/portal` | POST | Clerk | Access billing portal |
| `/api/webhooks/stripe` | POST | None | Handle Stripe webhooks |

---

## Webhook Events

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Update plan_tier, stripe_customer_id, stripe_subscription_id |
| `customer.subscription.updated` | Update plan_tier if changed |
| `customer.subscription.deleted` | Reset plan_tier to 'starter' |
| `invoice.payment_failed` | Log error |

---

## Database Schema

```typescript
organizations {
  id: string
  clerk_org_id: string
  name: string
  plan_tier: 'starter' | 'pro' | 'enterprise'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
}
```

---

## User Flows

### Subscribe to Plan
1. Pricing page → Click "Get Started"
2. POST /api/billing/checkout { plan: 'starter' }
3. Redirect to Stripe checkout
4. Complete payment
5. Redirect to /dashboard?billing=success
6. Webhook updates plan_tier

### Manage Subscription
1. Settings page → Click "Manage Billing"
2. POST /api/billing/portal
3. Redirect to Stripe Portal
4. Change payment, upgrade/downgrade, cancel
5. Webhook updates database

### Cancel Subscription
1. User cancels in Stripe Portal
2. Webhook fired: customer.subscription.deleted
3. plan_tier reset to 'starter'
4. User retains access with Starter limits

---

## Security Features

- Stripe Secret Key server-side only
- Webhook signature verification
- Clerk auth on checkout/portal endpoints
- Org isolation via metadata
- No implicit any types (strict TypeScript)
- Security headers on all routes

---

## Testing Quick Checklist

- [ ] Env vars set
- [ ] Stripe products/prices created
- [ ] Webhook endpoint configured
- [ ] Database migration run
- [ ] Pricing page checkout works
- [ ] Settings page billing button works
- [ ] Webhooks received and processed
- [ ] Database updated on subscription
- [ ] Plan changes reflected in settings

---

## Deployment Steps

1. Set env vars in hosting platform
2. Create Stripe products & prices
3. Add webhook endpoint to Stripe
4. Run database migration
5. Deploy Next.js app
6. Test with Stripe test mode
7. Switch to live mode in Stripe

---

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| "Unauthorized" on /api/billing/checkout | User must be logged in via Clerk |
| "Stripe customer not found" on portal | User hasn't completed checkout yet |
| Webhook not processing | Check webhook secret, event types, endpoint URL |
| "Invalid plan" error | Request must have plan: 'starter' or 'pro' |
| Price ID not found | Env vars STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID not set |

---

## Files Not Changed

✓ No existing dashboard pages modified (servers, campaigns, leads, follow-ups, sms, overview, admin)
✓ No onboarding wizard modified
✓ Middleware already has /api/webhooks as public route
✓ Sentry not imported (will add later)

---

## Type Safety

All files use TypeScript strict mode with no implicit any.

Key types:
- `Stripe.Event` for webhook events
- `Stripe.Checkout.Session` for checkout
- `NextRequest` / `NextResponse` for API routes
- Proper org/plan/subscription type definitions

---

