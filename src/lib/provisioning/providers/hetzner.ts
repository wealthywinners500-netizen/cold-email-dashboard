import { BaseVPSProvider } from './base';
import { ServerCreateParams, ServerInfo, PTRParams, VPSProviderType } from '../types';

interface HetznerServerResponse {
  server: {
    id: number;
    name: string;
    status: string;
    public_net: {
      ipv4: {
        ip: string;
      };
    };
    datacenter: {
      location: {
        name: string;
      };
    };
  };
}

interface HetznerServersListResponse {
  servers: Array<{
    id: number;
    name: string;
    status: string;
    public_net: {
      ipv4: {
        ip: string;
      };
    };
    datacenter: {
      location: {
        name: string;
      };
    };
  }>;
}

interface HetznerImageResponse {
  images: Array<{
    id: number;
    name: string;
    description: string;
  }>;
}

interface HetznerLocationResponse {
  locations: Array<{
    id: number;
    name: string;
    description: string;
    city: string;
  }>;
}

interface HetznerCreateServerBody {
  name: string;
  server_type: string;
  image: string;
  location: string;
  user_data?: string;
  ssh_keys?: number[];
  automount?: boolean;
}

interface HetznerPTRBody {
  ip: string;
  dns_ptr: string;
}

export class HetznerProvider extends BaseVPSProvider {
  static readonly port_25_note =
    'Port 25: Blocked initially. Usually granted after submitting request + 1 month account age.';

  readonly providerType: VPSProviderType = 'hetzner';
  private readonly baseUrl = 'https://api.hetzner.cloud/v1';

  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    this.log(`Creating server: ${params.name} in region ${params.region}`);

    const body: HetznerCreateServerBody = {
      name: params.name,
      server_type: params.size,
      image: params.image || 'ubuntu-22.04',
      location: params.region,
    };

    if (this.config?.user_data) {
      body.user_data = this.config.user_data as string;
    }

    if (params.sshKeyId) {
      body.ssh_keys = [parseInt(params.sshKeyId, 10)];
    }

    const response = await this.httpRequest<HetznerServerResponse>(
      `${this.baseUrl}/servers`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    return this.mapServerResponse(response.server);
  }

  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting server: ${serverId}`);

    await this.httpRequest<void>(
      `${this.baseUrl}/servers/${serverId}`,
      {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }
    );
  }

  async getServer(serverId: string): Promise<ServerInfo> {
    this.log(`Fetching server: ${serverId}`);

    const response = await this.httpRequest<HetznerServerResponse>(
      `${this.baseUrl}/servers/${serverId}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return this.mapServerResponse(response.server);
  }

  async setPTR(params: PTRParams): Promise<void> {
    this.log(`Setting PTR for IP ${params.ip} to ${params.hostname}`);

    // Look up server by IP to find the server ID
    const serverId = await this.findServerByIP(params.ip);
    if (!serverId) {
      throw new Error(`Server not found for IP: ${params.ip}`);
    }

    const body: HetznerPTRBody = {
      ip: params.ip,
      dns_ptr: params.hostname,
    };

    await this.httpRequest<void>(
      `${this.baseUrl}/servers/${serverId}/actions/change_dns_ptr`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );
  }

  async listImages(): Promise<Array<{ id: string; name: string; description: string }>> {
    this.log('Fetching available images');

    const response = await this.httpRequest<HetznerImageResponse>(
      `${this.baseUrl}/images?type=system`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.images.map((img) => ({
      id: String(img.id),
      name: img.name,
      description: img.description,
    }));
  }

  async listRegions(): Promise<Array<{ id: string; name: string; description: string }>> {
    this.log('Fetching available regions');

    const response = await this.httpRequest<HetznerLocationResponse>(
      `${this.baseUrl}/locations`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    return response.locations.map((loc) => ({
      id: String(loc.id),
      name: loc.name,
      description: `${loc.city} - ${loc.description}`,
    }));
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    this.log('Testing connection to Hetzner API');

    try {
      await this.httpRequest<HetznerServersListResponse>(
        `${this.baseUrl}/servers`,
        {
          method: 'GET',
          headers: this.getAuthHeaders(),
        }
      );
      return { ok: true, message: 'Hetzner API connection successful' };
    } catch (error) {
      this.log(`Connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async findServerByIP(ip: string): Promise<string | null> {
    const response = await this.httpRequest<HetznerServersListResponse>(
      `${this.baseUrl}/servers`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    const server = response.servers.find((s) => s.public_net.ipv4.ip === ip);
    return server ? String(server.id) : null;
  }

  private mapServerResponse(
    hServer: HetznerServerResponse['server']
  ): ServerInfo {
    return {
      id: String(hServer.id),
      name: hServer.name,
      ip: hServer.public_net.ipv4.ip,
      status: hServer.status === 'running' ? 'active' : hServer.status,
      region: hServer.datacenter.location.name,
    };
  }
}

export default HetznerProvider;
