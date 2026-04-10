"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X as XIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Globe,
  ChevronDown,
  AlertTriangle,
  Search,
  Plus,
} from "lucide-react";
import type { DomainInfo } from "@/lib/provisioning/types";

// ============================================
// Types
// ============================================
// 3-state blacklist model (hard lesson #47, 2026-04-10).
//   'clean'   — definitively not listed (via Spamhaus DQS or worker proxy)
//   'listed'  — definitively listed; blocks wizard launch (hard lesson #43)
//   'unknown' — blacklist service unavailable; warn-but-allow, operator
//               must verify manually on MXToolbox
//   null      — not yet checked
type BlacklistStatus = "clean" | "listed" | "unknown";
type BlacklistMethod =
  | "dqs"
  | "fallback-proxy"
  | "legacy-public"
  | "unavailable";

interface DomainStatus {
  domain: string;
  checking: boolean;
  status: BlacklistStatus | null;
  blacklists: string[];
  method?: BlacklistMethod;
}

export interface RegistrarOption {
  id: string;
  name: string;
  registrar_type: string;
}

interface DomainInputProps {
  domains: DomainStatus[];
  onDomainsChange: (domains: DomainStatus[]) => void;
  maxDomains?: number;
  /** Connected DNS registrars for "Fetch from Registrar" mode */
  registrars?: RegistrarOption[];
  /** Currently selected registrar ID (from wizard step 1) */
  selectedRegistrarId?: string;
}

type InputMode = "single" | "bulk" | "registrar";

interface FetchState {
  // 'idle'     — no fetch in flight, nothing to show
  // 'loading'  — initial dispatch in progress (first HTTP call)
  // 'polling'  — worker is fetching, we're polling every 5s
  // 'ready'    — got the domain list
  // 'failed'   — worker returned an error
  phase: "idle" | "loading" | "polling" | "ready" | "failed";
  error: string | null;
  domains: (DomainInfo & { inUse?: boolean })[];
  registrarName: string | null;
  cached: boolean;
  fetchedAt: string | null;
  requestedAt: string | null;
}

// Poll interval for the /api/dns-registrars/[id]/domains endpoint while the
// worker is fetching. Hard lesson #49: worker-side listing of 110 domains
// takes ~9 min, so we give the UI headroom up to 15 min before giving up.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_DURATION_MS = 15 * 60 * 1000;

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function validateDomain(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!cleaned) return null;
  if (!DOMAIN_REGEX.test(cleaned)) return null;
  return cleaned;
}

// ============================================
// Status badge for fetched domains
// ============================================
function FetchedDomainBadge({
  domain,
  inUse,
}: {
  domain: DomainInfo & { inUse?: boolean };
  inUse?: boolean;
}) {
  if (inUse) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        Already in use
      </span>
    );
  }
  if (domain.status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <XCircle className="h-3.5 w-3.5" />
        Expired
      </span>
    );
  }
  if (domain.hasMxRecords) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Has MX records
      </span>
    );
  }
  if (domain.isAvailable) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Available
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      <AlertTriangle className="h-3.5 w-3.5" />
      Unavailable
    </span>
  );
}

// ============================================
// Main Component
// ============================================
export function DomainInput({
  domains,
  onDomainsChange,
  maxDomains = 10,
  registrars = [],
  selectedRegistrarId,
}: DomainInputProps) {
  const hasRegistrars = registrars.length > 0;
  const [mode, setMode] = useState<InputMode>("single");
  const [singleInput, setSingleInput] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Registrar fetch state
  const [fetchRegistrar, setFetchRegistrar] = useState<string>(selectedRegistrarId || "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({
    phase: "idle",
    error: null,
    domains: [],
    registrarName: null,
    cached: false,
    fetchedAt: null,
    requestedAt: null,
  });
  const [selectedFetched, setSelectedFetched] = useState<Set<string>>(new Set());

  // Refs so our polling loop isn't recreated on every render and can be
  // cancelled cleanly on unmount / mode-change / registrar-change.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number | null>(null);
  const activeRegistrarRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollStartRef.current = null;
  }, []);

  // Cleanup on unmount — kills any in-flight poll timer.
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Cleanup when leaving registrar mode — abandon any in-flight poll.
  useEffect(() => {
    if (mode !== "registrar") {
      stopPolling();
      activeRegistrarRef.current = null;
    }
  }, [mode, stopPolling]);

  // ---- Single/Bulk mode handlers (unchanged from original) ----

  const addDomain = useCallback((raw: string) => {
    const domain = validateDomain(raw);
    if (!domain) {
      setInputError("Invalid domain format");
      return false;
    }
    if (domains.some((d) => d.domain === domain)) {
      setInputError("Domain already added");
      return false;
    }
    if (domains.length >= maxDomains) {
      setInputError(`Maximum ${maxDomains} domains`);
      return false;
    }
    setInputError(null);
    onDomainsChange([...domains, { domain, checking: false, status: null, blacklists: [] }]);
    return true;
  }, [domains, onDomainsChange, maxDomains]);

  const handleSingleAdd = () => {
    if (addDomain(singleInput)) {
      setSingleInput("");
    }
  };

  const handleBulkAdd = () => {
    const lines = bulkInput
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    const newDomains: DomainStatus[] = [...domains];
    const errors: string[] = [];

    for (const line of lines) {
      const domain = validateDomain(line);
      if (!domain) {
        errors.push(`Invalid: ${line}`);
        continue;
      }
      if (newDomains.some((d) => d.domain === domain)) continue;
      if (newDomains.length >= maxDomains) {
        errors.push(`Max ${maxDomains} domains reached`);
        break;
      }
      newDomains.push({ domain, checking: false, status: null, blacklists: [] });
    }

    onDomainsChange(newDomains);
    if (errors.length > 0) {
      setInputError(errors.join("; "));
    } else {
      setInputError(null);
      setBulkInput("");
    }
  };

  const removeDomain = (domain: string) => {
    onDomainsChange(domains.filter((d) => d.domain !== domain));
  };

  const checkDomain = async (domain: string) => {
    onDomainsChange(
      domains.map((d) => (d.domain === domain ? { ...d, checking: true } : d))
    );
    try {
      const res = await fetch("/api/provisioning/check-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (res.ok) {
        const data = await res.json();
        // 3-state response. Prefer data.status if present, but fall back to
        // the legacy boolean fields for backwards compat during rollout.
        const status: BlacklistStatus =
          data.status === "clean" || data.status === "listed" || data.status === "unknown"
            ? data.status
            : data.clean === true
              ? "clean"
              : data.blacklisted === true
                ? "listed"
                : "unknown";
        onDomainsChange(
          domains.map((d) =>
            d.domain === domain
              ? {
                  ...d,
                  checking: false,
                  status,
                  blacklists: data.blacklists || [],
                  method: data.method,
                }
              : d
          )
        );
      } else {
        onDomainsChange(
          domains.map((d) => (d.domain === domain ? { ...d, checking: false } : d))
        );
      }
    } catch {
      onDomainsChange(
        domains.map((d) => (d.domain === domain ? { ...d, checking: false } : d))
      );
    }
  };

  const checkAll = async () => {
    const unchecked = domains.filter((d) => d.status === null && !d.checking);
    for (const d of unchecked) {
      await checkDomain(d.domain);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  // ---- Registrar fetch handlers ----
  //
  // Hard lesson #49 (2026-04-10): listing 110 Ionos domains takes ~9 min
  // because the API is throttled at 25 req/min and we need 2 calls per domain
  // (zone + MX record). That cannot run inside a Vercel serverless function.
  // The endpoint has been refactored to an async-polling contract:
  //
  //   POST/GET first call → 202 { status: 'fetching', requestedAt }
  //   subsequent GETs      → 202 { status: 'fetching' } until worker done
  //   done                 → 200 { status: 'ready',  domains, fetchedAt }
  //   error                → 502 { status: 'failed', error }
  //
  // The wizard polls every 5s and gives up after 15 min.

  const pollOnce = useCallback(
    async (registrarId: string): Promise<void> => {
      // Guard: if the user switched registrars / modes while we were waiting,
      // stop updating state for the previous fetch.
      if (activeRegistrarRef.current !== registrarId) return;

      try {
        const res = await fetch(
          `/api/dns-registrars/${registrarId}/domains`
        );
        const data = await res.json();

        if (activeRegistrarRef.current !== registrarId) return;

        // HTTP 200 — worker finished, render the list.
        if (res.status === 200 && data.status === "ready") {
          stopPolling();
          setFetchState({
            phase: "ready",
            error: null,
            domains: data.domains || [],
            registrarName: data.registrarName || null,
            cached: data.cached || false,
            fetchedAt: data.fetchedAt || null,
            requestedAt: null,
          });
          const available = (data.domains || [])
            .filter((d: DomainInfo) => d.isAvailable)
            .map((d: DomainInfo) => d.domain);
          setSelectedFetched(new Set(available));
          return;
        }

        // HTTP 202 — worker still fetching, schedule next poll.
        if (res.status === 202 && data.status === "fetching") {
          const started = pollStartRef.current ?? Date.now();
          if (pollStartRef.current === null) pollStartRef.current = started;

          if (Date.now() - started > POLL_MAX_DURATION_MS) {
            stopPolling();
            setFetchState((prev) => ({
              ...prev,
              phase: "failed",
              error:
                "Timed out waiting for domains (15 min). The worker may be stuck — retry, or check the worker VPS.",
            }));
            return;
          }

          setFetchState((prev) => ({
            ...prev,
            phase: "polling",
            error: null,
            registrarName: data.registrarName || prev.registrarName,
            requestedAt: data.requestedAt || prev.requestedAt,
          }));

          pollTimerRef.current = setTimeout(
            () => pollOnce(registrarId),
            POLL_INTERVAL_MS
          );
          return;
        }

        // HTTP 502 — worker failed, surface the error + retry button.
        if (res.status === 502 || data.status === "failed") {
          stopPolling();
          setFetchState((prev) => ({
            ...prev,
            phase: "failed",
            error: data.error || "Worker failed to list domains",
          }));
          return;
        }

        // Anything else — surface as an error.
        stopPolling();
        setFetchState((prev) => ({
          ...prev,
          phase: "failed",
          error: data.error || `Unexpected response (HTTP ${res.status})`,
        }));
      } catch (err) {
        if (activeRegistrarRef.current !== registrarId) return;
        // Transient network error — keep polling so the UI recovers
        // automatically if Vercel has a blip. Bail out via the overall
        // POLL_MAX_DURATION_MS budget above.
        const started = pollStartRef.current ?? Date.now();
        if (pollStartRef.current === null) pollStartRef.current = started;
        if (Date.now() - started > POLL_MAX_DURATION_MS) {
          stopPolling();
          setFetchState((prev) => ({
            ...prev,
            phase: "failed",
            error:
              err instanceof Error
                ? `Network error: ${err.message}`
                : "Network error fetching domains",
          }));
          return;
        }
        pollTimerRef.current = setTimeout(
          () => pollOnce(registrarId),
          POLL_INTERVAL_MS
        );
      }
    },
    [stopPolling]
  );

  const fetchDomains = useCallback(
    async (registrarId: string, refresh = false) => {
      // Reset any previous poll state + mark this registrar as the active one.
      stopPolling();
      activeRegistrarRef.current = registrarId;
      pollStartRef.current = Date.now();
      setSelectedFetched(new Set());
      setFetchState((prev) => ({
        ...prev,
        phase: "loading",
        error: null,
        domains: [],
        fetchedAt: null,
        requestedAt: null,
        registrarName:
          registrars.find((r) => r.id === registrarId)?.name || prev.registrarName,
      }));

      try {
        const url = `/api/dns-registrars/${registrarId}/domains${
          refresh ? "?refresh=true" : ""
        }`;
        const res = await fetch(url);
        const data = await res.json();

        if (activeRegistrarRef.current !== registrarId) return;

        // Fresh-cache path — 200 + ready in one shot.
        if (res.status === 200 && data.status === "ready") {
          setFetchState({
            phase: "ready",
            error: null,
            domains: data.domains || [],
            registrarName: data.registrarName || null,
            cached: data.cached || false,
            fetchedAt: data.fetchedAt || null,
            requestedAt: null,
          });
          const available = (data.domains || [])
            .filter((d: DomainInfo) => d.isAvailable)
            .map((d: DomainInfo) => d.domain);
          setSelectedFetched(new Set(available));
          return;
        }

        // Worker dispatched / in-flight — start polling.
        if (res.status === 202 && data.status === "fetching") {
          setFetchState((prev) => ({
            ...prev,
            phase: "polling",
            error: null,
            registrarName: data.registrarName || prev.registrarName,
            requestedAt: data.requestedAt || null,
          }));
          pollTimerRef.current = setTimeout(
            () => pollOnce(registrarId),
            POLL_INTERVAL_MS
          );
          return;
        }

        // Previous failure — surface the error, leave Retry visible.
        if (res.status === 502 || data.status === "failed") {
          setFetchState((prev) => ({
            ...prev,
            phase: "failed",
            error: data.error || "Worker failed to list domains",
          }));
          return;
        }

        setFetchState((prev) => ({
          ...prev,
          phase: "failed",
          error: data.error || `Unexpected response (HTTP ${res.status})`,
        }));
      } catch (err) {
        if (activeRegistrarRef.current !== registrarId) return;
        setFetchState((prev) => ({
          ...prev,
          phase: "failed",
          error:
            err instanceof Error
              ? `Network error: ${err.message}`
              : "Network error fetching domains",
        }));
      }
    },
    [registrars, stopPolling, pollOnce]
  );

  const toggleFetched = useCallback((domain: string) => {
    setSelectedFetched((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }, []);

  const selectAllAvailable = useCallback(() => {
    const available = fetchState.domains
      .filter((d) => d.isAvailable && !d.inUse)
      .map((d) => d.domain);
    setSelectedFetched(new Set(available));
  }, [fetchState.domains]);

  const addSelectedFromRegistrar = useCallback(() => {
    const newDomains = [...domains];
    for (const domainName of selectedFetched) {
      if (newDomains.length >= maxDomains) break;
      if (newDomains.some((d) => d.domain === domainName)) continue;
      newDomains.push({ domain: domainName, checking: false, status: null, blacklists: [] });
    }
    onDomainsChange(newDomains);
    setSelectedFetched(new Set());
  }, [selectedFetched, domains, maxDomains, onDomainsChange]);

  const availableCount = fetchState.domains.filter((d) => d.isAvailable && !d.inUse).length;
  const selectedCount = selectedFetched.size;
  const hasUnchecked = domains.some((d) => d.status === null && !d.checking);
  const hasBlacklisted = domains.some((d) => d.status === "listed");
  const hasUnknown = domains.some((d) => d.status === "unknown");

  return (
    <div className="space-y-4">
      {/* Mode Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setMode("single"); setInputError(null); }}
          className={`text-xs px-3 py-1.5 rounded-md ${
            mode === "single" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Single Input
        </button>
        <button
          onClick={() => { setMode("bulk"); setInputError(null); }}
          className={`text-xs px-3 py-1.5 rounded-md ${
            mode === "bulk" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Bulk Paste
        </button>
        {hasRegistrars && (
          <button
            onClick={() => { setMode("registrar"); setInputError(null); }}
            className={`text-xs px-3 py-1.5 rounded-md ${
              mode === "registrar" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Fetch from Registrar
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {domains.length}/{maxDomains} domains
        </span>
      </div>

      {/* Single Input */}
      {mode === "single" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={singleInput}
            onChange={(e) => { setSingleInput(e.target.value); setInputError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSingleAdd(); }}
            placeholder="example.com"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none font-mono"
          />
          <button
            onClick={handleSingleAdd}
            disabled={!singleInput.trim() || domains.length >= maxDomains}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {/* Bulk Paste */}
      {mode === "bulk" && (
        <div className="space-y-2">
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder="Paste domains separated by newlines, commas, or semicolons..."
            className="w-full h-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none font-mono"
          />
          <button
            onClick={handleBulkAdd}
            disabled={!bulkInput.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors"
          >
            Add Domains
          </button>
        </div>
      )}

      {/* Fetch from Registrar */}
      {mode === "registrar" && (
        <div className="space-y-3">
          {/* Registrar Selector */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white hover:border-gray-600"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-gray-400" />
                {fetchRegistrar
                  ? registrars.find((r) => r.id === fetchRegistrar)?.name || "Select registrar"
                  : "Select a DNS registrar..."}
              </span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {showDropdown && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 py-1 shadow-lg">
                {registrars.map((reg) => (
                  <button
                    key={reg.id}
                    onClick={() => {
                      setFetchRegistrar(reg.id);
                      setShowDropdown(false);
                      fetchDomains(reg.id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white hover:bg-gray-700"
                  >
                    <Globe className="h-4 w-4 text-gray-400" />
                    <span>{reg.name}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {reg.registrar_type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Loading — first dispatch */}
          {fetchState.phase === "loading" && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 py-8 text-sm text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              Dispatching fetch to {registrars.find((r) => r.id === fetchRegistrar)?.name || "registrar"}...
            </div>
          )}

          {/* Polling — worker is actively listing domains */}
          {fetchState.phase === "polling" && (
            <div className="rounded-lg border border-blue-800/50 bg-blue-900/10 px-4 py-5 text-sm text-blue-200">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">
                    Fetching domains from {fetchState.registrarName || "registrar"}...
                  </div>
                  <div className="mt-1 text-xs text-blue-300/80">
                    This can take several minutes for accounts with many domains.
                    The worker is running Spamhaus blacklist checks on each one;
                    the wizard will update automatically when it&apos;s done.
                  </div>
                  {fetchState.requestedAt && (
                    <div className="mt-1 text-xs text-blue-300/60">
                      Started {new Date(fetchState.requestedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {fetchState.phase === "failed" && fetchState.error && (
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 flex-shrink-0" />
                {fetchState.error}
              </div>
              {fetchRegistrar && (
                <button
                  onClick={() => fetchDomains(fetchRegistrar, true)}
                  className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Domain List */}
          {fetchState.phase === "ready" && fetchState.domains.length > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/50">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Search className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-300">
                    {fetchState.domains.length} domains
                    {availableCount > 0 && (
                      <span className="text-green-400"> ({availableCount} available)</span>
                    )}
                  </span>
                  {fetchState.cached && <span className="text-xs text-gray-500">(cached)</span>}
                </div>
                <button
                  onClick={() => fetchRegistrar && fetchDomains(fetchRegistrar, true)}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>

              {/* Rows */}
              <div className="max-h-64 overflow-y-auto">
                {fetchState.domains.map((d) => {
                  const isSelectable = d.isAvailable && !d.inUse;
                  const isSelected = selectedFetched.has(d.domain);

                  return (
                    <label
                      key={d.domain}
                      className={`flex items-center gap-3 border-b border-gray-700/50 px-4 py-2.5 last:border-0 ${
                        isSelectable
                          ? "cursor-pointer hover:bg-gray-700/30"
                          : "opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => isSelectable && toggleFetched(d.domain)}
                        disabled={!isSelectable}
                        className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <div className="flex flex-1 items-center justify-between min-w-0">
                        <div className="min-w-0">
                          <span className="text-sm font-mono text-white truncate block">
                            {d.domain}
                          </span>
                          {d.expiresAt && (
                            <span className="text-xs text-gray-500">
                              expires {new Date(d.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <FetchedDomainBadge domain={d} inUse={d.inUse} />
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-gray-700 px-4 py-2.5">
                <button
                  onClick={selectAllAvailable}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Select All Available ({availableCount})
                </button>
                <button
                  onClick={addSelectedFromRegistrar}
                  disabled={selectedCount === 0}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add {selectedCount} Selected
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {fetchState.phase === "ready" && fetchState.domains.length === 0 &&
            fetchRegistrar && fetchState.registrarName && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-6 text-center text-sm text-gray-500">
                No domains found in {fetchState.registrarName}.
              </div>
            )}
        </div>
      )}

      {inputError && <p className="text-red-400 text-xs">{inputError}</p>}

      {/* Domain list */}
      {domains.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 font-medium">Sending Domains</span>
            {hasUnchecked && (
              <button
                onClick={checkAll}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
              >
                <RefreshCw className="w-3 h-3" />
                Check All
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {domains.map((d) => (
              <div
                key={d.domain}
                className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-2"
              >
                {d.checking ? (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
                ) : d.status === "clean" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                ) : d.status === "listed" ? (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : d.status === "unknown" ? (
                  <AlertTriangle
                    className="w-4 h-4 text-amber-400 flex-shrink-0"
                    aria-label="Blacklist service unavailable — verify manually on MXToolbox before launching"
                  />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0" />
                )}

                <span className="text-sm text-white font-mono flex-1 truncate">{d.domain}</span>

                {d.status === "listed" && d.blacklists.length > 0 && (
                  <span className="text-xs text-red-400 truncate max-w-[150px]">
                    {d.blacklists.join(", ")}
                  </span>
                )}

                {d.status === "unknown" && (
                  <span
                    className="text-xs text-amber-400 truncate max-w-[180px]"
                    title="Blacklist service unavailable — verify manually on MXToolbox before launching"
                  >
                    Verify on MXToolbox
                  </span>
                )}

                {d.status === null && !d.checking && (
                  <button
                    onClick={() => checkDomain(d.domain)}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Check
                  </button>
                )}

                <button
                  onClick={() => removeDomain(d.domain)}
                  className="text-gray-500 hover:text-red-400 flex-shrink-0"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {hasBlacklisted && (
            <p className="text-red-400 text-xs flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              Remove blacklisted domains before proceeding
            </p>
          )}

          {!hasBlacklisted && hasUnknown && (
            <p className="text-amber-400 text-xs flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Blacklist service unavailable for one or more domains. You can
                proceed, but verify each unknown domain on MXToolbox before
                launching.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export type { DomainStatus };
