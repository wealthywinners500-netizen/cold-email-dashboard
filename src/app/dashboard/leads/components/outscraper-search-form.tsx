"use client";

import { useState } from "react";
import type { OutscraperFilters, LeadList } from "@/lib/supabase/types";
import { CostPreview } from "./cost-preview";

// Defaults match dashboard-app/reports/2026-04-30-leads-v1a-design.md §10
// (lead-gen-pipeline skill values).
export const OUTSCRAPER_DEFAULTS: OutscraperFilters = {
  query: "",
  location: "",
  region: undefined,
  vertical: undefined,
  sub_vertical: undefined,
  places_per_query: 200,
  websites_only: true,
  operational_only: true,
  language: "en",
  max_per_query: 0,
  enrichment: ["emails_and_contacts"],
};

export function OutscraperSearchForm({
  list,
  submitting,
  onSubmit,
}: {
  list: LeadList;
  submitting: boolean;
  onSubmit: (filters: OutscraperFilters, estimatedCount: number) => void;
}) {
  // Pre-fill from list metadata + suggested filters
  const suggested = (list.suggested_filters || {}) as Partial<OutscraperFilters>;
  const initialQuery =
    (suggested.query as string) ||
    [list.vertical, list.sub_vertical, list.region]
      .filter(Boolean)
      .join(", ");

  const [query, setQuery] = useState(initialQuery);
  const [location, setLocation] = useState(
    (suggested.location as string) || list.region || ""
  );
  const [placesPerQuery, setPlacesPerQuery] = useState<number>(
    typeof suggested.places_per_query === "number"
      ? suggested.places_per_query
      : 200
  );
  const [websitesOnly, setWebsitesOnly] = useState<boolean>(
    suggested.websites_only !== false
  );
  const [operationalOnly, setOperationalOnly] = useState<boolean>(
    suggested.operational_only !== false
  );
  const [language, setLanguage] = useState((suggested.language as string) || "en");

  const submit = () => {
    if (!query.trim()) return;
    const composedQuery = location.trim()
      ? `${query.trim()}, ${location.trim()}`
      : query.trim();
    const filters: OutscraperFilters = {
      query: composedQuery,
      location: location.trim(),
      region: list.region || undefined,
      vertical: list.vertical || undefined,
      sub_vertical: list.sub_vertical || undefined,
      places_per_query: placesPerQuery,
      websites_only: websitesOnly,
      operational_only: operationalOnly,
      language,
      max_per_query: 0,
      enrichment: ["emails_and_contacts"],
    };
    onSubmit(filters, placesPerQuery);
  };

  const queryReady = query.trim().length > 0;

  return (
    <div className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-5">
      <div>
        <h3 className="text-white font-semibold mb-1">Outscraper search</h3>
        <p className="text-sm text-gray-400">
          Pre-filled from this list&apos;s region + vertical. Adjust before
          submitting; cost preview updates live.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="text-xs text-gray-400 block mb-1">
            Search query
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="senior care"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Vertical + sub-vertical (e.g., &ldquo;senior care&rdquo;,
            &ldquo;HVAC contractors&rdquo;).
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-400 block mb-1">
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Atlanta, GA"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Places per query
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={placesPerQuery}
            onChange={(e) =>
              setPlacesPerQuery(
                Math.max(1, Math.min(1000, parseInt(e.target.value || "0", 10)))
              )
            }
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            140 = focused, 200 = broad (skill default).
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-gray-800">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={websitesOnly}
            onChange={(e) => setWebsitesOnly(e.target.checked)}
            className="rounded border-gray-600"
          />
          Websites only — drop entries without a website
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={operationalOnly}
            onChange={(e) => setOperationalOnly(e.target.checked)}
            className="rounded border-gray-600"
          />
          Operational only — drop temporarily/permanently closed places
        </label>
      </div>

      <CostPreview estimatedLeadCount={placesPerQuery} />

      <button
        onClick={submit}
        disabled={!queryReady || submitting}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:opacity-60 text-white rounded-lg font-semibold text-sm"
      >
        {submitting
          ? "Submitting…"
          : queryReady
            ? "Submit Outscraper task"
            : "Enter a search query"}
      </button>
    </div>
  );
}
