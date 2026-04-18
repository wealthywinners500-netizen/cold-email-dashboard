-- Migration 017: DNSBL zone liveness cache with 24h fail-safe
--
-- Caches per-zone canary (127.0.0.2) liveness results so the create_vps
-- DNSBL check doesn't fail-closed the instant all 3 resolvers glitch on
-- the same zone. Previously, if 8.8.8.8 / 1.1.1.1 / 9.9.9.9 all hiccupped
-- simultaneously on e.g. spam.spamrats.com, the pipeline rejected a
-- perfectly clean IP. Now we remember the zone was live recently and keep
-- trusting "LIVE" for 24h before flipping to dead.
--
-- Rows are upserted by zone PRIMARY KEY. `first_seen_dead` is the clock
-- the 24h fail-safe runs on — set when we first observe all-NXDOMAIN,
-- cleared when any resolver observes the canary again.

CREATE TABLE IF NOT EXISTS dnsbl_zone_liveness (
  zone TEXT PRIMARY KEY,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  live BOOLEAN NOT NULL,
  sample_ip INET,
  evidence JSONB DEFAULT '{}'::jsonb,
  first_seen_dead TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dnsbl_zone_liveness_last_checked
  ON dnsbl_zone_liveness(last_checked);
