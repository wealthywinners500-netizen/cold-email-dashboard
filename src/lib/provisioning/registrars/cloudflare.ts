import { BaseDNSRegistrar } from "../providers/base";
import type { DNSRecordParams, DNSRegistrarType } from "../types";

interface CloudflareZoneResponse {
  result: Array<{ id: string; name: string; status: string; name_servers: string[] }>;
}

interface CloudflareCreateZoneResponse {
  result: {
    id: string;
    name: string;
    status: string;
    name_servers: string[];
  };
}

interface CloudflareCreateRecordResponse {
  result: { id: string };
}

interface CloudflareTokenVerifyResponse {
  result: { status: string };
}

/**
 * CloudflareRegistrar implements DNS management via Cloudflare API v4.
 * Extends BaseDNSRegistrar with Cloudflare-specific API calls.
 *
 * Base URL: https://api.cloudflare.com/client/v4
 * Auth: Bearer token via Authorization header
 * Rate limit: 1200 requests/5 min (no special throttling needed)
 */
export class CloudflareRegistrar extends BaseDNSRegistrar {
  readonly registrarType: DNSRegistrarType = "cloudflare";
  private readonly baseUrl = "https://api.cloudflare.com/client/v4";
  private zoneIdCache: Map<string, string> = new Map();

  /**
   * Provide Bearer token authorization header.
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Resolve zone_id for a domain via API lookup.
   * Caches result to avoid repeated API calls.
   */
  private async resolveZoneId(domain: string): Promise<string> {
    // Check cache first
    if (this.zoneIdCache.has(domain)) {
      return this.zoneIdCache.get(domain)!;
    }

    this.log(`Resolving zone ID for domain: ${domain}`);

    const url = `${this.baseUrl}/zones?name=${encodeURIComponent(domain)}`;
    const response = await this.httpRequest<CloudflareZoneResponse>(url);

    if (!response.result || response.result.length === 0) {
      throw new Error(
        `Cloudflare zone not found for domain: ${domain}. Create the zone first.`
      );
    }

    const zoneId = response.result[0].id;
    this.zoneIdCache.set(domain, zoneId);
    this.log(`Zone ID resolved: ${zoneId}`);

    return zoneId;
  }

  /**
   * Create a DNS zone in Cloudflare.
   * POST /zones with jump_start: true to activate nameservers.
   * Note: Zone may need activation by changing NS at the registrar.
   */
  async createZone(domain: string): Promise<void> {
    this.log(`Creating zone for domain: ${domain}`);

    const url = `${this.baseUrl}/zones`;
    const body = {
      name: domain,
      jump_start: true,
    };

    const response = await this.httpRequest<CloudflareCreateZoneResponse>(
      url,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    const zoneId = response.result.id;
    this.zoneIdCache.set(domain, zoneId);

    this.log(
      `Zone created successfully. ID: ${zoneId}. NS: ${response.result.name_servers.join(", ")}`
    );
    this.log(
      `Important: Update nameservers at your domain registrar to: ${response.result.name_servers.join(", ")}`
    );
  }

  /**
   * Create a DNS record in Cloudflare.
   * First resolves zone_id, then POST /zones/{zone_id}/dns_records.
   */
  async createRecord(params: DNSRecordParams): Promise<{ id: string }> {
    this.log(
      `Creating ${params.type} record: ${params.name} -> ${params.value}`
    );

    const zoneId = await this.resolveZoneId(params.zone);

    const url = `${this.baseUrl}/zones/${zoneId}/dns_records`;

    // Map generic 'value' to Cloudflare's 'content' field
    const body: Record<string, unknown> = {
      type: params.type,
      name: params.name,
      content: params.value,
      ttl: params.ttl || 1, // 1 means auto/automatic TTL
    };

    // Add priority for MX and SRV records
    if ((params.type === "MX" || params.type === "SRV") && params.priority) {
      body.priority = params.priority;
    }

    const response = await this.httpRequest<CloudflareCreateRecordResponse>(
      url,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    const recordId = response.result.id;
    this.log(`Record created successfully. ID: ${recordId}`);

    return { id: recordId };
  }

  /**
   * Delete a DNS record from Cloudflare.
   * DELETE /zones/{zone_id}/dns_records/{id}.
   * Requires resolving zone_id first.
   */
  async deleteRecord(zone: string, recordId: string): Promise<void> {
    this.log(`Deleting record: ${recordId} from zone: ${zone}`);

    const zoneId = await this.resolveZoneId(zone);

    const url = `${this.baseUrl}/zones/${zoneId}/dns_records/${recordId}`;

    await this.httpRequest<{ result: object }>(url, {
      method: "DELETE",
    });

    this.log(`Record deleted successfully: ${recordId}`);
  }

  /**
   * Set nameservers for a domain.
   * NOT SUPPORTED on free tier. Cloudflare manages nameservers automatically.
   * Custom nameservers require Business+ plan.
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    throw new Error(
      `Cloudflare manages nameservers automatically. Custom nameservers require Business+ plan. ` +
        `Set NS records at your domain registrar instead. Cloudflare-assigned NS will be provided ` +
        `when you create the zone.`
    );
  }

  /**
   * Set glue records for a domain.
   * NOT SUPPORTED. Glue records are managed by Cloudflare automatically.
   */
  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    throw new Error(
      `Glue records are managed by Cloudflare automatically. Not available via API.`
    );
  }

  /**
   * Test connection to Cloudflare API.
   * GET /user/tokens/verify — returns { result: { status: "active" } }
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      this.log("Testing Cloudflare API connection...");

      const url = `${this.baseUrl}/user/tokens/verify`;
      const response = await this.httpRequest<CloudflareTokenVerifyResponse>(
        url
      );

      if (response.result && response.result.status === "active") {
        return {
          ok: true,
          message: "Cloudflare API connection successful. Token is active.",
        };
      }

      return {
        ok: false,
        message: `Cloudflare API token status: ${response.result?.status || "unknown"}`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Cloudflare API connection failed: ${message}`,
      };
    }
  }
}
