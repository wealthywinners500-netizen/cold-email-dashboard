import type { DNSRecordParams } from "../types";
import { BaseDNSRegistrar } from "../providers/base";

/**
 * IonosRegistrar implements DNS operations for IONOS Hosting.
 *
 * API Reference: https://api.hosting.ionos.com (IONOS Hosting API)
 * Rate limit: 25 requests/minute (throttle enforced locally)
 *
 * Key behaviors:
 * - Auth header: X-API-Key: {prefix}.{key} (apiKey is already concatenated)
 * - Zone operations use /dns/v1/zones endpoints
 * - Record CRUD requires zoneId lookup first
 * - Nameserver update via PUT /domains/{domain}
 * - Glue records created as A records for ns1/ns2 subdomains
 */
export class IonosRegistrar extends BaseDNSRegistrar {
  readonly registrarType = "ionos";
  private readonly baseUrl = "https://api.hosting.ionos.com";
  private lastRequestTime = 0;
  private readonly minRequestInterval = 2400; // 2.4s for 25 requests/minute (1000ms * 60 / 25 = 2400ms)

  constructor(apiKey: string, apiSecret: string | null, config: Record<string, unknown>) {
    super(apiKey, apiSecret, config);
  }

  /**
   * Return auth headers for IONOS API.
   * apiKey is expected to be in "prefix.key" format (already concatenated).
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
    };
  }

  /**
   * Rate-limiting throttle: ensure we don't exceed 25 requests/minute.
   */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.minRequestInterval) {
      const delay = this.minRequestInterval - elapsed;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a throttled HTTP request.
   */
  protected async httpRequest<T>(
    url: string,
    options: RequestInit = {},
    retries: number = 2
  ): Promise<T> {
    await this.throttle();
    return super.httpRequest<T>(url, options, retries);
  }

  /**
   * Look up zone ID by domain name.
   * GET /dns/v1/zones?name={domain}
   * Returns array of zone objects with { id, name } fields.
   */
  private async getZoneId(domain: string): Promise<string> {
    interface ZoneResponse {
      id: string;
      name: string;
    }

    const url = `${this.baseUrl}/dns/v1/zones?name=${encodeURIComponent(domain)}`;
    this.log(`Looking up zone ID for ${domain}`);

    const zones = await this.httpRequest<ZoneResponse[]>(url, {
      method: "GET",
    });

    if (!zones || zones.length === 0) {
      throw new Error(`Zone not found for domain: ${domain}`);
    }

    const zone = zones[0];
    this.log(`Found zone ID: ${zone.id}`);
    return zone.id;
  }

  /**
   * Set nameservers for a domain.
   * PUT /domains/{domain} with body { nameservers: [...] }
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const url = `${this.baseUrl}/domains/${encodeURIComponent(domain)}`;
    const body = {
      nameservers,
    };

    this.log(`Setting nameservers for ${domain}: ${nameservers.join(", ")}`);

    await this.httpRequest<void>(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    this.log(`Nameservers set successfully`);
  }

  /**
   * Create A records for glue records (ns1.domain, ns2.domain, etc.).
   * For each { hostname, ip }, create an A record in the zone.
   */
  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    const zoneId = await this.getZoneId(domain);

    for (const record of records) {
      this.log(`Creating glue record: ${record.hostname} -> ${record.ip}`);

      // Create A record for ns1.domain, ns2.domain, etc.
      const createUrl = `${this.baseUrl}/dns/v1/zones/${zoneId}/records`;
      const body = [
        {
          name: record.hostname,
          type: "A",
          content: record.ip,
          ttl: 3600,
        },
      ];

      await this.httpRequest<void>(createUrl, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    this.log(`Glue records created successfully`);
  }

  /**
   * Create a DNS zone.
   * POST /dns/v1/zones with body { name: domain, type: "NATIVE" }
   */
  async createZone(domain: string): Promise<void> {
    const url = `${this.baseUrl}/dns/v1/zones`;
    const body = {
      name: domain,
      type: "NATIVE",
    };

    this.log(`Creating zone for ${domain}`);

    await this.httpRequest<{ id: string }>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });

    this.log(`Zone created successfully`);
  }

  /**
   * Create a DNS record.
   * POST /dns/v1/zones/{zoneId}/records
   * Body: [{ name, type, content: value, ttl, prio: priority }]
   */
  async createRecord(params: DNSRecordParams): Promise<{ id: string }> {
    const zoneId = await this.getZoneId(params.zone);
    const url = `${this.baseUrl}/dns/v1/zones/${zoneId}/records`;

    interface RecordBody {
      name: string;
      type: string;
      content: string;
      ttl?: number;
      prio?: number;
    }

    const body: RecordBody[] = [
      {
        name: params.name,
        type: params.type,
        content: params.value,
      },
    ];

    // Add optional fields if provided
    if (params.ttl !== undefined) {
      body[0].ttl = params.ttl;
    }
    if (params.priority !== undefined) {
      body[0].prio = params.priority;
    }

    this.log(`Creating ${params.type} record: ${params.name} -> ${params.value}`);

    interface CreateResponse {
      id: string;
    }

    const result = await this.httpRequest<CreateResponse[]>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!result || result.length === 0) {
      throw new Error(`Failed to create record: no ID returned`);
    }

    const recordId = result[0].id;
    this.log(`Record created with ID: ${recordId}`);
    return { id: recordId };
  }

  /**
   * Delete a DNS record.
   * DELETE /dns/v1/zones/{zoneId}/records/{recordId}
   */
  async deleteRecord(zone: string, recordId: string): Promise<void> {
    const zoneId = await this.getZoneId(zone);
    const url = `${this.baseUrl}/dns/v1/zones/${zoneId}/records/${recordId}`;

    this.log(`Deleting record ${recordId} from zone ${zone}`);

    await this.httpRequest<void>(url, {
      method: "DELETE",
    });

    this.log(`Record deleted successfully`);
  }

  /**
   * Test the connection by listing zones.
   * GET /dns/v1/zones
   * If 200 OK, connection is valid.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const url = `${this.baseUrl}/dns/v1/zones`;
      this.log(`Testing connection...`);

      // Simple list request — if it succeeds, auth is valid
      interface ZoneTest {
        id: string;
        name: string;
      }

      await this.httpRequest<ZoneTest[]>(url, {
        method: "GET",
      });

      this.log(`Connection test passed`);
      return { ok: true, message: "Connected to IONOS API successfully" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error during connection test";
      this.log(`Connection test failed: ${message}`);
      return { ok: false, message };
    }
  }
}
