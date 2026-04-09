import type {
  VPSProvider,
  VPSProviderType,
  DNSRegistrar,
  DNSRegistrarType,
  ServerCreateParams,
  ServerInfo,
  PTRParams,
  DNSRecordParams,
  DomainInfo,
} from "../types";

/**
 * Abstract base class for VPS providers.
 * Provides shared HTTP client setup, error handling, and retry logic.
 */
export abstract class BaseVPSProvider implements VPSProvider {
  abstract readonly providerType: VPSProviderType;
  protected apiKey: string;
  protected apiSecret: string | null;
  protected config: Record<string, unknown>;

  constructor(apiKey: string, apiSecret: string | null, config: Record<string, unknown>) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.config = config;
  }

  abstract createServer(params: ServerCreateParams): Promise<ServerInfo>;
  abstract deleteServer(serverId: string): Promise<void>;
  abstract getServer(serverId: string): Promise<ServerInfo>;
  abstract setPTR(params: PTRParams): Promise<void>;
  abstract listImages(): Promise<Array<{ id: string; name: string }>>;
  abstract listRegions(): Promise<Array<{ id: string; name: string }>>;
  abstract testConnection(): Promise<{ ok: boolean; message: string }>;

  /**
   * Make an authenticated HTTP request with retry logic.
   */
  protected async httpRequest<T>(
    url: string,
    options: RequestInit = {},
    retries: number = 2
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...this.getAuthHeaders(),
            ...options.headers,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `HTTP ${response.status} from ${this.providerType}: ${body}`
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          // Exponential backoff: 1s, 2s
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
        }
      }
    }

    throw lastError!;
  }

  /**
   * Override in subclass to provide provider-specific auth headers.
   */
  protected abstract getAuthHeaders(): Record<string, string>;

  /**
   * Log a provisioning step message.
   */
  protected log(message: string): void {
    console.log(`[VPS:${this.providerType}] ${message}`);
  }
}

/**
 * Abstract base class for DNS registrars.
 * Provides shared HTTP client setup, error handling, and retry logic.
 */
export abstract class BaseDNSRegistrar implements DNSRegistrar {
  abstract readonly registrarType: DNSRegistrarType;
  protected apiKey: string;
  protected apiSecret: string | null;
  protected config: Record<string, unknown>;

  constructor(apiKey: string, apiSecret: string | null, config: Record<string, unknown>) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.config = config;
  }

  abstract setNameservers(domain: string, nameservers: string[]): Promise<void>;
  abstract setGlueRecords(
    domain: string,
    records: Array<{ hostname: string; ip: string }>
  ): Promise<void>;
  abstract createZone(domain: string): Promise<void>;
  abstract createRecord(params: DNSRecordParams): Promise<{ id: string }>;
  abstract deleteRecord(zone: string, recordId: string): Promise<void>;
  abstract testConnection(): Promise<{ ok: boolean; message: string }>;

  /**
   * Default listDomains() — throws so existing providers
   * don't break until they implement their own version.
   */
  async listDomains(): Promise<DomainInfo[]> {
    throw new Error(
      `listDomains() is not implemented for registrar type "${this.registrarType}". ` +
        `This registrar does not support domain auto-pull.`
    );
  }

  /**
   * Make an authenticated HTTP request with retry logic.
   */
  protected async httpRequest<T>(
    url: string,
    options: RequestInit = {},
    retries: number = 2
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...this.getAuthHeaders(),
            ...options.headers,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `HTTP ${response.status} from ${this.registrarType}: ${body}`
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1))
          );
        }
      }
    }

    throw lastError!;
  }

  /**
   * Override in subclass to provide registrar-specific auth headers.
   */
  protected abstract getAuthHeaders(): Record<string, string>;

  /**
   * Log a provisioning step message.
   */
  protected log(message: string): void {
    console.log(`[DNS:${this.registrarType}] ${message}`);
  }
}
