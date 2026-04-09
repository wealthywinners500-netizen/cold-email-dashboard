import type { DNSRecordParams, DomainInfo } from "../types";
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
 * - Nameserver + glue records use /domains/v1/domainitems/{uuid}/nameservers (single PUT)
 * - Domain listing uses /domains/v1/domainitems (response: {count, domains})
 *
 * Confirmed endpoints (2026-04-09 curl testing):
 * - GET  /dns/v1/zones                                     → list DNS zones
 * - GET  /dns/v1/zones/{zoneId}/records                    → list zone records (array)
 * - POST /dns/v1/zones/{zoneId}/records                    → create records
 * - GET  /domains/v1/domainitems?limit=N&offset=N          → list domains {count, domains}
 * - GET  /domains/v1/domainitems/{uuid}                    → domain detail
 * - GET  /domains/v1/domainitems/{uuid}/nameservers        → get NS + glue
 * - PUT  /domains/v1/domainitems/{uuid}/nameservers        → set NS + glue (202 Accepted)
 *
 * WRONG endpoints (404 or 400):
 * - /api/domains/v1/domainitems → 400 "Unsupported serviceId: api"
 * - /domains/{domainName}       → 404
 * - /domains/v1/domains/{name}  → 404
 */
export class IonosRegistrar extends BaseDNSRegistrar {
  readonly registrarType = "ionos";
  private readonly baseUrl = "https://api.hosting.ionos.com";
  private lastRequestTime = 0;
  private readonly minRequestInterval = 2400; // 2.4s for 25 requests/minute

  // Cache for domain name → UUID mapping (avoids repeated list calls)
  private domainIdCache = new Map<string, string>();

  // Pending NS names stored by setNameservers() for use by setGlueRecords()
  private pendingNameservers = new Map<string, string[]>();

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
   * Look up domain UUID from the Domains API.
   * GET /domains/v1/domainitems?limit=200
   * Caches results to avoid repeated API calls.
   */
  private async getDomainId(domainName: string): Promise<string> {
    // Check cache first
    const cached = this.domainIdCache.get(domainName);
    if (cached) return cached;

    interface DomainItem {
      id: string;
      name: string;
      tld: string;
    }

    interface DomainsResponse {
      count: number;
      domains: DomainItem[];
    }

    this.log(`Looking up domain UUID for ${domainName}`);

    let offset = 0;
    const limit = 200;

    while (true) {
      const url = `${this.baseUrl}/domains/v1/domainitems?limit=${limit}&offset=${offset}`;
      const response = await this.httpRequest<DomainsResponse>(url, { method: "GET" });

      if (!response || !response.domains || response.domains.length === 0) {
        break;
      }

      // Cache all results from this page
      for (const d of response.domains) {
        this.domainIdCache.set(d.name, d.id);
      }

      // Check if we found the domain
      const found = this.domainIdCache.get(domainName);
      if (found) {
        this.log(`Found domain UUID: ${found}`);
        return found;
      }

      offset += limit;
      if (offset >= response.count) break;
    }

    throw new Error(
      `Domain "${domainName}" not found in IONOS account. ` +
      `Checked ${this.domainIdCache.size} domains.`
    );
  }

  /**
   * Set nameservers for a domain.
   *
   * IONOS requires nameservers + glue (IPs) to be set in a single PUT call.
   * This method stores the NS names for use by setGlueRecords() which makes
   * the actual API call with both NS names and IPs.
   *
   * If setGlueRecords() is NOT called after this, the NS change won't happen.
   * This is by design — NS without glue records would break DNS resolution
   * for self-hosted nameservers (ns1.domain, ns2.domain under same zone).
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    this.log(`Storing nameservers for ${domain}: ${nameservers.join(", ")} (will apply with glue records)`);
    this.pendingNameservers.set(domain, nameservers);
  }

  /**
   * Set glue records (child nameserver IPs) AND nameservers in one API call.
   *
   * IONOS API endpoint: PUT /domains/v1/domainitems/{uuid}/nameservers
   * Body: {"type":"CUSTOM","nameservers":[{"name":"ns1.x","ipV4Addresses":["1.2.3.4"]}]}
   * Response: 202 Accepted with {"id":"..."}
   *
   * This combines the nameserver + glue record operations because IONOS
   * handles them as a single atomic update at the registrar level.
   */
  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    const domainId = await this.getDomainId(domain);

    // Build the nameserver array with glue IPs
    const nameserverPayload = records.map((r) => ({
      name: r.hostname,
      ipV4Addresses: [r.ip],
    }));

    const body = {
      type: "CUSTOM",
      nameservers: nameserverPayload,
    };

    const url = `${this.baseUrl}/domains/v1/domainitems/${domainId}/nameservers`;
    this.log(`Setting nameservers + glue for ${domain} (UUID: ${domainId})`);
    this.log(`  Payload: ${JSON.stringify(body)}`);

    // PUT returns 202 Accepted — IONOS processes asynchronously
    // The httpRequest helper expects JSON response, but 202 may have minimal body
    interface NSUpdateResponse {
      id?: string;
    }

    const result = await this.httpRequest<NSUpdateResponse>(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    this.log(`Nameservers + glue set successfully (update ID: ${result?.id || "n/a"})`);

    // Clear pending NS
    this.pendingNameservers.delete(domain);
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

  /**
   * List all domains from IONOS account with MX record status.
   *
   * GET /domains/v1/domainitems with pagination (limit=200, offset=0)
   * Response shape: { count: number, domains: [{ id, name, tld }] }
   *
   * For each domain, check MX records via DNS API (gracefully handles 401 for
   * zones on custom nameservers where IONOS DNS isn't active).
   */
  async listDomains(): Promise<DomainInfo[]> {
    interface DomainItem {
      id: string;
      name: string;
      tld: string;
    }

    interface DomainsApiResponse {
      count: number;
      domains: DomainItem[];
    }

    const domains: DomainInfo[] = [];
    let offset = 0;
    const limit = 200;
    let totalCount = limit; // Start with limit to ensure at least one iteration

    this.log(`Fetching domains from IONOS account...`);

    // Paginate through all domains
    while (offset < totalCount) {
      const url = `${this.baseUrl}/domains/v1/domainitems?limit=${limit}&offset=${offset}`;

      try {
        const response = await this.httpRequest<DomainsApiResponse>(url, {
          method: "GET",
        });

        if (!response || !response.domains) {
          this.log(`No domains found at offset ${offset}`);
          break;
        }

        totalCount = response.count;
        this.log(
          `Fetched ${response.domains.length} domains (total: ${totalCount}, offset: ${offset})`
        );

        // Process each domain
        for (const domainItem of response.domains) {
          const domainName = domainItem.name;
          let hasMxRecords: boolean | null = null;

          // Cache the domain ID
          this.domainIdCache.set(domainName, domainItem.id);

          // Check for MX records using DNS API
          // This may fail with 401 for domains on custom NS (not IONOS DNS) — that's OK
          try {
            const zoneId = await this.getZoneId(domainName);
            const mxUrl = `${this.baseUrl}/dns/v1/zones/${zoneId}/records?type=MX`;

            // IONOS DNS API returns an array of records directly, NOT wrapped in { records: [...] }
            interface MxRecord {
              id: string;
              name: string;
              type: string;
              content: string;
            }

            const mxRecords = await this.httpRequest<MxRecord[]>(mxUrl, {
              method: "GET",
            });

            hasMxRecords = Array.isArray(mxRecords) && mxRecords.length > 0;
            this.log(`Domain ${domainName}: MX records found = ${hasMxRecords}`);
          } catch (mxError) {
            // 401 = DNS not managed by IONOS (custom NS), treat as no MX data
            this.log(
              `Could not check MX records for ${domainName}: ${
                mxError instanceof Error ? mxError.message : "Unknown error"
              }`
            );
            hasMxRecords = null;
          }

          // Determine availability: no MX records (or unknown) = potentially available
          const isAvailable = hasMxRecords === false;

          const domainInfo: DomainInfo = {
            domain: domainName,
            status: "active", // IONOS domainitems endpoint only returns active/registered domains
            expiresAt: null, // Not available in domainitems list response
            hasMxRecords,
            nameservers: [], // Would require per-domain /nameservers call (expensive)
            isAvailable,
          };

          domains.push(domainInfo);
        }

        offset += limit;

        // Rate limiting: 2.5s delay between paginated requests
        if (offset < totalCount) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        this.log(`Error fetching domains at offset ${offset}: ${errorMsg}`);
        throw error;
      }
    }

    this.log(`Domain listing complete: ${domains.length} domains found`);
    return domains;
  }
}
