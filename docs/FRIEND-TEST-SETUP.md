# How to Set Up a Friend to Test StealthMail

## Quick Start

1. Send them this link: **https://cold-email-dashboard.vercel.app/sign-up**
2. They create an account with their email
3. They create an organization (the onboarding wizard will guide them)
4. They'll see the onboarding flow which walks them through:
   - Creating their organization
   - Adding their first server pair
   - Getting started with the dashboard

## What They Can Do

Once set up, they can:
- Add test server pairs
- Create test campaigns
- Import test leads
- View follow-up threads
- Explore SMS workflow configuration
- Manage organization settings

## Data Isolation

Their data is **completely isolated** from yours. Multi-tenant isolation is enforced at the database level:
- Every query filters by org_id
- Supabase Row Level Security (RLS) policies enforce isolation
- They cannot see your data, you cannot see theirs

## Pre-Seeding Sample Data (Optional)

To give them a head start with sample data, run:

```bash
npx tsx src/seed/seed-new-org.ts <their-clerk-org-id> "Friend's Company"
```

### How to find their Clerk org ID:
1. Go to https://dashboard.clerk.com
2. Navigate to Organizations
3. Find their organization
4. Copy the org ID (starts with `org_`)

### What gets seeded:
- 1 sample server pair
- 1 sample campaign
- 2 sample lead batches
- 2 sample follow-ups
- 1 sample SMS workflow

## Pricing Tiers

New accounts default to the **Starter** plan:
- Up to 3 server pairs
- 1 user account
- Basic dashboard access

To upgrade them for testing, update their `plan_tier` in Supabase:
```sql
UPDATE organizations SET plan_tier = 'pro' WHERE clerk_org_id = '<their-org-id>';
```

## Troubleshooting

### "No organization selected"
They need to create an organization first. The onboarding wizard should guide them through this.

### Empty dashboard
Normal for new users — the onboarding wizard will appear. If they skip it, all pages have friendly empty states with action buttons.

### Can't create server pairs
Check their plan tier — Starter is limited to 3 pairs.

## Environment

- **Live URL:** https://cold-email-dashboard.vercel.app
- **Auth:** Clerk (dev instance)
- **Database:** Supabase (with RLS)
- **Hosting:** Vercel (auto-deploys from main branch)
