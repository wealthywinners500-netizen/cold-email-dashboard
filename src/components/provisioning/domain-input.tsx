"use client";

import { useState, useCallback } from "react";
import { X as XIcon, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

interface DomainStatus {
  domain: string;
  checking: boolean;
  clean: boolean | null;
  blacklists: string[];
}

interface DomainInputProps {
  domains: DomainStatus[];
  onDomainsChange: (domains: DomainStatus[]) => void;
  maxDomains?: number;
}

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

export function DomainInput({ domains, onDomainsChange, maxDomains = 10 }: DomainInputProps) {
  const [singleInput, setSingleInput] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

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
    onDomainsChange([...domains, { domain, checking: false, clean: null, blacklists: [] }]);
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
      newDomains.push({ domain, checking: false, clean: null, blacklists: [] });
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
        onDomainsChange(
          domains.map((d) =>
            d.domain === domain
              ? { ...d, checking: false, clean: data.clean, blacklists: data.blacklists }
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
    const unchecked = domains.filter((d) => d.clean === null && !d.checking);
    for (const d of unchecked) {
      await checkDomain(d.domain);
      // Small delay between checks to respect rate limit
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const hasUnchecked = domains.some((d) => d.clean === null && !d.checking);
  const hasBlacklisted = domains.some((d) => d.clean === false);

  return (
    <div className="space-y-4">
      {/* Toggle mode */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setBulkMode(false); setInputError(null); }}
          className={`text-xs px-3 py-1.5 rounded-md ${
            !bulkMode ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Single Input
        </button>
        <button
          onClick={() => { setBulkMode(true); setInputError(null); }}
          className={`text-xs px-3 py-1.5 rounded-md ${
            bulkMode ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Bulk Paste
        </button>
        <span className="text-xs text-gray-500 ml-auto">
          {domains.length}/{maxDomains} domains
        </span>
      </div>

      {/* Input area */}
      {bulkMode ? (
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
      ) : (
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
                {/* Status indicator */}
                {d.checking ? (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
                ) : d.clean === true ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                ) : d.clean === false ? (
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0" />
                )}

                {/* Domain name */}
                <span className="text-sm text-white font-mono flex-1 truncate">{d.domain}</span>

                {/* Blacklist info */}
                {d.clean === false && d.blacklists.length > 0 && (
                  <span className="text-xs text-red-400 truncate max-w-[150px]">
                    {d.blacklists.join(", ")}
                  </span>
                )}

                {/* Check button (if not yet checked) */}
                {d.clean === null && !d.checking && (
                  <button
                    onClick={() => checkDomain(d.domain)}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    Check
                  </button>
                )}

                {/* Remove button */}
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
        </div>
      )}
    </div>
  );
}

export type { DomainStatus };
