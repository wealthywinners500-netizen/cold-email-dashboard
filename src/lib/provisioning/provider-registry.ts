import type { VPSProvider, VPSProviderType, DNSRegistrar, DNSRegistrarType } from "./types";

/**
 * Factory: get a VPS provider implementation by type.
 * Uses lazy imports to avoid initializing SDK clients at module scope (Hard Lesson #34).
 */
export async function getVPSProvider(
  type: VPSProviderType,
  config: Record<string, unknown>
): Promise<VPSProvider> {
  switch (type) {
    case "clouding":
      // TODO B15-2: implement CloudingProvider
      throw new Error(
        `VPS provider "clouding" is not yet implemented. Coming in B15 Phase 2.`
      );
    case "digitalocean":
      throw new Error(
        `VPS provider "digitalocean" is not yet implemented.`
      );
    case "hetzner":
      throw new Error(
        `VPS provider "hetzner" is not yet implemented.`
      );
    case "vultr":
      throw new Error(
        `VPS provider "vultr" is not yet implemented.`
      );
    case "linode":
      throw new Error(
        `VPS provider "linode" is not yet implemented.`
      );
    case "contabo":
      throw new Error(
        `VPS provider "contabo" is not yet implemented.`
      );
    case "ovh":
      throw new Error(
        `VPS provider "ovh" is not yet implemented.`
      );
    case "custom":
      throw new Error(
        `Custom VPS provider requires manual configuration. Use SSH credentials directly.`
      );
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
  switch (type) {
    case "ionos":
      // TODO B15-2: implement IonosDNSRegistrar
      throw new Error(
        `DNS registrar "ionos" is not yet implemented. Coming in B15 Phase 2.`
      );
    case "namecheap":
      throw new Error(
        `DNS registrar "namecheap" is not yet implemented.`
      );
    case "godaddy":
      throw new Error(
        `DNS registrar "godaddy" is not yet implemented.`
      );
    case "cloudflare":
      throw new Error(
        `DNS registrar "cloudflare" is not yet implemented.`
      );
    case "porkbun":
      throw new Error(
        `DNS registrar "porkbun" is not yet implemented.`
      );
    case "namecom":
      throw new Error(
        `DNS registrar "namecom" is not yet implemented.`
      );
    case "dynadot":
      throw new Error(
        `DNS registrar "dynadot" is not yet implemented.`
      );
    case "custom":
      throw new Error(
        `Custom DNS registrar requires manual configuration.`
      );
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown DNS registrar type: ${_exhaustive}`);
    }
  }
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
};

/**
 * Port 25 status info for known providers.
 */
export const PORT_25_INFO: Record<string, { status: string; note: string }> = {
  clouding: { status: "open", note: "Port 25 open by default on Clouding.io" },
  digitalocean: { status: "blocked_request", note: "Must request port 25 unblock via support ticket" },
  hetzner: { status: "open", note: "Port 25 open by default" },
  vultr: { status: "blocked_request", note: "Must request port 25 unblock after first payment" },
  linode: { status: "blocked_request", note: "Must open support ticket to unblock port 25" },
  contabo: { status: "open", note: "Port 25 open by default on Contabo" },
  ovh: { status: "open", note: "Port 25 open by default" },
  custom: { status: "unknown", note: "Check with your hosting provider" },
};
