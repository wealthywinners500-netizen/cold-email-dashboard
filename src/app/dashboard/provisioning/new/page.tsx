"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket,
  ArrowLeft,
  ArrowRight,
  Check,
  Server,
  Globe,
  Settings,
  AlertTriangle,
  Loader2,
  Eye,
} from "lucide-react";
import { DomainInput, type DomainStatus, type RegistrarOption } from "@/components/provisioning/domain-input";
import type { VPSProviderRow, DNSRegistrarRow, VPSProviderType } from "@/lib/provisioning/types";

// Port 25 status by provider
const PORT_25_STATUS: Record<string, { status: "open" | "manual" | "blocked"; label: string }> = {
  linode: { status: "open", label: "Port 25 open by default" },
  contabo: { status: "open", label: "Port 25 open by default" },
  clouding: { status: "manual", label: "Manual unblock required" },
  hetzner: { status: "manual", label: "Manual unblock required" },
  digitalocean: { status: "blocked", label: "Frequently denied — not recommended for email" },
  vultr: { status: "blocked", label: "Frequently denied — not recommended for email" },
  ovh: { status: "manual", label: "Manual unblock required" },
  custom: { status: "manual", label: "Check provider documentation" },
};

function Port25Indicator({ providerType }: { providerType: string }) {
  const info = PORT_25_STATUS[providerType] || PORT_25_STATUS.custom;
  const colors = {
    open: "text-green-400",
    manual: "text-yellow-400",
    blocked: "text-red-400",
  };
  const icons = {
    open: "🟢",
    manual: "🟡",
    blocked: "🔴",
  };
  return (
    <span className={`text-xs flex items-center gap-1.5 ${colors[info.status]}`}>
      <span>{icons[info.status]}</span>
      {info.label}
    </span>
  );
}

interface Region {
  id: string;
  name: string;
  slug: string;
  available: boolean;
}

const WIZARD_STEPS = [
  { label: "VPS Provider", icon: Server },
  { label: "DNS & Domains", icon: Globe },
  { label: "Configuration", icon: Settings },
  { label: "Launch", icon: Rocket },
];

export default function NewProvisioningPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  // Step 1 state
  const [providers, setProviders] = useState<VPSProviderRow[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  // Hard lesson #45 (2026-04-10): Secondary region must differ from primary for
  // MXToolbox reputation (/24 subnet diversity). Empty string = same as primary.
  const [selectedSecondaryRegion, setSelectedSecondaryRegion] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("small");
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingRegions, setLoadingRegions] = useState(false);

  // Step 2 state
  const [registrars, setRegistrars] = useState<DNSRegistrarRow[]>([]);
  const [selectedRegistrar, setSelectedRegistrar] = useState<string>("");
  const [nsDomain, setNsDomain] = useState<string>("");
  const [domains, setDomains] = useState<DomainStatus[]>([]);
  const [loadingRegistrars, setLoadingRegistrars] = useState(true);

  // Step 3 state
  const [mailAccountStyle, setMailAccountStyle] = useState<"random_names" | "custom">("random_names");
  const [accountsPerDomain, setAccountsPerDomain] = useState<number>(3);
  const [customPrefixes, setCustomPrefixes] = useState<string>("");
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [previewNames, setPreviewNames] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Fetch providers
  useEffect(() => {
    async function load() {
      try {
        const [provRes, regRes] = await Promise.all([
          fetch("/api/vps-providers"),
          fetch("/api/dns-registrars"),
        ]);
        if (provRes.ok) setProviders(await provRes.json());
        if (regRes.ok) setRegistrars(await regRes.json());
      } catch {
        // silently fail
      } finally {
        setLoadingProviders(false);
        setLoadingRegistrars(false);
      }
    }
    load();
  }, []);

  // Fetch regions when provider changes
  useEffect(() => {
    if (!selectedProvider) {
      setRegions([]);
      return;
    }

    // For dry_run providers, skip API call and use demo region
    const providerObj = providers.find((p) => p.id === selectedProvider);
    if (providerObj?.provider_type === "dry_run") {
      setRegions([{ id: "demo-dc-1", name: "Demo Datacenter", slug: "demo", available: true }]);
      setSelectedRegion("demo-dc-1");
      setLoadingRegions(false);
      return;
    }

    setLoadingRegions(true);
    setSelectedRegion("");
    setSelectedSecondaryRegion("");
    fetch(`/api/vps-providers/${selectedProvider}/regions`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setRegions(data))
      .catch(() => setRegions([]))
      .finally(() => setLoadingRegions(false));
  }, [selectedProvider, providers]);

  const selectedProviderObj = providers.find((p) => p.id === selectedProvider);
  const selectedRegistrarObj = registrars.find((r) => r.id === selectedRegistrar);

  // Generate preview names
  const generatePreviewNames = useCallback(() => {
    const firstNames = ["sarah", "james", "emily", "michael", "jessica", "david", "ashley", "robert"];
    const lastNames = ["mitchell", "cooper", "bennett", "murphy", "parker", "reed", "morgan", "clark"];
    const names: string[] = [];
    const used = new Set<string>();
    for (let i = 0; i < Math.min(accountsPerDomain, 5); i++) {
      let name = "";
      do {
        const f = firstNames[Math.floor(Math.random() * firstNames.length)];
        const l = lastNames[Math.floor(Math.random() * lastNames.length)];
        name = `${f}.${l}`;
      } while (used.has(name));
      used.add(name);
      names.push(name);
    }
    setPreviewNames(names);
    setShowPreview(true);
  }, [accountsPerDomain]);

  // Validation per step
  const canProceedStep0 = selectedProvider && selectedRegion && selectedSize;
  const canProceedStep1 = selectedRegistrar && nsDomain.trim() && domains.length > 0 && !domains.some((d) => d.clean === false);
  const canProceedStep2 = true; // Config step always valid
  const allDomainsChecked = domains.length > 0 && domains.every((d) => d.clean !== null);

  const canProceed = [canProceedStep0, canProceedStep1, canProceedStep2, confirmChecked][currentStep];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        vps_provider_id: selectedProvider,
        dns_registrar_id: selectedRegistrar,
        ns_domain: nsDomain.trim().toLowerCase(),
        sending_domains: domains.map((d) => d.domain),
        mail_accounts_per_domain: accountsPerDomain,
        mail_account_style: mailAccountStyle,
        admin_email: adminEmail || null,
        config: {
          region: selectedRegion,
          secondaryRegion: selectedSecondaryRegion || selectedRegion,
          size: selectedSize,
          custom_prefixes: mailAccountStyle === "custom" ? customPrefixes.split("\n").filter(Boolean) : undefined,
        },
      };

      const res = await fetch("/api/provisioning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/dashboard/provisioning/${data.jobId}`);
      } else {
        const err = await res.json();
        alert(`Failed to start provisioning: ${err.error || "Unknown error"}`);
      }
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const totalAccounts = domains.length * accountsPerDomain;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard/provisioning")}
          className="text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Deploy New Server Pair</h1>
          <p className="text-gray-400 text-sm mt-1">
            Step {currentStep + 1} of 4 — {WIZARD_STEPS[currentStep].label}
          </p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {WIZARD_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentStep;
          const isComplete = i < currentStep;
          return (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
                  isComplete
                    ? "bg-green-500/20 border-green-500 text-green-400"
                    : isActive
                    ? "bg-blue-500/20 border-blue-500 text-blue-400"
                    : "bg-gray-800/50 border-gray-700 text-gray-500"
                }`}
              >
                {isComplete ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              </div>
              <span className={`text-xs hidden sm:block ${isActive ? "text-white" : "text-gray-500"}`}>
                {step.label}
              </span>
              {i < WIZARD_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 ${isComplete ? "bg-green-500/40" : "bg-gray-800"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-6">
          {/* STEP 1: VPS Provider */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <CardHeader className="p-0">
                <CardTitle className="text-white text-lg">Select VPS Provider</CardTitle>
              </CardHeader>

              {loadingProviders ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
              ) : providers.length === 0 ? (
                <div className="text-center py-8">
                  <Server className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm mb-4">No VPS providers configured</p>
                  <button
                    onClick={() => router.push("/dashboard/settings")}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Add a VPS provider in Settings →
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">Provider</label>
                    <div className="grid gap-3">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedProvider(p.id)}
                          className={`flex items-center justify-between p-4 rounded-lg border transition-colors text-left ${
                            selectedProvider === p.id
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                          }`}
                        >
                          <div>
                            <span className="text-white font-medium">{p.name}</span>
                            <span className="text-gray-500 text-xs ml-2">({p.provider_type})</span>
                            {p.provider_type === "dry_run" && (
                              <span className="ml-2 text-xs bg-indigo-900/60 text-indigo-300 px-1.5 py-0.5 rounded">Simulation</span>
                            )}
                          </div>
                          <Port25Indicator providerType={p.provider_type} />
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedProvider && (
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">Region</label>
                      {loadingRegions ? (
                        <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading regions...
                        </div>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {regions.map((r) => (
                            <button
                              key={r.id}
                              onClick={() => setSelectedRegion(r.id)}
                              disabled={!r.available}
                              className={`p-3 rounded-lg border text-sm text-left transition-colors ${
                                selectedRegion === r.id
                                  ? "border-blue-500 bg-blue-500/10 text-white"
                                  : r.available
                                  ? "border-gray-700 bg-gray-800/50 text-gray-300 hover:border-gray-600"
                                  : "border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed"
                              }`}
                            >
                              {r.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedRegion && regions.length > 1 && (
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">
                        Secondary Region <span className="text-gray-500">(for server 2 — different subnet = better reputation)</span>
                      </label>
                      <select
                        value={selectedSecondaryRegion}
                        onChange={(e) => setSelectedSecondaryRegion(e.target.value)}
                        className="w-full p-3 rounded-lg border border-gray-700 bg-gray-800/50 text-sm text-white focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">Same as primary (not recommended for production)</option>
                        {regions
                          .filter((r) => r.available && r.id !== selectedRegion)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                      {!selectedSecondaryRegion && (
                        <p className="text-xs text-amber-400 mt-2">
                          ⚠ Both servers will likely share a /24 subnet. For production deliverability, pick a different region.
                        </p>
                      )}
                    </div>
                  )}

                  {selectedRegion && (
                    <div>
                      <label className="text-sm text-gray-400 mb-2 block">Server Size</label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {[
                          { id: "small", label: "Small", desc: "1 vCPU / 2GB RAM", price: "~$5/mo" },
                          { id: "medium", label: "Medium", desc: "2 vCPU / 4GB RAM", price: "~$12/mo" },
                          { id: "large", label: "Large", desc: "4 vCPU / 8GB RAM", price: "~$24/mo" },
                        ].map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSelectedSize(s.id)}
                            className={`p-3 rounded-lg border text-left transition-colors ${
                              selectedSize === s.id
                                ? "border-blue-500 bg-blue-500/10"
                                : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                            }`}
                          >
                            <span className="text-white text-sm font-medium block">{s.label}</span>
                            <span className="text-gray-500 text-xs">{s.desc}</span>
                            <span className="text-gray-400 text-xs block mt-1">{s.price}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 2: DNS & Domains */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <CardHeader className="p-0">
                <CardTitle className="text-white text-lg">DNS & Sending Domains</CardTitle>
              </CardHeader>

              {loadingRegistrars ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
              ) : registrars.length === 0 ? (
                <div className="text-center py-8">
                  <Globe className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm mb-4">No DNS registrars configured</p>
                  <button
                    onClick={() => router.push("/dashboard/settings")}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    Add a DNS registrar in Settings →
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">DNS Registrar</label>
                    <div className="grid gap-2">
                      {registrars.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setSelectedRegistrar(r.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                            selectedRegistrar === r.id
                              ? "border-blue-500 bg-blue-500/10"
                              : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                          }`}
                        >
                          <span className="text-white text-sm">{r.name}</span>
                          <span className="text-gray-500 text-xs">({r.registrar_type})</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">
                      NS Domain
                      <span className="text-gray-600 ml-1">(used for ns1/ns2 nameservers)</span>
                    </label>
                    <input
                      type="text"
                      value={nsDomain}
                      onChange={(e) => setNsDomain(e.target.value)}
                      placeholder="ns-example.com"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 mb-3 block">
                      Sending Domains
                      <span className="text-gray-600 ml-1">(up to 10)</span>
                    </label>
                    <DomainInput
                      domains={domains}
                      onDomainsChange={setDomains}
                      maxDomains={10}
                      registrars={registrars.map((r: DNSRegistrarRow): RegistrarOption => ({
                        id: r.id,
                        name: r.name,
                        registrar_type: r.registrar_type,
                      }))}
                      selectedRegistrarId={selectedRegistrar}
                    />
                  </div>

                  {domains.length > 0 && !allDomainsChecked && (
                    <div className="flex items-center gap-2 text-yellow-400 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Check all domains for blacklist status before proceeding
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 3: Configuration */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <CardHeader className="p-0">
                <CardTitle className="text-white text-lg">Mail Account Configuration</CardTitle>
              </CardHeader>

              <div>
                <label className="text-sm text-gray-400 mb-2 block">Mail Account Style</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={() => setMailAccountStyle("random_names")}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      mailAccountStyle === "random_names"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                    }`}
                  >
                    <span className="text-white text-sm font-medium block">Random Names</span>
                    <span className="text-gray-500 text-xs block mt-1">
                      Auto-generates unique firstname.lastname accounts
                    </span>
                    <Badge className="bg-green-900/60 text-green-300 mt-2">Recommended</Badge>
                  </button>
                  <button
                    onClick={() => setMailAccountStyle("custom")}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      mailAccountStyle === "custom"
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-700 bg-gray-800/50 hover:border-gray-600"
                    }`}
                  >
                    <span className="text-white text-sm font-medium block">Custom Prefixes</span>
                    <span className="text-gray-500 text-xs block mt-1">
                      Enter your own account prefixes
                    </span>
                  </button>
                </div>
              </div>

              {mailAccountStyle === "random_names" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">
                      Accounts per Domain
                    </label>
                    <div className="flex gap-2">
                      {[2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setAccountsPerDomain(n)}
                          className={`w-12 h-10 rounded-lg border text-sm font-medium transition-colors ${
                            accountsPerDomain === n
                              ? "border-blue-500 bg-blue-500/10 text-white"
                              : "border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="text-gray-600 text-xs mt-1">
                      {totalAccounts} total accounts across {domains.length} domains
                    </p>
                  </div>

                  <button
                    onClick={generatePreviewNames}
                    className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
                  >
                    <Eye className="w-4 h-4" />
                    Preview Sample Names
                  </button>

                  {showPreview && previewNames.length > 0 && (
                    <div className="bg-gray-800/50 rounded-lg p-3">
                      <p className="text-gray-500 text-xs mb-2">Sample accounts (per domain):</p>
                      <div className="flex flex-wrap gap-2">
                        {previewNames.map((name) => (
                          <span key={name} className="text-xs text-white bg-gray-700 px-2 py-1 rounded font-mono">
                            {name}@domain.com
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mailAccountStyle === "custom" && (
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 mb-2 block">Custom Account Prefixes</label>
                  <textarea
                    value={customPrefixes}
                    onChange={(e) => setCustomPrefixes(e.target.value)}
                    placeholder={"sales\ninfo\ncontact"}
                    rows={4}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono resize-none"
                  />
                  <div className="flex items-center gap-2 text-yellow-400 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Using identical prefixes across domains may trigger spam filters
                  </div>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-400 mb-2 block">Admin Email</label>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@yourdomain.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Review Summary */}
              <div className="border-t border-gray-800 pt-6">
                <h3 className="text-white font-medium mb-4">Review Summary</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Provider</span>
                    <span className="text-white">
                      {selectedProviderObj?.name || "—"} in {regions.find((r) => r.id === selectedRegion)?.name || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Registrar</span>
                    <span className="text-white">{selectedRegistrarObj?.name || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">NS Domain</span>
                    <span className="text-white font-mono text-xs">{nsDomain || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Sending Domains</span>
                    <span className="text-white">{domains.length} domains</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Mail Accounts</span>
                    <span className="text-white">{totalAccounts} accounts ({accountsPerDomain} × {domains.length})</span>
                  </div>
                  {selectedProviderObj && PORT_25_STATUS[selectedProviderObj.provider_type]?.status !== "open" && (
                    <div className="flex items-center gap-2 mt-2 p-2 bg-yellow-900/20 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                      <span className="text-yellow-400 text-xs">
                        Port 25 requires manual action with {selectedProviderObj.provider_type}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Launch */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <CardHeader className="p-0">
                <CardTitle className="text-white text-lg flex items-center gap-2">
                  <Rocket className="w-5 h-5 text-blue-400" />
                  Ready to Deploy
                </CardTitle>
              </CardHeader>

              {/* Final summary */}
              <div className="bg-gray-800/50 rounded-lg p-5 space-y-4">
                <div className="grid gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">VPS Provider</span>
                    <span className="text-white">{selectedProviderObj?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Primary Region (server 1)</span>
                    <span className="text-white">{regions.find((r) => r.id === selectedRegion)?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Secondary Region (server 2)</span>
                    <span className={selectedSecondaryRegion ? "text-white" : "text-amber-400"}>
                      {selectedSecondaryRegion
                        ? regions.find((r) => r.id === selectedSecondaryRegion)?.name
                        : "Same as primary ⚠"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Server Size</span>
                    <span className="text-white capitalize">{selectedSize}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">DNS Registrar</span>
                    <span className="text-white">{selectedRegistrarObj?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">NS Domain</span>
                    <span className="text-white font-mono text-xs">{nsDomain}</span>
                  </div>

                  <div className="border-t border-gray-700 pt-3">
                    <span className="text-gray-400 text-xs block mb-2">Sending Domains:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {domains.map((d) => (
                        <span key={d.domain} className="text-xs bg-gray-700 text-white px-2 py-1 rounded font-mono">
                          {d.domain}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-gray-700 pt-3 flex justify-between">
                    <span className="text-gray-400">Mail Accounts</span>
                    <span className="text-white">
                      {totalAccounts} accounts ({mailAccountStyle === "random_names" ? "random names" : "custom"})
                    </span>
                  </div>
                </div>
              </div>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">
                  I understand this will create 2 VPS servers and I will be billed by{" "}
                  <span className="text-white font-medium">{selectedProviderObj?.name || "the provider"}</span>
                </span>
              </label>

              {/* Deploy button */}
              <button
                onClick={handleSubmit}
                disabled={!confirmChecked || submitting}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors text-lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Starting Deployment...
                  </>
                ) : (
                  <>
                    <Rocket className="w-5 h-5" />
                    Deploy Pair
                  </>
                )}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0}
          className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {currentStep < 3 && (
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            disabled={!canProceed}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
