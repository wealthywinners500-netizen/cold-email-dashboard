"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Server,
  Globe,
  Plus,
  Trash2,
  TestTube,
  Loader2,
  CheckCircle,
  XCircle,
  Star,
} from "lucide-react";

const VPS_PROVIDER_TYPES = [
  { value: "clouding", label: "Clouding.io" },
  { value: "digitalocean", label: "DigitalOcean" },
  { value: "hetzner", label: "Hetzner" },
  { value: "vultr", label: "Vultr" },
  { value: "linode", label: "Linode (Akamai)" },
  { value: "contabo", label: "Contabo" },
  { value: "ovh", label: "OVH" },
  { value: "custom", label: "Custom / Self-Managed" },
] as const;

const DNS_REGISTRAR_TYPES = [
  { value: "ionos", label: "IONOS (1&1)" },
  { value: "namecheap", label: "Namecheap" },
  { value: "godaddy", label: "GoDaddy" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "porkbun", label: "Porkbun" },
  { value: "namecom", label: "Name.com" },
  { value: "dynadot", label: "Dynadot" },
  { value: "custom", label: "Custom / Self-Managed" },
] as const;

const PORT_25_COLORS: Record<string, string> = {
  open: "bg-green-900 text-green-200",
  blocked_request: "bg-yellow-900 text-yellow-200",
  blocked_self_service: "bg-yellow-900 text-yellow-200",
  frequently_denied: "bg-red-900 text-red-200",
  unknown: "bg-gray-800 text-gray-400",
};

interface ProviderItem {
  id: string;
  name: string;
  provider_type?: string;
  registrar_type?: string;
  api_key_encrypted: string | null;
  api_secret_encrypted: string | null;
  is_default: boolean;
  port_25_status?: string;
  config: Record<string, unknown>;
  created_at: string;
}

interface TestResult {
  ok: boolean;
  message: string;
}

function ProviderCard({
  item,
  type,
  onDelete,
  onTest,
}: {
  item: ProviderItem;
  type: "vps" | "dns";
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      onTest(item.id);
      const endpoint =
        type === "vps"
          ? `/api/vps-providers/${item.id}`
          : `/api/dns-registrars/${item.id}`;
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: "Network error" });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const endpoint =
        type === "vps"
          ? `/api/vps-providers/${item.id}`
          : `/api/dns-registrars/${item.id}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        onDelete(item.id);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete");
      }
    } catch {
      alert("Network error");
    } finally {
      setDeleting(false);
    }
  };

  const providerLabel =
    type === "vps"
      ? VPS_PROVIDER_TYPES.find((t) => t.value === item.provider_type)?.label ||
        item.provider_type
      : DNS_REGISTRAR_TYPES.find((t) => t.value === item.registrar_type)?.label ||
        item.registrar_type;

  return (
    <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-white font-medium">{item.name}</p>
            {item.is_default && (
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            )}
          </div>
          <p className="text-gray-400 text-sm">{providerLabel}</p>
        </div>
        {type === "vps" && item.port_25_status && (
          <Badge
            className={
              PORT_25_COLORS[item.port_25_status] || PORT_25_COLORS.unknown
            }
          >
            Port 25: {item.port_25_status.replace(/_/g, " ")}
          </Badge>
        )}
        <Badge className={item.api_key_encrypted ? "bg-green-900 text-green-200" : "bg-gray-800 text-gray-400"}>
          {item.api_key_encrypted ? "Key set" : "No key"}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {testResult && (
          <span className="flex items-center gap-1 text-xs mr-2">
            {testResult.ok ? (
              <CheckCircle className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-red-400" />
            )}
            <span className={testResult.ok ? "text-green-400" : "text-red-400"}>
              {testResult.message.slice(0, 60)}
            </span>
          </span>
        )}
        <button
          onClick={handleTest}
          disabled={testing}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
        >
          {testing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <TestTube className="w-3 h-3" />
          )}
          Test
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded-md disabled:opacity-50 flex items-center gap-1"
        >
          {deleting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
          Delete
        </button>
      </div>
    </div>
  );
}

function AddProviderForm({
  type,
  onAdded,
}: {
  type: "vps" | "dns";
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const typeOptions = type === "vps" ? VPS_PROVIDER_TYPES : DNS_REGISTRAR_TYPES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const endpoint =
        type === "vps" ? "/api/vps-providers" : "/api/dns-registrars";
      const body: Record<string, unknown> = {
        name,
        [type === "vps" ? "provider_type" : "registrar_type"]: providerType,
        api_key: apiKey || undefined,
        api_secret: apiSecret || undefined,
        is_default: isDefault,
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setOpen(false);
        setName("");
        setProviderType("");
        setApiKey("");
        setApiSecret("");
        setIsDefault(false);
        onAdded();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save");
      }
    } catch {
      alert("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 border-dashed"
      >
        <Plus className="w-4 h-4" />
        Add {type === "vps" ? "VPS Provider" : "DNS Registrar"}
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-gray-800/50 rounded-lg space-y-4 border border-gray-700"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "vps" ? "e.g. My Clouding Account" : "e.g. My IONOS Account"}
            required
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            {type === "vps" ? "Provider" : "Registrar"}
          </label>
          <select
            value={providerType}
            onChange={(e) => setProviderType(e.target.value)}
            required
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">Select...</option>
            {typeOptions.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Optional — enter to enable automation"
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">API Secret</label>
          <input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="Optional — for providers needing key + secret"
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`default-${type}`}
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="rounded border-gray-600"
        />
        <label htmlFor={`default-${type}`} className="text-sm text-gray-400">
          Set as default {type === "vps" ? "provider" : "registrar"}
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ProvidersSection() {
  const [vpsProviders, setVpsProviders] = useState<ProviderItem[]>([]);
  const [dnsRegistrars, setDnsRegistrars] = useState<ProviderItem[]>([]);
  const [loadingVps, setLoadingVps] = useState(true);
  const [loadingDns, setLoadingDns] = useState(true);

  const fetchVps = useCallback(async () => {
    try {
      const res = await fetch("/api/vps-providers");
      if (res.ok) {
        const data = await res.json();
        setVpsProviders(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingVps(false);
    }
  }, []);

  const fetchDns = useCallback(async () => {
    try {
      const res = await fetch("/api/dns-registrars");
      if (res.ok) {
        const data = await res.json();
        setDnsRegistrars(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoadingDns(false);
    }
  }, []);

  useEffect(() => {
    fetchVps();
    fetchDns();
  }, [fetchVps, fetchDns]);

  return (
    <>
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Server className="w-5 h-5" />
            VPS Providers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-400 text-sm">
            Configure your VPS hosting providers for automated server
            provisioning. API keys are encrypted at rest.
          </p>
          <Separator className="bg-gray-800" />
          {loadingVps ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading providers...
            </div>
          ) : vpsProviders.length === 0 ? (
            <p className="text-gray-500 text-sm py-2">
              No VPS providers configured yet.
            </p>
          ) : (
            <div className="space-y-2">
              {vpsProviders.map((p) => (
                <ProviderCard
                  key={p.id}
                  item={p}
                  type="vps"
                  onDelete={(id) =>
                    setVpsProviders((prev) =>
                      prev.filter((x) => x.id !== id)
                    )
                  }
                  onTest={() => fetchVps()}
                />
              ))}
            </div>
          )}
          <AddProviderForm type="vps" onAdded={fetchVps} />
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Globe className="w-5 h-5" />
            DNS Registrars
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-400 text-sm">
            Configure your DNS registrars for automated domain setup. API keys
            are encrypted at rest.
          </p>
          <Separator className="bg-gray-800" />
          {loadingDns ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading registrars...
            </div>
          ) : dnsRegistrars.length === 0 ? (
            <p className="text-gray-500 text-sm py-2">
              No DNS registrars configured yet.
            </p>
          ) : (
            <div className="space-y-2">
              {dnsRegistrars.map((r) => (
                <ProviderCard
                  key={r.id}
                  item={r}
                  type="dns"
                  onDelete={(id) =>
                    setDnsRegistrars((prev) =>
                      prev.filter((x) => x.id !== id)
                    )
                  }
                  onTest={() => fetchDns()}
                />
              ))}
            </div>
          )}
          <AddProviderForm type="dns" onAdded={fetchDns} />
        </CardContent>
      </Card>
    </>
  );
}
