-- Migration 011: Patch provisioning_jobs account columns
-- Replaces hardcoded dean-specific defaults with SaaS-ready schema

-- Drop old column (had hardcoded ARRAY['dean', 'info', 'hello'] default)
ALTER TABLE provisioning_jobs DROP COLUMN IF EXISTS mail_account_pattern;

-- Drop old admin_email default (had hardcoded dean.hofer@thestealthmail.com)
ALTER TABLE provisioning_jobs ALTER COLUMN admin_email DROP DEFAULT;

-- Add new columns
ALTER TABLE provisioning_jobs
ADD COLUMN IF NOT EXISTS mail_accounts_per_domain SMALLINT DEFAULT 3,
ADD COLUMN IF NOT EXISTS mail_account_style TEXT DEFAULT 'random_names';

-- mail_accounts_per_domain: how many accounts per domain (default 3, range 1-5)
-- mail_account_style: 'random_names' (auto-generated firstname.lastname) or 'custom' (user-provided list)
COMMENT ON COLUMN provisioning_jobs.mail_accounts_per_domain IS 'Number of email accounts to create per sending domain (1-5)';
COMMENT ON COLUMN provisioning_jobs.mail_account_style IS 'random_names = auto-generated firstname.lastname, custom = user-provided prefixes';
