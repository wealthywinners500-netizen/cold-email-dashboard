import { BaseVPSProvider } from './base';
import type { ServerCreateParams, ServerInfo, PTRParams } from '../types';
import type { VPSProviderType } from '../types';

interface LinodeInstance {
  id: number;
  label: string;
  ipv4: string[];
  status: string;
  region: string;
}

interface LinodeInstanceResponse {
  id: number;
  label: string;
  ipv4: string[];
  status: string;
  region: string;
}

interface LinodeImage {
  id: string;
  label: string;
}

interface LinodeImagesResponse {
  data: LinodeImage[];
}

interface LinodeRegion {
  id: string;
  label: string;
  country: string;
}

interface LinodeRegionsResponse {
  data: LinodeRegion[];
}

interface LinodeAccountResponse {
  email: string;
}

interface LinodeStackScriptResponse {
  id: number;
  label: string;
}

/**
 * Linode (Akamai) provider implementation.
 * Port 25 is OPEN by default — ideal for cold email infrastructure.
 */
export class LinodeProvider extends BaseVPSProvider {
  readonly providerType: VPSProviderType = 'linode';
  private readonly baseUrl = 'https://api.linode.com/v4';

  static readonly port_25_note = 'Port 25: OPEN by default. Recommended provider for cold email infrastructure.';

  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    this.log(`Creating Linode instance: ${params.name} in region ${params.region}`);

    const body: Record<string, unknown> = {
      label: params.name,
      region: params.region,
      type: params.size,
      image: params.image || 'linode/ubuntu22.04',
      root_pass: (this.config.rootPassword as string) || this.generateRandomPassword(),
    };

    // Add StackScript if configured
    if (this.config.stackscript_id) {
      body.stackscript_id = this.config.stackscript_id;
    }

    if (this.config.stackscript_data) {
      body.stackscript_data = this.config.stackscript_data;
    }

    // Add SSH key if provided
    if (params.sshKeyId) {
      body.authorized_keys = [params.sshKeyId];
    }

    const response = await this.httpRequest<LinodeInstanceResponse>(
      `${this.baseUrl}/linode/instances`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    return {
      id: response.id.toString(),
      name: response.label,
      ip: response.ipv4[0],
      status: response.status === 'running' ? 'active' : response.status,
      region: response.region,
    };
  }

  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting Linode instance: ${serverId}`);

    await this.httpRequest<void>(
      `${this.baseUrl}/linode/instances/${serverId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );
  }

  async getServer(serverId: string): Promise<ServerInfo> {
    this.log(`Fetching Linode instance: ${serverId}`);

    const response = await this.httpRequest<LinodeInstanceResponse>(
      `${this.baseUrl}/linode/instances/${serverId}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    // Map Linode status "running" to "active"
    const status = response.status === 'running' ? 'active' : response.status;

    return {
      id: response.id.toString(),
      name: response.label,
      ip: response.ipv4[0],
      status,
      region: response.region,
    };
  }

  async setPTR(params: PTRParams): Promise<void> {
    this.log(`Setting PTR record for ${params.ip} to ${params.hostname}`);

    // Linode has a dedicated reverse DNS API endpoint
    await this.httpRequest<void>(
      `${this.baseUrl}/networking/ips/${params.ip}`,
      {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          rdns: params.hostname,
        }),
      }
    );
  }

  async listImages(): Promise<Array<{ id: string; name: string }>> {
    this.log('Listing Linode images');

    const response = await this.httpRequest<LinodeImagesResponse>(
      `${this.baseUrl}/images`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.data.map((image) => ({
      id: image.id,
      name: image.label,
    }));
  }

  async listRegions(): Promise<Array<{ id: string; name: string }>> {
    this.log('Listing Linode regions');

    const response = await this.httpRequest<LinodeRegionsResponse>(
      `${this.baseUrl}/regions`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.data.map((region) => ({
      id: region.id,
      name: `${region.label} (${region.country})`,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    this.log('Testing Linode API connection');

    try {
      const response = await this.httpRequest<LinodeAccountResponse>(
        `${this.baseUrl}/account`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (response.email) {
        return { ok: true, message: `Connected to Linode account: ${response.email}` };
      }

      return { ok: false, message: 'Invalid account response' };
    } catch (error) {
      return {
        ok: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a StackScript for automated HestiaCP installation.
   * Returns the StackScript ID for use in createServer().
   */
  async createStackScript(
    label: string,
    bashScript: string,
    images: string[] = ['linode/ubuntu22.04']
  ): Promise<number> {
    this.log(`Creating Linode StackScript: ${label}`);

    const response = await this.httpRequest<LinodeStackScriptResponse>(
      `${this.baseUrl}/linode/stackscripts`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          label,
          images,
          script: bashScript,
          is_public: false,
        }),
      }
    );

    this.log(`StackScript created with ID: ${response.id}`);
    return response.id;
  }

  /**
   * Generate a random secure password for root_pass.
   */
  private generateRandomPassword(): string {
    const length = 24;
    const charset =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }
}
