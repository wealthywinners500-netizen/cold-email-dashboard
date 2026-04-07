import { BaseVPSProvider } from "./base";
import type {
  VPSProviderType,
  ServerCreateParams,
  ServerInfo,
  PTRParams,
} from "../types";

/**
 * CloudingProvider — Clouding.io VPS API implementation
 * Extends BaseVPSProvider for Clouding.io server provisioning
 *
 * API Base: https://api.clouding.io/v1
 * Auth: X-API-KEY header
 * Region: Spain (Barcelona) — single region
 * Port 25: Self-service toggle in Clouding.io Network settings panel
 */
export class CloudingProvider extends BaseVPSProvider {
  readonly providerType: VPSProviderType = "clouding";
  static readonly port_25_note =
    "Port 25: Self-service toggle in Clouding.io Network settings panel";

  private readonly baseUrl = "https://api.clouding.io/v1";

  /**
   * Provide Clouding-specific authentication headers
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      "X-API-KEY": this.apiKey,
    };
  }

  /**
   * Create a new VPS instance on Clouding.io
   * Maps ServerCreateParams to Clouding API fields (FlavorId, ImageId, etc.)
   */
  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    this.log(`Creating server: ${params.name} (size: ${params.size})`);

    const payload = {
      name: params.name,
      FlavorId: params.size, // size param maps to FlavorId
      ImageId: params.image || "ubuntu-22.04", // default to Ubuntu 22.04 if not specified
      ...(this.config.FirewallId ? { FirewallId: this.config.FirewallId } : {}),
    };

    interface CloudingServerResponse {
      id: string;
      name: string;
      ip: string;
      status: string;
    }

    const response = await this.httpRequest<CloudingServerResponse>(
      `${this.baseUrl}/servers`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );

    this.log(`Server created: ${response.id} with IP ${response.ip}`);

    return {
      id: response.id,
      name: response.name,
      ip: response.ip,
      status: response.status.toLowerCase(),
      region: "es", // Clouding is single-region (Spain)
    };
  }

  /**
   * Delete a VPS instance from Clouding.io
   */
  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting server: ${serverId}`);

    await this.httpRequest<void>(`${this.baseUrl}/servers/${serverId}`, {
      method: "DELETE",
    });

    this.log(`Server deleted: ${serverId}`);
  }

  /**
   * Get details of a specific server
   * Maps Clouding status "Active" to "active"
   */
  async getServer(serverId: string): Promise<ServerInfo> {
    interface CloudingServerResponse {
      id: string;
      name: string;
      ip: string;
      status: string;
    }

    const response = await this.httpRequest<CloudingServerResponse>(
      `${this.baseUrl}/servers/${serverId}`
    );

    // Map Clouding status to standardized status
    const status = response.status === "Active" ? "active" : response.status.toLowerCase();

    return {
      id: response.id,
      name: response.name,
      ip: response.ip,
      status,
      region: "es",
    };
  }

  /**
   * Set PTR record for an IP
   * Clouding does not support PTR configuration via API
   */
  async setPTR(_params: PTRParams): Promise<void> {
    throw new Error(
      "PTR records must be set manually in Clouding.io panel. Not supported via API."
    );
  }

  /**
   * List available OS images on Clouding.io
   */
  async listImages(): Promise<Array<{ id: string; name: string }>> {
    interface CloudingImage {
      id: string;
      name: string;
    }

    interface CloudingImagesResponse {
      images: CloudingImage[];
    }

    const response = await this.httpRequest<CloudingImagesResponse>(
      `${this.baseUrl}/images`
    );

    return response.images.map((img) => ({
      id: img.id,
      name: img.name,
    }));
  }

  /**
   * List available regions
   * Clouding only supports Spain (Barcelona)
   */
  async listRegions(): Promise<Array<{ id: string; name: string }>> {
    return [
      {
        id: "es",
        name: "Spain (Barcelona)",
      },
    ];
  }

  /**
   * Test connection to Clouding.io API
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      interface CloudingServersResponse {
        servers?: unknown[];
      }

      await this.httpRequest<CloudingServersResponse>(`${this.baseUrl}/servers`);
      return {
        ok: true,
        message: "Successfully connected to Clouding.io API",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Failed to connect to Clouding.io API: ${errorMsg}`,
      };
    }
  }
}
