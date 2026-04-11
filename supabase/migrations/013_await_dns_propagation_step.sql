-- 013_await_dns_propagation_step.sql
--
-- Test #15 (2026-04-11): adds a new provisioning step type
-- `await_dns_propagation` between configure_registrar and setup_dns_zones.
--
-- The step polls 8.8.8.8/1.1.1.1/9.9.9.9 for NS-record convergence on
-- the ns_domain (up to 75 minutes) before any A-record / Hestia DNS
-- writes happen, eliminating intermittent LE issuance failures in
-- security_hardening that were caused by stale resolver caches.
--
-- The step runs ONLY on the worker VPS (no Vercel cap) via the new
-- pollAdvanceableJobs cron + provision-step queue path.
--
-- IMPORTANT: ALTER TYPE … ADD VALUE used to be transaction-restricted
-- in PG <12. Supabase runs PG14+, so this is fine. The IF NOT EXISTS
-- guard makes the migration idempotent.

ALTER TYPE provisioning_step_type
  ADD VALUE IF NOT EXISTS 'await_dns_propagation' BEFORE 'setup_dns_zones';
