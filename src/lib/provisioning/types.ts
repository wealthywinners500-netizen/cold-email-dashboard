// ============================================
// B15: Provisioning Type Definitions
// ============================================

// Enums matching SQL enum types
export type VPSProviderType =
  | "clouding"
  | "digitalocean"
  | "hetzner"
  | "vultr"
  | "linode"
  | "contabo"
  | "ovh"
  | "custom"
  | "dry_run";

export type DNSRegistrarType =
  | "ionos"
  | "namecheap"
  | "godaddy"
  | "cloudflare"
  | "porkbun"
  | "namecom"
  | "dynadot"
  | "custom"
  | "dry_run";

export type ProvisioningStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "rolled_back"
  | "cancelled";

export type StepType =
  | "create_vps"
  | "set_ptr"
  | "configure_registrar"
  | "install_hestiacp"
  | "setup_dns_zones"
  | "setup_mail_domains"
  | "security_hardening"
  | "verification_gate";

export type StepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped"
  | "manual_required";

// Database row types
export interface VPSProviderRow {
  id: string;
  org_id: string;
  name: string;
  provider_type: VPSProviderType;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  config: Record<string, unknown>;
  is_default: boolean;
  port_25_status: string;
  created_at: string;
  updated_at: string;
}

export interface DNSRegistrarRow {
  id: string;
  org_id: string;
  name: string;
  registrar_type: DNSRegistrarType;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProvisioningJobRow {
  id: string;
  org_id: string;
  vps_provider_id: string | null;
  dns_registrar_id: string | null;
  status: ProvisioningStatus;
  ns_domain: string;
  sending_domains: string[];
  mail_accounts_per_domain: number;
  mail_account_style: 'random_names' | 'custom';
  admin_email: string | null;
  server1_ip: string | null;
  server2_ip: string | null;
  server1_provider_id: string | null;
  server2_provider_id: string | null;
  server_pair_id: string | null;
  progress_pct: number;
  current_step: StepType | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  config: Record<string, unknown>;
}

export interface ProvisioningStepRow {
  id: string;
  job_id: string;
  step_type: StepType;
  step_order: number;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  output: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SSHCredentialRow {
  id: string;
  org_id: string;
  server_ip: string;
  hostname: string | null;
  username: string;
  password_encrypted: string | null;
  private_key_encrypted: string | null;
  port: number;
  provisioning_job_id: string | null;
  created_at: string;
  updated_at: string;
}

// Provider abstraction interfaces
export interface ServerCreateParams {
  name: string;
  region: string;
  size: string;
  image?: string;
  sshKeyId?: string;
}

export interface ServerInfo {
  id: string;
  name: string;
  ip: string;
  status: string;
  region: string;
}

export interface PTRParams {
  ip: string;
  hostname: string;
}

export interface DNSRecordParams {
  zone: string;
  type: "A" | "AAAA" | "MX" | "TXT" | "NS" | "CNAME" | "SRV";
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface VPSProvider {
  readonly providerType: VPSProviderType;
  createServer(params: ServerCreateParams): Promise<ServerInfo>;
  deleteServer(serverId: string): Promise<void>;
  getServer(serverId: string): Promise<ServerInfo>;
  setPTR(params: PTRParams): Promise<void>;
  listImages(): Promise<Array<{ id: string; name: string }>>;
  listRegions(): Promise<Array<{ id: string; name: string }>>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

// Domain auto-pull types
export interface DomainInfo {
  domain: string;
  status: 'active' | 'expired' | 'pending' | 'unknown';
  expiresAt: string | null;
  hasMxRecords: boolean | null; // null = not checked yet
  nameservers: string[];
  isAvailable: boolean; // our determination: no MX, not already used
}

export interface DNSRegistrar {
  readonly registrarType: DNSRegistrarType;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
  setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void>;
  createZone(domain: string): Promise<void>;
  createRecord(params: DNSRecordParams): Promise<{ id: string }>;
  deleteRecord(zone: string, recordId: string): Promise<void>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  listDomains(): Promise<DomainInfo[]>;
}

// Runtime context passed through provisioning saga steps
export interface ProvisioningContext {
  jobId: string;
  orgId: string;
  vpsProvider: VPSProvider;
  dnsRegistrar: DNSRegistrar;
  nsDomain: string;
  sendingDomains: string[];
  mailAccountsPerDomain: number;
  mailAccountStyle: 'random_names' | 'custom';
  adminEmail: string | null;
  server1?: ServerInfo;
  server2?: ServerInfo;
  log: (message: string) => void;
}
