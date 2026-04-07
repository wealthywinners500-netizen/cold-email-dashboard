import { BaseVPSProvider } from './base';
import type { ServerCreateParams, ServerInfo, PTRParams } from '../types';
import type { VPSProviderType } from '../types';

interface VultrInstance {
  id: string;
  label: string;
  main_ip: string;
  status?: string;
  power_status?: string;
  server_status?: string;
  region: string;
}

interface VultrInstanceResponse {
  instance: VultrInstance;
}

interface VultrInstancesResponse {
  instances: VultrInstance[];
}

interface VultrOSResponse {
  os: Array<{
    id: number;
    name: string;
    family: string;
  }>;
}

interface VultrRegionsResponse {
  regions: Array<{
    id: string;
    city: string;
    country: string;
  }>;
}

interface VultrAccountResponse {
  account?: {
    email: string;
  };
}

export class VultrProvider extends BaseVPSProvider {
  readonly providerType: VPSProviderType = 'vultr';
  private readonly baseUrl = 'https://api.vultr.com/v2';

  static readonly port_25_note = 'Port 25: Blocked by default. Support ticket required — frequently denied.';

  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    this.log(`Creating Vultr server: ${params.name} in region ${params.region}`);

    const body: Record<string, unknown> = {
      label: params.name,
      region: params.region,
      plan: params.size,
      os_id: params.image ? parseInt(params.image, 10) : 1743, // Default: Ubuntu 22.04
    };

    // Add startup script if provided
    if (this.config.script_id) {
      body.script_id = this.config.script_id;
    }

    // Add SSH key if provided
    if (params.sshKeyId) {
      body.sshkey_id = [params.sshKeyId];
    }

    const response = await this.httpRequest<VultrInstanceResponse>(
      `${this.baseUrl}/instances`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    const instance = response.instance;
    return {
      id: instance.id,
      name: instance.label,
      ip: instance.main_ip,
      status: instance.status || 'pending',
      region: instance.region,
    };
  }

  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting Vultr server: ${serverId}`);

    await this.httpRequest<void>(
      `${this.baseUrl}/instances/${serverId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );
  }

  async getServer(serverId: string): Promise<ServerInfo> {
    this.log(`Fetching Vultr server: ${serverId}`);

    const response = await this.httpRequest<VultrInstanceResponse>(
      `${this.baseUrl}/instances/${serverId}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    const instance = response.instance;

    // Map status: "active" + power_status "running" → "active"
    let status = instance.status || 'unknown';
    if (instance.status === 'active' && instance.power_status === 'running') {
      status = 'active';
    }

    return {
      id: instance.id,
      name: instance.label,
      ip: instance.main_ip,
      status,
      region: instance.region,
    };
  }

  async setPTR(params: PTRParams): Promise<void> {
    this.log(`Setting PTR record for ${params.ip} to ${params.hostname}`);

    // Find instance by IP
    const instances = await this.httpRequest<VultrInstancesResponse>(
      `${this.baseUrl}/instances`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    const instance = instances.instances.find((inst) => inst.main_ip === params.ip);
    if (!instance) {
      throw new Error(`No Vultr instance found with IP ${params.ip}`);
    }

    await this.httpRequest<void>(
      `${this.baseUrl}/instances/${instance.id}/ipv4/reverse`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          ip: params.ip,
          reverse: params.hostname,
        }),
      }
    );
  }

  async listImages(): Promise<Array<{ id: string; name: string }>> {
    this.log('Listing Vultr OS images');

    const response = await this.httpRequest<VultrOSResponse>(
      `${this.baseUrl}/os`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.os.map((os) => ({
      id: os.id.toString(),
      name: os.name,
    }));
  }

  async listRegions(): Promise<Array<{ id: string; name: string }>> {
    this.log('Listing Vultr regions');

    const response = await this.httpRequest<VultrRegionsResponse>(
      `${this.baseUrl}/regions`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.regions.map((region) => ({
      id: region.id,
      name: `${region.city}, ${region.country}`,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    this.log('Testing Vultr API connection');

    try {
      const response = await this.httpRequest<VultrAccountResponse>(
        `${this.baseUrl}/account`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );

      if (response.account) {
        return { ok: true, message: `Connected to Vultr account` };
      }

      return { ok: false, message: 'Invalid account response' };
    } catch (error) {
      return {
        ok: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
