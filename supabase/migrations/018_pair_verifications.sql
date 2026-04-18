-- Migration 018: pair_verifications
--
-- In-app Pair Verify feature. Stores the result of an on-demand deliverability
-- audit against a server pair: MXToolbox domain health, multi-resolver PTR
-- alignment, DNS propagation consistency, and a targeted operational DNSBL
-- sweep (Spamhaus SBL/DBL, Barracuda, Invaluement).
--
-- Shape notes:
--   * pair_id matches the existing `sending_domains.pair_id` convention
--     (NOT `server_pair_id`). See migration 001 for the column name we mirror.
--   * run_by is a Clerk user id ("user_..."), text, not a uuid. This schema
--     has no auth.users table — Clerk owns user identity.
--   * status lifecycle: running → (green | yellow | red). `yellow` is a
--     best-effort outcome used when MXToolbox itself was unreachable so
--     we can't assert operational-green but have no operational-red signal
--     either.
--   * checks jsonb holds the per-check array produced by runPairVerification:
--     [{ name, result: 'pass'|'fail'|'warn', details, is_sem_warning }]

CREATE TABLE IF NOT EXISTS pair_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES server_pairs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'green', 'yellow', 'red')),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer,
  run_by text,
  run_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pair_verifications_pair_runat
  ON pair_verifications(pair_id, run_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- Follows the pattern in 001_initial_schema.sql for sending_domains:
-- scope via the parent server_pairs.org_id and the Clerk JWT org_id claim.
-- ============================================================

ALTER TABLE pair_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pv_select" ON pair_verifications FOR SELECT
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );

CREATE POLICY "pv_insert" ON pair_verifications FOR INSERT
  WITH CHECK (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );

CREATE POLICY "pv_update" ON pair_verifications FOR UPDATE
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
  );

CREATE POLICY "pv_delete" ON pair_verifications FOR DELETE
  USING (
    pair_id IN (
      SELECT id FROM server_pairs WHERE org_id = (auth.jwt()->>'org_id')
    )
    AND (auth.jwt()->>'org_role') = 'org:admin'
  );
