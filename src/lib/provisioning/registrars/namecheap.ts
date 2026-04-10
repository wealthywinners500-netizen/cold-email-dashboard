import { BaseDNSRegistrar } from "../providers/base";
import type { DNSRecordParams, DomainInfo } from "../types";

/**
 * Namecheap XML API registrar implementation
 * API: https://api.namecheap.com/xml.response
 * Docs: https://www.namecheap.com/support/api/
 *
 * CRITICAL: Namecheap's domains.dns.setHosts REPLACES ALL records.
 * createRecord and deleteRecord must use GET-then-SET pattern.
 *
 * Rate limit: 20 requests/minute
 */
export class NamecheapRegistrar extends BaseDNSRegistrar {
  readonly registrarType = "namecheap";
  private readonly baseUrl = "https://api.namecheap.com/xml.response";
  private readonly requestsPerMinute = 20;
  private lastRequestTime = 0;

  protected getAuthHeaders(): Record<string, string> {
    // Namecheap uses query params for auth, not headers
    return {};
  }

  /**
   * Extract SLD and TLD from a domain.
   * Examples: example.com -> { sld: "example", tld: "com" }
   *          example.co.uk -> { sld: "example", tld: "co.uk" }
   */
  private parseDomain(domain: string): { sld: string; tld: string } {
    const parts = domain.split(".");

    // Common two-part TLDs
    const twoPartTlds = new Set([
      "co.uk",
      "co.nz",
      "co.in",
      "co.jp",
      "co.kr",
      "com.au",
      "com.br",
      "com.mx",
      "com.cn",
      "ac.uk",
      "org.uk",
      "gov.uk",
      "co.za",
      "ne.jp",
    ]);

    if (parts.length >= 3) {
      const potentialTld = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
      if (twoPartTlds.has(potentialTld.toLowerCase())) {
        const sld = parts[parts.length - 3];
        return { sld, tld: potentialTld };
      }
    }

    // Default: last part is TLD, second-to-last is SLD
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    return { sld, tld };
  }

  /**
   * Apply rate limiting (20 requests/minute = 1 request per 3 seconds)
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const minIntervalMs = (60 * 1000) / this.requestsPerMinute; // ~3000ms
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < minIntervalMs) {
      const waitMs = minIntervalMs - timeSinceLastRequest;
      this.log(`Rate limit: waiting ${Math.ceil(waitMs)}ms before next request`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Make a raw HTTP request to Namecheap API.
   * Handles XML responses instead of JSON.
   */
  private async rawRequest(
    command: string,
    params: Record<string, string>
  ): Promise<string> {
    await this.enforceRateLimit();

    const url = new URL(this.baseUrl);
    url.searchParams.set("Command", command);
    url.searchParams.set("ApiUser", this.apiSecret || "");
    url.searchParams.set("ApiKey", this.apiKey);
    url.searchParams.set("UserName", this.apiSecret || "");
    url.searchParams.set("ClientIp", (this.config.clientIp as string) || "");

    // Add command-specific params
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), { method: "POST" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Namecheap API`);
    }

    const xml = await response.text();
    this.log(`API Response: ${xml.substring(0, 200)}...`);

    // Check for API error in response
    if (xml.includes('Status="ERROR"') || xml.includes("<Error>")) {
      const errorMatch = xml.match(/<ErrorMessage>(.*?)<\/ErrorMessage>/);
      const errorMsg = errorMatch ? errorMatch[1] : "Unknown error";
      throw new Error(`Namecheap API Error: ${errorMsg}`);
    }

    return xml;
  }

  /**
   * Parse XML response for a single text node value.
   * Simple regex-based parser to avoid heavy dependencies.
   */
  private parseXmlValue(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
    return match ? match[1] : null;
  }

  /**
   * Parse all DNS records from domains.dns.getHosts response.
   */
  private parseDNSRecords(
    xml: string
  ): Array<{ hostId: string; name: string; type: string; value: string; ttl: string; priority?: string }> {
    const records: Array<{
      hostId: string;
      name: string;
      type: string;
      value: string;
      ttl: string;
      priority?: string;
    }> = [];

    // Extract all <host .../> elements
    const hostRegex = /<host\s+([^>]*)\s*\/?>/g;
    let match;

    while ((match = hostRegex.exec(xml)) !== null) {
      const attrs = match[1];
      const attrMap: Record<string, string> = {};

      // Parse attributes: HostId="1" Name="@" Type="A" etc.
      const attrRegex = /(\w+)="([^"]*)"/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrs)) !== null) {
        attrMap[attrMatch[1]] = attrMatch[2];
      }

      if (attrMap.HostId && attrMap.Type) {
        records.push({
          hostId: attrMap.HostId,
          name: attrMap.Name || "",
          type: attrMap.Type,
          value: attrMap.Address || "",
          ttl: attrMap.TTL || "1800",
          priority: attrMap.MXPriority,
        });
      }
    }

    return records;
  }

  /**
   * Namecheap doesn't have explicit zone creation.
   * Zones exist when the domain is registered. This is a no-op.
   */
  async createZone(domain: string): Promise<void> {
    this.log(`Zone for ${domain} already exists (domain is registered)`);
  }

  /**
   * Create a DNS record using the GET-then-SET pattern.
   * 1. GET all existing records via domains.dns.getHosts
   * 2. Add the new record
   * 3. SET all records including the new one via domains.dns.setHosts
   */
  async createRecord(params: DNSRecordParams): Promise<{ id: string }> {
    const { zone, type, name, value, ttl = 1800, priority } = params;
    const { sld, tld } = this.parseDomain(zone);

    this.log(
      `Creating ${type} record: ${name} -> ${value} in ${zone}`
    );

    // Step 1: GET all existing records
    const getResponse = await this.rawRequest("domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    });

    const existingRecords = this.parseDNSRecords(getResponse);
    this.log(`Found ${existingRecords.length} existing records`);

    // Step 2: Build the new record set including the new record
    const allRecords = existingRecords.map((r, idx) => ({
      HostName: r.name,
      RecordType: r.type,
      Address: r.value,
      TTL: r.ttl,
      MXPriority: r.priority || "",
    }));

    // Add the new record
    const newRecord = {
      HostName: name === "@" ? "" : name,
      RecordType: type,
      Address: value,
      TTL: ttl.toString(),
      MXPriority: priority ? priority.toString() : "",
    };

    allRecords.push(newRecord);
    this.log(`Setting ${allRecords.length} total records`);

    // Step 3: SET all records
    const setParams: Record<string, string> = {
      SLD: sld,
      TLD: tld,
    };

    // Add each record as indexed parameters
    allRecords.forEach((record, idx) => {
      const index = idx + 1;
      setParams[`HostName${index}`] = record.HostName;
      setParams[`RecordType${index}`] = record.RecordType;
      setParams[`Address${index}`] = record.Address;
      setParams[`TTL${index}`] = record.TTL;
      if (record.MXPriority) {
        setParams[`MXPriority${index}`] = record.MXPriority;
      }
    });

    await this.rawRequest("domains.dns.setHosts", setParams);

    // Return a synthetic ID based on the record details
    const id = `${name}:${type}`;
    this.log(`Record created with ID: ${id}`);
    return { id };
  }

  /**
   * Delete a DNS record using the GET-then-SET pattern.
   * 1. GET all existing records
   * 2. Remove the target record
   * 3. SET all remaining records
   */
  async deleteRecord(zone: string, recordId: string): Promise<void> {
    const { sld, tld } = this.parseDomain(zone);

    this.log(`Deleting record ${recordId} from ${zone}`);

    // Parse the synthetic ID format: "name:type"
    const [name, type] = recordId.split(":");
    if (!name || !type) {
      throw new Error(`Invalid record ID format: ${recordId}`);
    }

    // Step 1: GET all existing records
    const getResponse = await this.rawRequest("domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    });

    let existingRecords = this.parseDNSRecords(getResponse);
    this.log(`Found ${existingRecords.length} existing records`);

    // Step 2: Filter out the target record
    const normalizedName = name === "@" ? "" : name;
    existingRecords = existingRecords.filter(
      (r) => !(r.name === normalizedName && r.type === type)
    );

    this.log(`Remaining records after deletion: ${existingRecords.length}`);

    // Step 3: SET all remaining records
    const setParams: Record<string, string> = {
      SLD: sld,
      TLD: tld,
    };

    existingRecords.forEach((record, idx) => {
      const index = idx + 1;
      setParams[`HostName${index}`] = record.name;
      setParams[`RecordType${index}`] = record.type;
      setParams[`Address${index}`] = record.value;
      setParams[`TTL${index}`] = record.ttl;
      if (record.priority) {
        setParams[`MXPriority${index}`] = record.priority;
      }
    });

    await this.rawRequest("domains.dns.setHosts", setParams);
    this.log(`Record ${recordId} deleted successfully`);
  }

  /**
   * Set custom nameservers for a domain.
   * Calls domains.dns.setCustom with NameServers param.
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    const { sld, tld } = this.parseDomain(domain);

    this.log(`Setting nameservers for ${domain}: ${nameservers.join(", ")}`);

    const params: Record<string, string> = {
      SLD: sld,
      TLD: tld,
    };

    // Add nameservers as indexed params
    nameservers.forEach((ns, idx) => {
      params[`Nameserver${idx + 1}`] = ns;
    });

    await this.rawRequest("domains.dns.setCustom", params);
    this.log(`Nameservers set successfully`);
  }

  /**
   * Update nameservers only (no glue records).
   * For Namecheap, this delegates to setNameservers since it already
   * makes a direct API call (no stashing pattern like IONOS).
   */
  async updateNameserversOnly(domain: string, nameservers: string[]): Promise<void> {
    return this.setNameservers(domain, nameservers);
  }

  /**
   * Create glue records (NS records with associated IPs).
   * Calls domains.ns.create for each glue record.
   */
  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    const { sld, tld } = this.parseDomain(domain);

    this.log(`Setting ${records.length} glue records for ${domain}`);

    for (const record of records) {
      this.log(`Creating glue record: ${record.hostname} -> ${record.ip}`);

      await this.rawRequest("domains.ns.create", {
        SLD: sld,
        TLD: tld,
        Nameserver: record.hostname,
        IP: record.ip,
      });
    }

    this.log(`All glue records created successfully`);
  }

  /**
   * Test connection by calling domains.getList.
   * If it returns XML with no errors, connection is ok.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      this.log("Testing connection to Namecheap API");
      const response = await this.rawRequest("domains.getList", {
        ListType: "ALL",
        PageSize: "10",
      });

      // Check for successful response
      if (response.includes('Status="OK"')) {
        return {
          ok: true,
          message: "Successfully connected to Namecheap API",
        };
      } else {
        return {
          ok: false,
          message: "Unexpected response from Namecheap API",
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Namecheap connection failed: ${message}`,
      };
    }
  }

  /**
   * List all domains from Namecheap account with MX record checking.
   * 1. Fetch all domains using domains.getList with pagination
   * 2. For each domain, fetch DNS hosts to check for MX records
   * 3. Map to DomainInfo format
   */
  async listDomains(): Promise<DomainInfo[]> {
    const domains: DomainInfo[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      this.log(`Fetching domains page ${page}`);

      // Fetch domains for this page
      const listResponse = await this.rawRequest("domains.getList", {
        ListType: "ALL",
        Page: page.toString(),
        PageSize: "100",
      });

      // Parse total items and current items
      const totalItemsMatch = listResponse.match(
        /TotalItems="(\d+)"/
      );
      const totalItems = totalItemsMatch ? parseInt(totalItemsMatch[1], 10) : 0;

      // Extract all domain elements from response
      const domainRegex = /<Domain\s+([^>]*)\s*\/?>/g;
      let domainMatch;
      const domainsThisPage: Array<{
        name: string;
        isExpired: string;
      }> = [];

      while ((domainMatch = domainRegex.exec(listResponse)) !== null) {
        const attrs = domainMatch[1];
        const attrMap: Record<string, string> = {};

        // Parse attributes: Name="example.com" IsExpired="false"
        const attrRegex = /(\w+)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          attrMap[attrMatch[1]] = attrMatch[2];
        }

        if (attrMap.Name) {
          domainsThisPage.push({
            name: attrMap.Name,
            isExpired: attrMap.IsExpired || "false",
          });
        }
      }

      this.log(`Found ${domainsThisPage.length} domains on page ${page}`);

      // For each domain, check MX records
      for (const domainEntry of domainsThisPage) {
        const domainName = domainEntry.name;
        const isExpired = domainEntry.isExpired.toLowerCase() === "true";

        this.log(`Checking MX records for ${domainName}`);

        let hasMxRecords = false;

        if (!isExpired) {
          try {
            const { sld, tld } = this.parseDomain(domainName);
            const hostsResponse = await this.rawRequest(
              "domains.dns.getHosts",
              {
                SLD: sld,
                TLD: tld,
              }
            );

            // Check if any MX records exist
            const mxRecords = this.parseDNSRecords(hostsResponse).filter(
              (r) => r.type === "MX"
            );
            hasMxRecords = mxRecords.length > 0;

            this.log(
              `Domain ${domainName}: ${hasMxRecords ? "has" : "no"} MX records`
            );
          } catch (error) {
            this.log(
              `Failed to check MX records for ${domainName}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            hasMxRecords = null as any; // Mark as not checked
          }
        }

        // Determine status based on expiration
        const status = isExpired ? ("expired" as const) : ("active" as const);

        // Domain is available if: not expired AND has no MX records
        const isAvailable = !isExpired && !hasMxRecords;

        domains.push({
          domain: domainName,
          status,
          expiresAt: null, // Namecheap XML doesn't include expiration date in basic response
          hasMxRecords,
          nameservers: [], // Not included in domains.getList response
          isAvailable,
        });
      }

      // Check if there are more pages
      const pageSize = 100;
      const currentPage = page;
      const totalFetched = currentPage * pageSize;
      hasMore = totalFetched < totalItems;
      page++;
    }

    this.log(`Total domains fetched: ${domains.length}`);
    return domains;
  }
}
