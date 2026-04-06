"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";

interface CreateServerPairModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}

export default function CreateServerPairModal({
  open,
  onOpenChange,
  editData,
}: CreateServerPairModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!formData.pair_number || formData.pair_number <= 0)
      newErrors.pair_number = "Pair number must be a positive integer";
    if (!formData.ns_domain?.trim() || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(formData.ns_domain.trim()))
      newErrors.ns_domain = "Enter a valid domain (e.g., ns.example.com)";
    if (!formData.s1_ip?.trim() || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(formData.s1_ip.trim()))
      newErrors.s1_ip = "Enter a valid IPv4 address";
    if (!formData.s1_hostname?.trim() || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(formData.s1_hostname.trim()))
      newErrors.s1_hostname = "Enter a valid hostname";
    if (!formData.s2_ip?.trim() || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(formData.s2_ip.trim()))
      newErrors.s2_ip = "Enter a valid IPv4 address";
    if (!formData.s2_hostname?.trim() || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(formData.s2_hostname.trim()))
      newErrors.s2_hostname = "Enter a valid hostname";
    setFieldErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const [formData, setFormData] = useState({
    pair_number: editData?.pair_number || "",
    ns_domain: editData?.ns_domain || "",
    s1_ip: editData?.s1_ip || "",
    s1_hostname: editData?.s1_hostname || "",
    s2_ip: editData?.s2_ip || "",
    s2_hostname: editData?.s2_hostname || "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "pair_number" ? parseInt(value) || "" : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);

    try {
      const url = editData
        ? `/api/server-pairs/${editData.id}`
        : "/api/server-pairs";
      const method = editData ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to save server pair");
      }

      onOpenChange(false);
      toast.success("Server pair saved successfully");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save server pair";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editData || !window.confirm("Are you sure you want to delete this server pair?")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/server-pairs/${editData.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete server pair");
      }

      onOpenChange(false);
      toast.success("Server pair deleted");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete server pair";
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
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-800 rounded-lg shadow-lg z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-xl font-bold text-white">
              {editData ? "Edit Server Pair" : "Add Server Pair"}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300">
                Pair Number
              </label>
              <input
                type="number"
                name="pair_number"
                value={formData.pair_number}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.pair_number && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.pair_number}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">
                NS Domain
              </label>
              <input
                type="text"
                name="ns_domain"
                value={formData.ns_domain}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.ns_domain && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.ns_domain}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-300">
                  S1 IP
                </label>
                <input
                  type="text"
                  name="s1_ip"
                  value={formData.s1_ip}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.s1_ip && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.s1_ip}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300">
                  S1 Hostname
                </label>
                <input
                  type="text"
                  name="s1_hostname"
                  value={formData.s1_hostname}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.s1_hostname && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.s1_hostname}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-300">
                  S2 IP
                </label>
                <input
                  type="text"
                  name="s2_ip"
                  value={formData.s2_ip}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.s2_ip && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.s2_ip}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300">
                  S2 Hostname
                </label>
                <input
                  type="text"
                  name="s2_hostname"
                  value={formData.s2_hostname}
                  onChange={handleChange}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                {fieldErrors.s2_hostname && (
                  <p className="text-red-400 text-xs mt-1">{fieldErrors.s2_hostname}</p>
                )}
              </div>
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
                {loading ? "Saving..." : editData ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
