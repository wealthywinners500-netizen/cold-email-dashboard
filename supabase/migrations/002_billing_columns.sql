ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
-- stripe_customer_id column already exists in original schema
