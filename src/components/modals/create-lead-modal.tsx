"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

interface CreateLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}

export default function CreateLeadModal({
  open,
  onOpenChange,
  editData,
}: CreateLeadModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!formData.source?.trim()) newErrors.source = "Source is required";
    if (!formData.city?.trim()) newErrors.city = "City is required";
    if (!formData.state?.trim()) newErrors.state = "State is required";
    if (formData.total_scraped !== "" && Number(formData.total_scraped) < 0)
      newErrors.total_scraped = "Must be non-negative";
    if (formData.verified_count !== "" && Number(formData.verified_count) < 0)
      newErrors.verified_count = "Must be non-negative";
    if (formData.cost_per_lead !== "" && Number(formData.cost_per_lead) < 0)
      newErrors.cost_per_lead = "Must be non-negative";
    setFieldErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const [formData, setFormData] = useState({
    source: editData?.source || "",
    city: editData?.city || "",
    state: editData?.state || "",
    total_scraped: editData?.total_scraped || "",
    verified_count: editData?.verified_count || "",
    cost_per_lead: editData?.cost_per_lead || "",
    status: editData?.status || "pending",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "total_scraped" ||
        name === "verified_count" ||
        name === "cost_per_lead"
          ? value === ""
            ? ""
            : parseFloat(value)
          : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);

    try {
      const url = editData ? `/api/leads/${editData.id}` : "/api/leads";
      const method = editData ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to save lead");
      }

      onOpenChange(false);
      toast.success("Lead saved successfully");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save lead";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editData || !window.confirm("Are you sure you want to delete this lead?")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/leads/${editData.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete lead");
      }

      onOpenChange(false);
      toast.success("Lead deleted");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete lead";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-800 rounded-lg shadow-lg z-50 p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">
              {editData ? "Edit Lead" : "Import Lead"}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300">Source</label>
              <input
                type="text"
                name="source"
                value={formData.source}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.source && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.source}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-300">City</label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.city && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.city}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300">State</label>
                <input
                  type="text"
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.state && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.state}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">
                Total Scraped
              </label>
              <input
                type="number"
                name="total_scraped"
                value={formData.total_scraped}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.total_scraped && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.total_scraped}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">
                Verified Count
              </label>
              <input
                type="number"
                name="verified_count"
                value={formData.verified_count}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.verified_count && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.verified_count}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">
                Cost Per Lead
              </label>
              <input
                type="number"
                name="cost_per_lead"
                value={formData.cost_per_lead}
                onChange={handleChange}
                step="0.0001"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.cost_per_lead && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.cost_per_lead}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              {editData && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white rounded-lg font-medium transition-colors"
                >
                  Delete
                </button>
              )}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? "Saving..." : editData ? "Update" : "Import"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
