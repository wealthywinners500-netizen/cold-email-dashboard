"use client";

import { useState } from "react";
import type { OutscraperFilters, LeadList } from "@/lib/supabase/types";
import { CostPreview } from "./cost-preview";

// V8 (2026-04-30): defaults match Outscraper /tasks API + contacts_n_leads.
// Per Dean 2026-04-30, "finance" is dropped from the default 5-type historical
// list — only 4 contact types are requested.
const DEFAULT_PREFERRED_CONTACTS = [
  "decision makers",
  "operations",
  "marketing",
  "sales",
];

const ALL_PREFERRED_CONTACTS = [
  "decision makers",
  "operations",
  "marketing",
  "sales",
  "finance",
  "support",
  "hr",
];

export const OUTSCRAPER_DEFAULTS: OutscraperFilters = {
  categories: [],
  locations: [],
  use_zip_codes: true,
  ignore_without_emails: true,
  drop_email_duplicates: true,
  organizations_per_query_limit: 200,
  limit: 0,
  preferred_contacts: DEFAULT_PREFERRED_CONTACTS,
  language: "en",
};

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function OutscraperSearchForm({
  list,
  submitting,
  onSubmit,
}: {
  list: LeadList;
  submitting: boolean;
  onSubmit: (filters: OutscraperFilters, estimatedCount: number) => void;
}) {
  // Pre-fill from list metadata + suggested filters. Tolerate both V1a (query/
  // location) and V8 (categories/locations) shapes for one transition cycle.
  const suggested = (list.suggested_filters || {}) as Partial<OutscraperFilters>;

  const initialCategoriesCsv = (() => {
    if (Array.isArray(suggested.categories) && suggested.categories.length > 0) {
      return suggested.categories.join(", ");
    }
    if (typeof suggested.query === "string" && suggested.query.length > 0) {
      return suggested.query;
    }
    return [list.vertical, list.sub_vertical].filter(Boolean).join(", ");
  })();

  const initialLocationsCsv = (() => {
    if (Array.isArray(suggested.locations) && suggested.locations.length > 0) {
      return suggested.locations.join(", ");
    }
    if (typeof suggested.location === "string" && suggested.location.length > 0) {
      return suggested.location;
    }
    return list.region || "";
  })();

  const [categoriesCsv, setCategoriesCsv] = useState(initialCategoriesCsv);
  const [locationsCsv, setLocationsCsv] = useState(initialLocationsCsv);
  const [orgsPerQuery, setOrgsPerQuery] = useState<number>(
    typeof suggested.organizations_per_query_limit === "number"
      ? suggested.organizations_per_query_limit
      : 200
  );
  const [language, setLanguage] = useState((suggested.language as string) || "en");
  const [preferredContacts, setPreferredContacts] = useState<string[]>(
    Array.isArray(suggested.preferred_contacts) &&
      suggested.preferred_contacts.length > 0
      ? suggested.preferred_contacts
      : DEFAULT_PREFERRED_CONTACTS
  );

  const categories = splitCsv(categoriesCsv);
  const locations = splitCsv(locationsCsv);
  const queries = categories.length * locations.length;
  const estimatedLeadCount = queries * orgsPerQuery;

  const togglePreferredContact = (label: string) => {
    setPreferredContacts((prev) =>
      prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label]
    );
  };

  const submit = () => {
    if (categories.length === 0 || locations.length === 0) return;
    const filters: OutscraperFilters = {
      categories,
      locations,
      use_zip_codes: true,
      ignore_without_emails: true,
      drop_email_duplicates: true,
      organizations_per_query_limit: orgsPerQuery,
      limit: 0,
      preferred_contacts:
        preferredContacts.length > 0
          ? preferredContacts
          : DEFAULT_PREFERRED_CONTACTS,
      region: list.region || undefined,
      vertical: list.vertical || undefined,
      sub_vertical: list.sub_vertical || undefined,
      language,
    };
    onSubmit(filters, estimatedLeadCount);
  };

  const ready = categories.length > 0 && locations.length > 0;

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
            Categories (comma-separated)
          </label>
          <input
            type="text"
            value={categoriesCsv}
            onChange={(e) => setCategoriesCsv(e.target.value)}
            placeholder="dentist, doctor, optometrist"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Google-Maps category strings. Each combines with each ZIP below.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-400 block mb-1">
            ZIP codes (comma-separated)
          </label>
          <input
            type="text"
            value={locationsCsv}
            onChange={(e) => setLocationsCsv(e.target.value)}
            placeholder="30309, 30308, 30312"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Use ZIP codes — never city names (lead-gen-pipeline skill rule).
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">
            Per-zip cap
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={orgsPerQuery}
            onChange={(e) =>
              setOrgsPerQuery(
                Math.max(1, Math.min(1000, parseInt(e.target.value || "0", 10)))
              )
            }
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            organizationsPerQueryLimit — 200 is the skill default.
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

      <div className="pt-2 border-t border-gray-800">
        <p className="text-xs text-gray-400 mb-2">Decision-maker types</p>
        <div className="flex flex-wrap gap-2">
          {ALL_PREFERRED_CONTACTS.map((label) => {
            const selected = preferredContacts.includes(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => togglePreferredContact(label)}
                className={`px-2.5 py-1 rounded text-xs border ${
                  selected
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Defaults to 4 (no finance per Dean 2026-04-30). Toggle to adjust.
        </p>
      </div>

      <CostPreview estimatedLeadCount={estimatedLeadCount} />

      <button
        onClick={submit}
        disabled={!ready || submitting}
        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:opacity-60 text-white rounded-lg font-semibold text-sm"
      >
        {submitting
          ? "Submitting…"
          : ready
            ? `Submit Outscraper task (${queries} ${queries === 1 ? "query" : "queries"})`
            : "Enter at least one category + ZIP"}
      </button>
    </div>
  );
}
