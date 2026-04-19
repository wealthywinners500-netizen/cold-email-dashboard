-- 020_await_auth_dns_step.sql
--
-- Session 04b (HL #R3): adds a new provisioning step type `await_auth_dns`
-- between `await_s2_dns` (step 8) and `security_hardening` (step 9).
--
-- Purpose: a 10-resolver consensus gate that verifies A/MX/SPF/DKIM/DMARC
-- records have propagated publicly before Let's Encrypt issuance runs
-- inside security_hardening. Prevents burning LE's 5/hour/hostname
-- failed-validation rate limit on un-propagated DNS — which is what
-- Session 04 did (3 LE attempts per domain, 9 failed validations in
-- ~2 minutes, tripped the per-hostname cap).
--
-- Hard-fail if any required record fails consensus (≥7/10 resolvers
-- must agree) after 30 min.
--
-- Idempotent: `ADD VALUE IF NOT EXISTS` no-ops when already present.

ALTER TYPE provisioning_step_type
  ADD VALUE IF NOT EXISTS 'await_auth_dns' BEFORE 'security_hardening';
