import type { DNSRecordParams, DNSRegistrarType } from "../types";
import { BaseDNSRegistrar } from "../providers/base";

interface PorkbunResponse {
  status: string;
  id?: string | number;
  yourIp?: string;
  [key: string]: unknown;
}

/**
 * Porkbun DNS Registrar
 * Implements Porkbun's API v3 for domain management and DNS record operations.
 *
 * Auth: API key and secret are sent in every request body, not headers.
 * Base URL: https://porkbun.com/api/json/v3
 */
export class PorkbunRegistrar extends BaseDNSRegistrar {
  readonly registrarType: DNSRegistrarType = "porkbun";
  private readonly baseUrl = "https://porkbun.com/api/json/v3";

  /**
   * Porkbun requires auth in request body, not headers.
   */
  protected getAuthHeaders(): Record<string, string> {
    return {};
  }

  /**
   * Wrap request body with Porkbun auth fields.
   */
  private getAuthBody(): Record<string, string> {
    if (!this.apiSecret) {
      throw new Error("Porkbun requires both apiKey and apiSecret");
    }
    return {
      apikey: this.apiKey,
      secretapikey: this.apiSecret,
    };
  }

  /**
   * Test connection to Porkbun API.
   * POST /ping with auth in body.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      this.log("Testing Porkbun connection...");
      const response = await this.httpRequest<PorkbunResponse>(
        `${this.baseUrl}/ping`,
        {
          method: "POST",
          body: JSON.stringify(this.getAuthBody()),
        }
      );

      if (response.status === "SUCCESS") {
        const message = `Connected to Porkbun (IP: ${response.yourIp})`;
        this.log(message);
        return { ok: true, message };
      }

      throw new Error(`Porkbun ping failed: ${response.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Connection test failed: ${message}`);
      return { ok: false, message };
    }
  }

  /**
   * Set nameservers for a domain.
   * POST /domain/updateNs/{domain} with ns array in body.
   */
  async setNameservers(domain: string, nameservers: string[]): Promise<void> {
    try {
      this.log(`Setting nameservers for ${domain}: ${nameservers.join(", ")}`);

      const response = await this.httpRequest<PorkbunResponse>(
        `${this.baseUrl}/domain/updateNs/${domain}`,
        {
          method: "POST",
          body: JSON.stringify({
            ...this.getAuthBody(),
            ns: nameservers,
          }),
        }
      );

      if (response.status !== "SUCCESS") {
        throw new Error(`Failed to set nameservers: ${response.status}`);
      }

      this.log(`Nameservers updated for ${domain}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`setNameservers failed for ${domain}: ${message}`);
    }
  }

  /**
   * Set glue records for a domain.
   * POST /domain/addGlue/{domain} for each record.
   */
  async setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void> {
    try {
      this.log(`Setting ${records.length} glue record(s) for ${domain}`);

      for (const record of records) {
        const subdomain = record.hostname.split(".")[0]; // Extract first part (e.g., "ns1" from "ns1.domain.com")

        const response = await this.httpRequest<PorkbunResponse>(
          `${this.baseUrl}/domain/addGlue/${domain}`,
          {
            method: "POST",
            body: JSON.stringify({
              ...this.getAuthBody(),
              records: [
                {
                  subdomain,
                  type: "A",
                  address: record.ip,
                },
              ],
            }),
          }
        );

        if (response.status !== "SUCCESS") {
          throw new Error(
            `Failed to add glue record for ${record.hostname}: ${response.status}`
          );
        }

        this.log(`Glue record added: ${record.hostname} -> ${record.ip}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`setGlueRecords failed for ${domain}: ${message}`);
    }
  }

  /**
   * Create a zone (no-op for Porkbun — zones exist when you own the domain).
   * Verify with ping.
   */
  async createZone(domain: string): Promise<void> {
    try {
      this.log(`Verifying zone exists for ${domain}`);

      // Porkbun zones exist implicitly when you own the domain.
      // Just verify connectivity with a ping.
      const pingResult = await this.testConnection();
      if (!pingResult.ok) {
        throw new Error("Cannot verify zone: Porkbun connection failed");
      }

      this.log(`Zone verified for ${domain}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`createZone failed for ${domain}: ${message}`);
    }
  }

  /**
   * Create a DNS record.
   * POST /dns/create/{domain} with record details in body.
   */
  async createRecord(params: DNSRecordParams): Promise<{ id: string }> {
    try {
      const { zone, type, name, value, ttl = 600, priority } = params;

      this.log(
        `Creating ${type} record: ${name} -> ${value} (TTL: ${ttl}) in zone ${zone}`
      );

      const body: Record<string, unknown> = {
        ...this.getAuthBody(),
        type,
        name, // Porkbun expects subdomain part only, not FQDN
        content: value,
        ttl: String(ttl),
      };

      // Add priority for MX and SRV records
      if (priority !== undefined && (type === "MX" || type === "SRV")) {
        body.prio = priority;
      }

      const response = await this.httpRequest<PorkbunResponse>(
        `${this.baseUrl}/dns/create/${zone}`,
        {
          method: "POST",
          body: JSON.stringify(body),
        }
      );

      if (response.status !== "SUCCESS") {
        throw new Error(`Failed to create record: ${response.status}`);
      }

      const recordId = String(response.id);
      this.log(
        `DNS record created: ${name} (ID: ${recordId})`
      );

      return { id: recordId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`createRecord failed: ${message}`);
    }
  }

  /**
   * Delete a DNS record.
   * POST /dns/delete/{domain}/{id} with auth in body.
   * Note: Porkbun uses POST for deletes, not DELETE.
   */
  async deleteRecord(zone: string, recordId: string): Promise<void> {
    try {
      this.log(`Deleting DNS record ${recordId} from zone ${zone}`);

      const response = await this.httpRequest<PorkbunResponse>(
        `${this.baseUrl}/dns/delete/${zone}/${recordId}`,
        {
          method: "POST",
          body: JSON.stringify(this.getAuthBody()),
        }
      );

      if (response.status !== "SUCCESS") {
        throw new Error(`Failed to delete record: ${response.status}`);
      }

      this.log(`DNS record deleted: ${recordId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`deleteRecord failed for ${recordId}: ${message}`);
    }
  }
}
