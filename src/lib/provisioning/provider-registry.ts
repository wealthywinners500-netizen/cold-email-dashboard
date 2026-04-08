import type { VPSProvider, VPSProviderType, DNSRegistrar, DNSRegistrarType } from "./types";

/**
 * Factory: get a VPS provider implementation by type.
 * Uses lazy imports to avoid initializing SDK clients at module scope (Hard Lesson #34).
 */
export async function getVPSProvider(
  type: VPSProviderType,
  config: Record<string, unknown>
): Promise<VPSProvider> {
  const apiKey = (config.apiKey as string) || "";
  const apiSecret = (config.apiSecret as string | null) ?? null;
  const extra = { ...config };

  switch (type) {
    case "clouding": {
      const { CloudingProvider } = await import("./providers/clouding");
      return new CloudingProvider(apiKey, apiSecret, extra);
    }
    case "digitalocean": {
      const { DigitalOceanProvider } = await import("./providers/digitalocean");
      return new DigitalOceanProvider(apiKey, apiSecret, extra);
    }
    case "hetzner": {
      const { HetznerProvider } = await import("./providers/hetzner");
      return new HetznerProvider(apiKey, apiSecret, extra);
    }
    case "vultr": {
      const { VultrProvider } = await import("./providers/vultr");
      return new VultrProvider(apiKey, apiSecret, extra);
    }
    case "linode": {
      const { LinodeProvider } = await import("./providers/linode");
      return new LinodeProvider(apiKey, apiSecret, extra);
    }
    case "contabo":
      throw new Error(
        `VPS provider "contabo" is not yet implemented. Coming in a future release.`
      );
    case "ovh":
      throw new Error(
        `VPS provider "ovh" is not yet implemented. Coming in a future release.`
      );
    case "custom":
      throw new Error(
        `Custom VPS provider requires manual configuration. Use SSH credentials directly.`
      );
    case "dry_run": {
      const { DryRunProvider } = await import("./providers/dry-run");
      return new DryRunProvider();
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown VPS provider type: ${_exhaustive}`);
    }
  }
}

/**
 * Factory: get a DNS registrar implementation by type.
 * Uses lazy imports to avoid initializing SDK clients at module scope (Hard Lesson #34).
 */
export async function getDNSRegistrar(
  type: DNSRegistrarType,
  config: Record<string, unknown>
): Promise<DNSRegistrar> {
  const apiKey = (config.apiKey as string) || "";
  const apiSecret = (config.apiSecret as string | null) ?? null;
  const extra = { ...config };

  switch (type) {
    case "ionos": {
      const { IonosRegistrar } = await import("./registrars/ionos");
      return new IonosRegistrar(apiKey, apiSecret, extra);
    }
    case "namecheap": {
      const { NamecheapRegistrar } = await import("./registrars/namecheap");
      return new NamecheapRegistrar(apiKey, apiSecret, extra);
    }
    case "cloudflare": {
      const { CloudflareRegistrar } = await import("./registrars/cloudflare");
      return new CloudflareRegistrar(apiKey, apiSecret, extra);
    }
    case "porkbun": {
      const { PorkbunRegistrar } = await import("./registrars/porkbun");
      return new PorkbunRegistrar(apiKey, apiSecret, extra);
    }
    case "godaddy":
      throw new Error(
        `DNS registrar "godaddy" is not yet implemented. Coming in a future release.`
      );
    case "namecom":
      throw new Error(
        `DNS registrar "namecom" is not yet implemented. Coming in a future release.`
      );
    case "dynadot":
      throw new Error(
        `DNS registrar "dynadot" is not yet implemented. Coming in a future release.`
      );
    case "custom":
      throw new Error(
        `Custom DNS registrar requires manual configuration.`
      );
    case "dry_run": {
      const { DryRunRegistrar } = await import("./providers/dry-run");
      return new DryRunRegistrar();
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown DNS registrar type: ${_exhaustive}`);
    }
  }
}

/**
 * Get a dry-run provider for testing.
 * Does not require API keys — simulates all operations.
 */
export async function getDryRunProviders(
  onLog?: (message: string) => void
): Promise<{ vps: VPSProvider; dns: DNSRegistrar }> {
  const { DryRunProvider, DryRunRegistrar } = await import("./providers/dry-run");
  return {
    vps: new DryRunProvider(onLog),
    dns: new DryRunRegistrar(onLog),
  };
}

/**
 * Display labels for provider/registrar types.
 */
export const VPS_PROVIDER_LABELS: Record<VPSProviderType, string> = {
  clouding: "Clouding.io",
  digitalocean: "DigitalOcean",
  hetzner: "Hetzner",
  vultr: "Vultr",
  linode: "Linode (Akamai)",
  contabo: "Contabo",
  ovh: "OVH",
  custom: "Custom / Self-Managed",
  dry_run: "Test Mode (Simulated)",
};

export const DNS_REGISTRAR_LABELS: Record<DNSRegistrarType, string> = {
  ionos: "IONOS (1&1)",
  namecheap: "Namecheap",
  godaddy: "GoDaddy",
  cloudflare: "Cloudflare",
  porkbun: "Porkbun",
  namecom: "Name.com",
  dynadot: "Dynadot",
  custom: "Custom / Self-Managed",
  dry_run: "Test Mode (Simulated)",
};

/**
 * Port 25 status info for known providers.
 */
export const PORT_25_INFO: Record<string, { status: string; note: string }> = {
  clouding: { status: "open", note: "Port 25 open by default on Clouding.io" },
  digitalocean: { status: "blocked_request", note: "Must request port 25 unblock via support ticket" },
  hetzner: { status: "blocked_request", note: "Blocked initially. Usually granted after request + 1 month account age" },
  vultr: { status: "blocked_request", note: "Must request port 25 unblock after first payment" },
  linode: { status: "open", note: "Port 25 open by default on Linode (Akamai) — RECOMMENDED" },
  contabo: { status: "open", note: "Port 25 open by default on Contabo" },
  ovh: { status: "open", note: "Port 25 open by default" },
  custom: { status: "unknown", note: "Check with your hosting provider" },
};
