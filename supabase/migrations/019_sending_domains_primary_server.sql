-- Migration 019: sending_domains.primary_server_id
--
-- Add per-server split so VG2 ssl_cert_existence probes only the owning server.
-- HL #R1 (Session 04b): 10/10 ssl_cert_existence false-positive when the checker
-- probed both S1 and S2 expecting cert on each. Saga splits 5 domains per server;
-- the absent-server probe was correct to see no cert — the check was wrong.
--
-- primary_server_id is TEXT (not FK) with values 's1' | 's2' to keep the split
-- contract simple — the actual server identifier in ssh_credentials is server_ip,
-- and pairing 's1'/'s2' labels to pair_id stays stable across IP changes.

ALTER TABLE sending_domains
  ADD COLUMN IF NOT EXISTS primary_server_id TEXT
    CHECK (primary_server_id IS NULL OR primary_server_id IN ('s1', 's2'));

COMMENT ON COLUMN sending_domains.primary_server_id IS
  'Which server in the pair owns this domain: s1 or s2. Null = unknown (legacy rows).';

CREATE INDEX IF NOT EXISTS idx_sending_domains_pair_server
  ON sending_domains (pair_id, primary_server_id);
