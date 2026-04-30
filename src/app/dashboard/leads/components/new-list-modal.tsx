"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { LeadList } from "@/lib/supabase/types";

export function NewListModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (list: LeadList) => void;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [vertical, setVertical] = useState("");
  const [subVertical, setSubVertical] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/leads/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          region: region.trim() || undefined,
          vertical: vertical.trim() || undefined,
          sub_vertical: subVertical.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create list");
      toast.success(`Created list "${data.list.name}"`);
      onCreated(data.list as LeadList);
      onClose();
      setName("");
      setRegion("");
      setVertical("");
      setSubVertical("");
      setDescription("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-4">New lead list</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Atlanta Senior Care"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Region</label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Atlanta GA"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Vertical
              </label>
              <input
                type="text"
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
                placeholder="Senior care"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Sub-vertical
            </label>
            <input
              type="text"
              value={subVertical}
              onChange={(e) => setSubVertical(e.target.value)}
              placeholder="Assisted living"
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 text-white rounded-lg font-medium"
            >
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
