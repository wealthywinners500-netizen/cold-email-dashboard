-- B11: Lead Database — Individual Contact Records
-- Migration 007

CREATE TABLE lead_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_name VARCHAR(255),
  business_type VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  website VARCHAR(500),
  address TEXT,
  city VARCHAR(255),
  state VARCHAR(50),
  zip VARCHAR(20),
  country VARCHAR(50) DEFAULT 'US',
  google_rating DECIMAL,
  google_reviews_count INT,
  google_place_id VARCHAR(255),
  email_status VARCHAR(50) DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  verification_source VARCHAR(50),
  scrape_source VARCHAR(50) DEFAULT 'manual',
  scrape_query TEXT,
  scraped_at TIMESTAMPTZ,
  times_emailed INT DEFAULT 0,
  last_emailed_at TIMESTAMPTZ,
  suppressed BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, email)
);

-- Indexes
CREATE INDEX idx_lead_contacts_org_email ON lead_contacts(org_id, email);
CREATE INDEX idx_lead_contacts_org_location ON lead_contacts(org_id, state, city);
CREATE INDEX idx_lead_contacts_org_type ON lead_contacts(org_id, business_type);
CREATE INDEX idx_lead_contacts_org_status ON lead_contacts(org_id, email_status);
CREATE INDEX idx_lead_contacts_org_suppressed ON lead_contacts(org_id, suppressed) WHERE suppressed = false;
CREATE INDEX idx_lead_contacts_tags ON lead_contacts USING GIN(tags);
CREATE INDEX idx_lead_contacts_created ON lead_contacts(created_at DESC);

-- RLS
ALTER TABLE lead_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON lead_contacts
  USING (org_id = (SELECT auth.jwt()->>'org_id'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE lead_contacts;

-- Add integrations JSONB to organizations if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'integrations') THEN
    ALTER TABLE organizations ADD COLUMN integrations JSONB DEFAULT '{}';
  END IF;
END $$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_lead_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_lead_contacts_updated_at
  BEFORE UPDATE ON lead_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_contacts_updated_at();
