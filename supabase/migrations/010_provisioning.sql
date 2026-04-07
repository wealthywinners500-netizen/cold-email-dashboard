-- Migration 010: Provisioning infrastructure tables
-- Part of B15: Automated Server Provisioning

-- Enum types
CREATE TYPE vps_provider_type AS ENUM (
  'clouding', 'digitalocean', 'hetzner', 'vultr', 'linode', 'contabo', 'ovh', 'custom'
);

CREATE TYPE dns_registrar_type AS ENUM (
  'ionos', 'namecheap', 'godaddy', 'cloudflare', 'porkbun', 'namecom', 'dynadot', 'custom'
);

CREATE TYPE provisioning_status AS ENUM (
  'pending', 'in_progress', 'completed', 'failed', 'rolled_back', 'cancelled'
);

CREATE TYPE provisioning_step_type AS ENUM (
  'create_vps', 'set_ptr', 'configure_registrar', 'install_hestiacp',
  'setup_dns_zones', 'setup_mail_domains', 'security_hardening', 'verification_gate'
);

CREATE TYPE provisioning_step_status AS ENUM (
  'pending', 'in_progress', 'completed', 'failed', 'skipped', 'manual_required'
);

-- VPS Provider Configurations
CREATE TABLE vps_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_type vps_provider_type NOT NULL,
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  port_25_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DNS Registrar Configurations
CREATE TABLE dns_registrars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  registrar_type dns_registrar_type NOT NULL,
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provisioning Jobs (the saga)
CREATE TABLE provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  vps_provider_id UUID REFERENCES vps_providers(id),
  dns_registrar_id UUID REFERENCES dns_registrars(id),
  status provisioning_status DEFAULT 'pending',
  ns_domain TEXT NOT NULL,
  sending_domains TEXT[] NOT NULL,
  mail_account_pattern TEXT[] DEFAULT ARRAY['dean', 'info', 'hello'],
  admin_email TEXT DEFAULT 'dean.hofer@thestealthmail.com',
  server1_ip INET,
  server2_ip INET,
  server1_provider_id TEXT,
  server2_provider_id TEXT,
  server_pair_id UUID REFERENCES server_pairs(id),
  progress_pct SMALLINT DEFAULT 0,
  current_step provisioning_step_type,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  config JSONB DEFAULT '{}'::jsonb
);

-- Provisioning Steps (individual step logs)
CREATE TABLE provisioning_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES provisioning_jobs(id) ON DELETE CASCADE,
  step_type provisioning_step_type NOT NULL,
  step_order SMALLINT NOT NULL,
  status provisioning_step_status DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SSH Credentials (per server)
CREATE TABLE ssh_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  server_ip INET NOT NULL,
  hostname TEXT,
  username TEXT DEFAULT 'root',
  password_encrypted TEXT,
  private_key_encrypted TEXT,
  port INTEGER DEFAULT 22,
  provisioning_job_id UUID REFERENCES provisioning_jobs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add provisioning_job_id to existing server_pairs
ALTER TABLE server_pairs
ADD COLUMN IF NOT EXISTS provisioning_job_id UUID REFERENCES provisioning_jobs(id);

-- Indexes
CREATE INDEX idx_vps_providers_org ON vps_providers(org_id);
CREATE INDEX idx_dns_registrars_org ON dns_registrars(org_id);
CREATE INDEX idx_provisioning_jobs_org ON provisioning_jobs(org_id);
CREATE INDEX idx_provisioning_jobs_status ON provisioning_jobs(status);
CREATE INDEX idx_provisioning_steps_job ON provisioning_steps(job_id);
CREATE INDEX idx_ssh_credentials_org ON ssh_credentials(org_id);
CREATE INDEX idx_ssh_credentials_ip ON ssh_credentials(server_ip);

-- RLS Policies
ALTER TABLE vps_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dns_registrars ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssh_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON vps_providers FOR ALL
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

CREATE POLICY "org_isolation" ON dns_registrars FOR ALL
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

CREATE POLICY "org_isolation" ON provisioning_jobs FOR ALL
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

CREATE POLICY "org_isolation" ON provisioning_steps FOR ALL
  USING (job_id IN (SELECT id FROM provisioning_jobs WHERE org_id = current_setting('request.jwt.claims', true)::json->>'org_id'));

CREATE POLICY "org_isolation" ON ssh_credentials FOR ALL
  USING (org_id = current_setting('request.jwt.claims', true)::json->>'org_id');

-- Realtime publication for live progress
ALTER PUBLICATION supabase_realtime ADD TABLE provisioning_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE provisioning_steps;
