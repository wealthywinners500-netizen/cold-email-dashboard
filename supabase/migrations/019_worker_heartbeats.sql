-- Migration 019: worker_heartbeats (Phase 6A)
--
-- Infra-level worker liveness telemetry. One row per WORKER_ROLE value
-- ("ops" | "send" | "all"). Each worker process upserts its row every 30
-- seconds from src/worker/index.ts. Operators can query this table to
-- confirm both the send and ops workers are alive without reading logs on
-- two different VPS hosts.
--
-- Distinct from the per-org heartbeat mechanism in lib/email/error-handler
-- (updateWorkerHeartbeat). That one marks which orgs have an active worker
-- servicing them; this one marks infra processes.
--
-- No tenant scoping — service_role only. The table is pure infra.

CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_role     text        PRIMARY KEY,  -- "ops" | "send" | "all"
  host            text        NOT NULL,
  last_ping_at    timestamptz NOT NULL DEFAULT now(),
  queue_backlogs  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_heartbeats_service_role_all ON public.worker_heartbeats;
CREATE POLICY worker_heartbeats_service_role_all ON public.worker_heartbeats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.worker_heartbeats IS
  'Worker process heartbeats. One row per WORKER_ROLE. Upserted every 30s.';
