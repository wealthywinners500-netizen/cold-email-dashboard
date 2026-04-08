// ============================================
// B15-6: Dry-Run Provider + Registrar
// Simulates all operations with realistic delays
// Used for: end-to-end testing, demo mode, UI development
// ============================================

import type {
  VPSProvider,
  VPSProviderType,
  DNSRegistrar,
  DNSRegistrarType,
  ServerCreateParams,
  ServerInfo,
  PTRParams,
  DNSRecordParams,
} from "../types";

type LogCallback = (message: string) => void;

function randomIP(): string {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function randomId(): string {
  return `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// DryRunProvider — simulates VPS operations
// ============================================

export class DryRunProvider implements VPSProvider {
  readonly providerType: VPSProviderType = "dry_run";
  private onLog?: LogCallback;
  private servers: Map<string, ServerInfo> = new Map();

  constructor(onLog?: LogCallback) {
    this.onLog = onLog;
  }

  private log(message: string): void {
    const msg = `[DryRun:VPS] ${message}`;
    console.log(msg);
    this.onLog?.(msg);
  }

  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    this.log(`Creating server: ${params.name} (region: ${params.region}, size: ${params.size})`);
    await delay(3000); // Simulate 3s provisioning

    const server: ServerInfo = {
      id: randomId(),
      name: params.name,
      ip: randomIP(),
      status: "active",
      region: params.region || "dry-run-region",
    };

    this.servers.set(server.id, server);
    this.log(`Server created: ${server.id} at ${server.ip}`);
    return server;
  }

  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting server: ${serverId}`);
    await delay(1000);
    this.servers.delete(serverId);
    this.log(`Server deleted: ${serverId}`);
  }

  async getServer(serverId: string): Promise<ServerInfo> {
    this.log(`Getting server: ${serverId}`);
    await delay(500);

    const server = this.servers.get(serverId);
    if (server) return server;

    // Return a synthetic server if not found (for testing)
    return {
      id: serverId,
      name: `dry-run-server-${serverId}`,
      ip: randomIP(),
      status: "active",
      region: "dry-run-region",
    };
  }

  async setPTR(params: PTRParams): Promise<void> {
    this.log(`Setting PTR: ${params.ip} → ${params.hostname}`);
    await delay(1000);
    this.log(`PTR set successfully`);
  }

  async listImages(): Promise<Array<{ id: string; name: string }>> {
    this.log("Listing images");
    await delay(500);
    return [
      { id: "ubuntu-22.04", name: "Ubuntu 22.04 LTS" },
      { id: "ubuntu-20.04", name: "Ubuntu 20.04 LTS" },
      { id: "debian-12", name: "Debian 12" },
      { id: "hestiacp-ready", name: "HestiaCP Pre-installed" },
    ];
  }

  async listRegions(): Promise<Array<{ id: string; name: string }>> {
    this.log("Listing regions");
    await delay(500);
    return [
      { id: "us-east-1", name: "US East (New York)" },
      { id: "eu-west-1", name: "EU West (Amsterdam)" },
      { id: "eu-central-1", name: "EU Central (Frankfurt)" },
    ];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    this.log("Testing connection");
    await delay(500);
    return { ok: true, message: "Dry-run provider is always connected" };
  }
}

// ============================================
// DryRunRegistrar — simulates DNS operations
// ============================================

export class DryRunRegistrar implements DNSRegistrar {
  readonly registrarType: DNSRegistrarType = "dry_run";
  private onLog?: LogCallback;
  private records: Map<string, { id: string; zone: string; type: string; name: string; value: string }> = new Map();

  constructor(onLog?: LogCallback) {
    this.onLog = onLog;
  }

  private log(message: string): void {
    const msg = `[DryRun:DNS] ${message}`;
    console.log(msg);
    this.onLog?.(msg);
  }

  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    this.log(`Setting nameservers for ${domain}: ${nameservers.join(", ")}`);
    await delay(2000);
    this.log(`Nameservers set for ${domain}`);
  }

  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    this.log(`Setting glue records for ${domain}:`);
    for (const r of records) {
      this.log(`  ${r.hostname} → ${r.ip}`);
    }
    await delay(1500);
    this.log(`Glue records set for ${domain}`);
  }

  async createZone(domain: string): Promise<void> {
    this.log(`Creating zone: ${domain}`);
    await delay(1000);
    this.log(`Zone created: ${domain}`);
  }

  async createRecord(params: DNSRecordParams): Promise<{ id: string }> {
    const id = randomId();
    this.log(
      `Creating ${params.type} record: ${params.name}.${params.zone} → ${params.value}` +
        (params.priority ? ` (priority: ${params.priority})` : "")
    );
    await delay(500);

    this.records.set(id, {
      id,
      zone: params.zone,
      type: params.type,
      name: params.name,
      value: params.value,
    });

    this.log(`Record created: ${id}`);
    return { id };
  }

  async deleteRecord(zone: string, recordId: string): Promise<void> {
    this.log(`Deleting record ${recordId} from zone ${zone}`);
    await delay(500);
    this.records.delete(recordId);
    this.log(`Record deleted: ${recordId}`);
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    this.log("Testing connection");
    await delay(500);
    return { ok: true, message: "Dry-run registrar is always connected" };
  }
}
