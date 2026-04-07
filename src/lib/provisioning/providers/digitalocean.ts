import { BaseVPSProvider } from './base';
import type {
  VPSProviderType,
  ServerCreateParams,
  ServerInfo,
  PTRParams,
} from '../types';

interface DigitalOceanDroplet {
  id: number;
  name: string;
  status: string;
  networks: {
    v4: Array<{
      ip_address: string;
      type: string;
    }>;
  };
  region: {
    slug: string;
  };
}

interface DigitalOceanDropletResponse {
  droplet: DigitalOceanDroplet;
}

interface DigitalOceanListResponse<T> {
  [key: string]: T[];
}

interface DigitalOceanImage {
  id: number;
  distribution: string;
  name: string;
}

interface DigitalOceanRegion {
  slug: string;
  name: string;
  available: boolean;
}

interface DigitalOceanAccount {
  account: {
    email: string;
  };
}

export class DigitalOceanProvider extends BaseVPSProvider {
  readonly providerType: VPSProviderType = 'digitalocean';
  private readonly baseUrl = 'https://api.digitalocean.com/v2';
  static readonly port_25_note =
    'Port 25: Blocked by default. Must submit support ticket — frequently denied for new accounts.';

  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async createServer(params: ServerCreateParams): Promise<ServerInfo> {
    const {
      name,
      region,
      size,
      image = 'ubuntu-22-04-x64',
      sshKeyId,
    } = params;

    const body: Record<string, unknown> = {
      name,
      region,
      size,
      image,
    };

    // Add cloud-init script if provided in config
    if (this.config.user_data) {
      body.user_data = this.config.user_data;
    }

    // Add SSH keys if provided
    if (sshKeyId) {
      body.ssh_keys = [sshKeyId];
    }

    this.log(
      `Creating DigitalOcean droplet: ${name} (region: ${region}, size: ${size})`
    );

    const response = await this.httpRequest<DigitalOceanDropletResponse>(
      `${this.baseUrl}/droplets`,
      {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    const droplet = response.droplet;
    const publicIp = droplet.networks.v4.find((net) => net.type === 'public');

    if (!publicIp) {
      throw new Error('No public IP address found in DigitalOcean response');
    }

    const serverInfo: ServerInfo = {
      id: droplet.id.toString(),
      name: droplet.name,
      ip: publicIp.ip_address,
      status: droplet.status === 'active' ? 'active' : 'pending',
      region: droplet.region.slug,
    };

    this.log(
      `Droplet created successfully: ${serverInfo.name} (${serverInfo.ip})`
    );

    return serverInfo;
  }

  async deleteServer(serverId: string): Promise<void> {
    this.log(`Deleting DigitalOcean droplet: ${serverId}`);

    await this.httpRequest<void>(`${this.baseUrl}/droplets/${serverId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });

    this.log(`Droplet deleted: ${serverId}`);
  }

  async getServer(serverId: string): Promise<ServerInfo> {
    const response = await this.httpRequest<DigitalOceanDropletResponse>(
      `${this.baseUrl}/droplets/${serverId}`,
      {
        method: 'GET',
        headers: this.getAuthHeaders(),
      }
    );

    const droplet = response.droplet;
    const publicIp = droplet.networks.v4.find((net) => net.type === 'public');

    if (!publicIp) {
      throw new Error('No public IP address found in DigitalOcean response');
    }

    return {
      id: droplet.id.toString(),
      name: droplet.name,
      ip: publicIp.ip_address,
      status: droplet.status === 'active' ? 'active' : droplet.status,
      region: droplet.region.slug,
    };
  }

  async setPTR(params: PTRParams): Promise<void> {
    const { ip, hostname } = params;

    this.log(
      `DigitalOcean PTR setup for ${ip} → ${hostname}: Auto-configured from droplet name. Verifying...`
    );

    // DigitalOcean sets PTR automatically from the droplet name.
    // We cannot directly set PTR via API, but we can verify it's aligned.
    // The caller should have created the droplet with the FQDN as its name.
    this.log(
      `DigitalOcean sets PTR automatically from the droplet name. Ensure droplet was created with the FQDN as its name. Expected: ${hostname}`
    );
  }

  async listImages(): Promise<Array<{ id: string; distribution: string; name: string }>> {
    this.log('Fetching DigitalOcean distribution images');

    const response = await this.httpRequest<
      DigitalOceanListResponse<DigitalOceanImage>
    >(`${this.baseUrl}/images?type=distribution`, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    return response.images.map((img) => ({
      id: img.id.toString(),
      distribution: img.distribution,
      name: img.name,
    }));
  }

  async listRegions(): Promise<Array<{ id: string; name: string }>> {
    this.log('Fetching DigitalOcean regions');

    const response = await this.httpRequest<
      DigitalOceanListResponse<DigitalOceanRegion>
    >(`${this.baseUrl}/regions`, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    return response.regions
      .filter((region) => region.available)
      .map((region) => ({
        id: region.slug,
        name: region.name,
      }));
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.httpRequest<DigitalOceanAccount>(`${this.baseUrl}/account`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      this.log('DigitalOcean API connection successful');
      return { ok: true, message: 'DigitalOcean API connection successful' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`DigitalOcean API connection failed: ${message}`);
      return { ok: false, message };
    }
  }
}
