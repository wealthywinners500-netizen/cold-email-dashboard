"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Search,
  Filter,
  CheckCircle,
  Upload,
  Plus,
  Send,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit3,
} from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { toast } from "sonner";
import type { LeadContact, LeadContactStats } from "@/lib/supabase/types";

interface LeadContactsClientProps {
  contacts: LeadContact[];
  stats: LeadContactStats;
  total: number;
  page: number;
  totalPages: number;
  hasOutscraper: boolean;
  hasReoon: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  valid: "bg-green-900 text-green-200",
  invalid: "bg-red-900 text-red-200",
  risky: "bg-yellow-900 text-yellow-200",
  unknown: "bg-blue-900 text-blue-200",
  pending: "bg-gray-700 text-gray-300",
};

export default function LeadContactsClient({
  contacts,
  stats,
  total,
  page,
  totalPages,
  hasOutscraper,
  hasReoon,
}: LeadContactsClientProps) {
  const router = useRouter();
  useRealtimeRefresh("lead_contacts");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchModal, setSearchModal] = useState(false);
  const [campaignModal, setCampaignModal] = useState(false);
  const [csvModal, setCsvModal] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<LeadContact | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filters
  const [stateFilter, setStateFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchText, setSearchText] = useState("");

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === contacts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map((c) => c.id)));
    }
  };

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (stateFilter) params.set("state", stateFilter);
    if (cityFilter) params.set("city", cityFilter);
    if (typeFilter) params.set("business_type", typeFilter);
    if (statusFilter) params.set("email_status", statusFilter);
    if (searchText) params.set("search", searchText);
    params.set("page", "1");
    router.push(`/dashboard/leads?tab=contacts&${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(newPage));
    params.set("tab", "contacts");
    router.push(`/dashboard/leads?${params.toString()}`);
  };

  const handleVerifySelected = async () => {
    if (selected.size === 0) {
      toast.error("Select contacts to verify");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/lead-contacts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Verification failed");
      }
      const data = await res.json();
      toast.success(
        `Verified ${data.verified}: ${data.valid} valid, ${data.invalid} invalid, ${data.risky} risky`
      );
      setSelected(new Set());
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyAllPending = async () => {
    setVerifying(true);
    try {
      const res = await fetch("/api/lead-contacts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter: { email_status: "pending" } }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Verification failed");
      }
      const data = await res.json();
      toast.success(
        `Verified ${data.verified}: ${data.valid} valid, ${data.invalid} invalid, ${data.risky} risky`
      );
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/lead-contacts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Contact deleted");
      router.refresh();
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(null);
    }
  };

  // Unique states and types from stats for filter dropdowns
  const stateOptions = stats.by_state.map((s) => s.state);
  const typeOptions = stats.by_type.map((t) => t.type);

  if (contacts.length === 0 && !stateFilter && !cityFilter && !typeFilter && !statusFilter && !searchText) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No leads yet</h3>
          <p className="text-gray-400 mb-6 max-w-md">
            Search for businesses with Outscraper, import a CSV, or add contacts manually.
          </p>
          <div className="flex gap-3">
            {hasOutscraper && (
              <button
                onClick={() => setSearchModal(true)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
              >
                <Search className="w-5 h-5 inline mr-2" />
                Search Leads
              </button>
            )}
            <button
              onClick={() => setCsvModal(true)}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors"
            >
              <Upload className="w-5 h-5 inline mr-2" />
              Import CSV
            </button>
            <button
              onClick={() => setAddModal(true)}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition-colors"
            >
              <Plus className="w-5 h-5 inline mr-2" />
              Add Contact
            </button>
          </div>
        </div>

        {searchModal && (
          <LeadSearchModal open={searchModal} onClose={() => { setSearchModal(false); router.refresh(); }} />
        )}
        {csvModal && (
          <ContactCsvImportModal open={csvModal} onClose={() => { setCsvModal(false); router.refresh(); }} />
        )}
        {addModal && (
          <AddContactModal open={addModal} onClose={() => { setAddModal(false); router.refresh(); }} contact={null} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Total Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{(stats.total ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Valid Emails</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">
              {(stats.valid ?? 0).toLocaleString()}
              <span className="text-sm text-gray-400 ml-2">
                {stats.total > 0 ? ((stats.valid / stats.total) * 100).toFixed(1) : "0.0"}%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Pending Verification</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gray-300">{(stats.pending ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Suppressed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{(stats.suppressed ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        {hasOutscraper && (
          <button
            onClick={() => setSearchModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Search className="w-4 h-4" /> Search Leads
          </button>
        )}
        <button
          onClick={() => setCsvModal(true)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Upload className="w-4 h-4" /> Import CSV
        </button>
        <button
          onClick={() => { setEditingContact(null); setAddModal(true); }}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Contact
        </button>
        {hasReoon && selected.size > 0 && (
          <button
            onClick={handleVerifySelected}
            disabled={verifying}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" /> Verify Selected ({selected.size})
          </button>
        )}
        {hasReoon && stats.pending > 0 && (
          <button
            onClick={handleVerifyAllPending}
            disabled={verifying}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" /> Verify All Pending ({stats.pending})
          </button>
        )}
        {selected.size > 0 && (
          <button
            onClick={() => setCampaignModal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Send className="w-4 h-4" /> Add to Campaign ({selected.size})
          </button>
        )}
      </div>

      {/* Filters */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">State</label>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm"
              >
                <option value="">All States</option>
                {stateOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">City</label>
              <input
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="Any city"
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm w-32"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Business Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm"
              >
                <option value="">All Types</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Email Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm"
              >
                <option value="">All</option>
                <option value="valid">Valid</option>
                <option value="invalid">Invalid</option>
                <option value="risky">Risky</option>
                <option value="unknown">Unknown</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Search</label>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Name, email..."
                className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-1.5 text-sm w-40"
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <button
              onClick={applyFilters}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
            >
              <Filter className="w-4 h-4 inline mr-1" /> Apply
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-3 px-4 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === contacts.length && contacts.length > 0}
                      onChange={toggleAll}
                      className="rounded border-gray-600"
                    />
                  </th>
                  <th className="py-3 px-4 text-left text-gray-400">Business Name</th>
                  <th className="py-3 px-4 text-left text-gray-400">Email</th>
                  <th className="py-3 px-4 text-left text-gray-400">Status</th>
                  <th className="py-3 px-4 text-left text-gray-400">Phone</th>
                  <th className="py-3 px-4 text-left text-gray-400">City</th>
                  <th className="py-3 px-4 text-left text-gray-400">State</th>
                  <th className="py-3 px-4 text-left text-gray-400">Type</th>
                  <th className="py-3 px-4 text-left text-gray-400">Tags</th>
                  <th className="py-3 px-4 text-right text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="border-b border-gray-800 hover:bg-gray-800/50"
                  >
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selected.has(contact.id)}
                        onChange={() => toggleSelect(contact.id)}
                        className="rounded border-gray-600"
                      />
                    </td>
                    <td className="py-3 px-4 text-white font-medium">
                      {contact.business_name || "—"}
                    </td>
                    <td className="py-3 px-4 text-gray-300 font-mono text-xs">
                      {contact.email || "—"}
                    </td>
                    <td className="py-3 px-4">
                      <Badge className={STATUS_COLORS[contact.email_status] || STATUS_COLORS.pending}>
                        {contact.email_status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-400">{contact.phone || "—"}</td>
                    <td className="py-3 px-4 text-gray-400">{contact.city || "—"}</td>
                    <td className="py-3 px-4 text-gray-400">{contact.state || "—"}</td>
                    <td className="py-3 px-4 text-gray-400 text-xs">{contact.business_type || "—"}</td>
                    <td className="py-3 px-4">
                      {contact.tags?.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {contact.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs border-gray-600 text-gray-300">
                              {tag}
                            </Badge>
                          ))}
                          {contact.tags.length > 2 && (
                            <span className="text-xs text-gray-500">+{contact.tags.length - 2}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => { setEditingContact(contact); setAddModal(true); }}
                          className="p-1 text-gray-400 hover:text-white"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(contact.id)}
                          disabled={deleting === contact.id}
                          className="p-1 text-gray-400 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 py-1 text-white text-sm">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      {searchModal && (
        <LeadSearchModal open={searchModal} onClose={() => { setSearchModal(false); router.refresh(); }} />
      )}
      {csvModal && (
        <ContactCsvImportModal open={csvModal} onClose={() => { setCsvModal(false); router.refresh(); }} />
      )}
      {addModal && (
        <AddContactModal
          open={addModal}
          onClose={() => { setAddModal(false); setEditingContact(null); router.refresh(); }}
          contact={editingContact}
        />
      )}
      {campaignModal && (
        <AddToCampaignModal
          open={campaignModal}
          onClose={() => { setCampaignModal(false); setSelected(new Set()); router.refresh(); }}
          selectedIds={Array.from(selected)}
        />
      )}
    </div>
  );
}

// ============================================
// Inline Modal Components
// ============================================

function LeadSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [limit, setLimit] = useState(50);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<{ found: number; imported: number; duplicates: number } | null>(null);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (!query.trim() || !location.trim()) {
      setError("Please enter both business type and location");
      return;
    }
    setSearching(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/lead-contacts/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location, limit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResult(data);
      toast.success(`Found ${data.found} businesses, imported ${data.imported}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-4">Search for Leads</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Business Type</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., dentist, restaurant, plumber"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Atlanta GA, Miami FL"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Limit</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {result && (
            <div className="p-3 bg-gray-700 rounded text-sm">
              <p className="text-white">Found <strong>{result.found}</strong> businesses.</p>
              <p className="text-green-400">{result.imported} imported</p>
              <p className="text-gray-400">{result.duplicates} duplicates skipped</p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
            >
              Close
            </button>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg font-medium"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddContactModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact: LeadContact | null;
}) {
  const [form, setForm] = useState({
    business_name: contact?.business_name || "",
    business_type: contact?.business_type || "",
    first_name: contact?.first_name || "",
    last_name: contact?.last_name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    website: contact?.website || "",
    city: contact?.city || "",
    state: contact?.state || "",
    zip: contact?.zip || "",
    tags: contact?.tags?.join(", ") || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      };

      const url = contact ? `/api/lead-contacts/${contact.id}` : "/api/lead-contacts";
      const method = contact ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      toast.success(contact ? "Contact updated" : "Contact created");
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-4">
          {contact ? "Edit Contact" : "Add Contact"}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {(["business_name", "business_type", "first_name", "last_name", "email", "phone", "website", "city", "state", "zip", "tags"] as const).map((field) => (
            <div key={field} className={field === "business_name" || field === "email" || field === "website" || field === "tags" ? "col-span-2" : ""}>
              <label className="text-xs text-gray-400 block mb-1">{field.replace(/_/g, " ")}</label>
              <input
                type="text"
                value={form[field]}
                onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
                placeholder={field === "tags" ? "comma separated" : ""}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg font-medium">
            {saving ? "Saving..." : contact ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactCsvImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const CONTACT_FIELDS = [
    "business_name", "business_type", "first_name", "last_name",
    "email", "phone", "website", "address", "city", "state", "zip",
  ];

  const handleFile = (f: File) => {
    if (!f.name.endsWith(".csv")) {
      setError("Please upload a .csv file");
      return;
    }
    setFile(f);
    setError("");

    // Dynamic import papaparse
    import("papaparse").then((Papa) => {
      Papa.default.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (results: { data: Record<string, string>[]; errors: { message: string }[]; meta: { fields?: string[] } }) => {
          if (results.errors.length > 0) {
            setError(`Parse error: ${results.errors[0].message}`);
            return;
          }
          const csvHeaders = results.meta.fields || [];
          setHeaders(csvHeaders);
          setParsedData(results.data);

          // Auto-map
          const autoMap: Record<string, string> = {};
          CONTACT_FIELDS.forEach((field) => {
            const match = csvHeaders.find(
              (h: string) => h.toLowerCase().replace(/[\s_-]/g, "") === field.replace(/_/g, "")
            );
            if (match) autoMap[field] = match;
          });
          setColumnMap(autoMap);
        },
      });
    });
  };

  const handleImport = async () => {
    if (!columnMap.email) {
      setError("Email column mapping is required");
      return;
    }
    setImporting(true);
    setError("");
    setProgress(0);

    const batchSize = 20;
    let success = 0;
    let fail = 0;

    for (let i = 0; i < parsedData.length; i += batchSize) {
      const batch = parsedData.slice(i, i + batchSize);
      const contacts = batch.map((row) => {
        const mapped: Record<string, string> = { scrape_source: "csv" };
        CONTACT_FIELDS.forEach((field) => {
          const csvCol = columnMap[field];
          if (csvCol && row[csvCol]) {
            mapped[field] = row[csvCol];
          }
        });
        return mapped;
      }).filter((c) => c.email);

      try {
        const res = await fetch("/api/lead-contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contacts.length === 1 ? contacts[0] : contacts[0]),
        });
        // Import one at a time for proper upsert behavior
        for (const contact of contacts) {
          try {
            await fetch("/api/lead-contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(contact),
            });
            success++;
          } catch {
            fail++;
          }
        }
      } catch {
        fail += batch.length;
      }
      setProgress(Math.round(((i + batchSize) / parsedData.length) * 100));
    }

    setImporting(false);
    toast.success(`Imported ${success} contacts${fail > 0 ? `, ${fail} failed` : ""}`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-4">Import Contacts from CSV</h2>

        {!file && (
          <div
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".csv";
              input.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleFile(f);
              };
              input.click();
            }}
            className="border-2 border-dashed border-gray-600 rounded-lg p-12 text-center cursor-pointer hover:border-gray-500"
          >
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-4" />
            <p className="text-white font-medium">Drop CSV or click to browse</p>
          </div>
        )}

        {file && !importing && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">{file.name} — {parsedData.length} rows</p>
            <div className="grid grid-cols-2 gap-3">
              {CONTACT_FIELDS.map((field) => (
                <div key={field}>
                  <label className="text-xs text-gray-400 block mb-1">
                    {field.replace(/_/g, " ")}
                    {field === "email" && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  <select
                    value={columnMap[field] || ""}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1.5 text-sm"
                  >
                    <option value="">— Skip —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {importing && (
          <div className="py-8">
            <p className="text-white text-center mb-4">Importing contacts...</p>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-gray-400 text-center text-sm mt-2">{progress}%</p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

        {file && !importing && (
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium">Cancel</button>
            <button onClick={handleImport} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
              Import {parsedData.length} Contacts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddToCampaignModal({
  open,
  onClose,
  selectedIds,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
}) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [validOnly, setValidOnly] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped_suppressed: number; skipped_duplicate: number } | null>(null);
  const [error, setError] = useState("");

  // Fetch campaigns on mount
  useState(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCampaigns(data);
      })
      .catch(() => {});
  });

  const handleImport = async () => {
    if (!campaignId) {
      setError("Select a campaign");
      return;
    }
    setImporting(true);
    setError("");

    try {
      const body: { campaign_id: string; contact_ids?: string[]; filter?: { email_status: string } } = { campaign_id: campaignId };
      if (selectedIds.length > 0) {
        body.contact_ids = selectedIds;
      }
      if (validOnly) {
        body.filter = { email_status: "valid" };
      }

      const res = await fetch("/api/lead-contacts/import-to-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      toast.success(`Added ${data.imported} contacts to campaign`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-4">Add to Campaign</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            >
              <option value="">Select campaign...</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={validOnly}
              onChange={(e) => setValidOnly(e.target.checked)}
              className="rounded border-gray-600"
            />
            Only import verified (valid) emails
          </label>
          <p className="text-gray-400 text-sm">{selectedIds.length} contacts selected</p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {result && (
            <div className="p-3 bg-gray-700 rounded text-sm">
              <p className="text-green-400">{result.imported} added to campaign</p>
              {result.skipped_suppressed > 0 && (
                <p className="text-yellow-400">{result.skipped_suppressed} skipped (suppressed)</p>
              )}
              {result.skipped_duplicate > 0 && (
                <p className="text-gray-400">{result.skipped_duplicate} skipped (duplicates)</p>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium">
              {result ? "Done" : "Cancel"}
            </button>
            {!result && (
              <button onClick={handleImport} disabled={importing} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded-lg font-medium">
                {importing ? "Importing..." : "Import"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
