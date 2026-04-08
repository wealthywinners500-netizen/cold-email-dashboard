-- Add dry_run to VPS provider and DNS registrar enum types
ALTER TYPE vps_provider_type ADD VALUE IF NOT EXISTS 'dry_run';
ALTER TYPE dns_registrar_type ADD VALUE IF NOT EXISTS 'dry_run';
