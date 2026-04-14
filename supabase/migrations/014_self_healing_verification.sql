-- 014_self_healing_verification.sql
-- Adds new provisioning step types for the self-healing verification pipeline:
--   await_s2_dns       — Poll public resolvers for S2 domain A records before SSL
--   auto_fix           — Auto-fix all auto_fixable issues from VG1
--   verification_gate_2 — Re-run checks after auto-fix, pass = done

-- Add new step types to the provisioning_step_type enum.
-- Using ADD VALUE IF NOT EXISTS for idempotency.
-- Note: Postgres requires each ADD VALUE in its own transaction outside a
-- multi-statement transaction block. Supabase SQL Editor runs each statement
-- in autocommit mode, so this is fine.

ALTER TYPE provisioning_step_type
  ADD VALUE IF NOT EXISTS 'await_s2_dns' BEFORE 'security_hardening';

ALTER TYPE provisioning_step_type
  ADD VALUE IF NOT EXISTS 'auto_fix' AFTER 'verification_gate';

ALTER TYPE provisioning_step_type
  ADD VALUE IF NOT EXISTS 'verification_gate_2' AFTER 'auto_fix';
