"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { isFeatureEnabledSync } from "@/lib/featureFlags";

// Phase 4 additions — full shape used by formData. The flag-off path uses only
// the first four fields; the flag-on path adds the rest via collapsible sections.
interface CampaignFormState {
  name: string;
  region: string;
  store_chain: string;
  status: string;
  sending_schedule: {
    start_hour: number;
    end_hour: number;
    timezone: string;
    days_of_week: string[];
  };
  track_opens: boolean;
  track_clicks: boolean;
  include_unsubscribe: boolean;
  ramp_enabled: boolean;
  ramp_start_rate: number | null;
  ramp_increment: number | null;
  ramp_target_rate: number | null;
}

interface CreateCampaignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}

export default function CreateCampaignModal({
  open,
  onOpenChange,
  editData,
}: CreateCampaignModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!formData.name?.trim()) newErrors.name = "Campaign name is required";
    if (!formData.region?.trim()) newErrors.region = "Region is required";
    setFieldErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const [formData, setFormData] = useState<CampaignFormState>({
    name: editData?.name || "",
    region: editData?.region || "",
    store_chain: editData?.store_chain || "",
    status: editData?.status || "active",
    // Phase 4 (flag-gated) — defaults match migration 016 column defaults where
    // the DB has them, else pick sensible baselines. Always serialized on POST;
    // API insert is a spread so unknown keys just pass through.
    sending_schedule: editData?.sending_schedule || {
      start_hour: 9,
      end_hour: 17,
      timezone: "America/New_York",
      days_of_week: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    },
    track_opens: editData?.track_opens ?? false,
    track_clicks: editData?.track_clicks ?? false,
    include_unsubscribe: editData?.include_unsubscribe ?? false,
    ramp_enabled: editData?.ramp_enabled ?? false,
    ramp_start_rate: editData?.ramp_start_rate ?? null,
    ramp_increment: editData?.ramp_increment ?? null,
    ramp_target_rate: editData?.ramp_target_rate ?? null,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);

    try {
      const url = editData ? `/api/campaigns/${editData.id}` : "/api/campaigns";
      const method = editData ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error("Failed to save campaign");
      }

      onOpenChange(false);
      toast.success("Campaign saved successfully");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save campaign";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editData || !window.confirm("Are you sure you want to delete this campaign?")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${editData.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete campaign");
      }

      onOpenChange(false);
      toast.success("Campaign deleted");
      router.refresh();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to delete campaign";
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
              {editData ? "Edit Campaign" : "Create Campaign"}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-300">
                Campaign Name
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.name && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">Region</label>
              <input
                type="text"
                name="region"
                value={formData.region}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {fieldErrors.region && (
                <p className="text-red-400 text-xs mt-1">{fieldErrors.region}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">
                Store Chain
              </label>
              <input
                type="text"
                name="store_chain"
                value={formData.store_chain}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            {/* Phase 4: flag-gated v2 settings sections. Flag off → identical to
                pre-phase-4 layout. Flag on → collapsible sending window, tracking,
                unsubscribe, and ramp-up controls. All fields serialized on submit. */}
            {isFeatureEnabledSync("campaigns_v2") && (
              <div className="space-y-4 pt-4 border-t border-gray-700">
                {/* Sending Window */}
                <details open>
                  <summary className="text-sm font-medium text-gray-300 cursor-pointer">
                    Sending Window
                  </summary>
                  <div className="space-y-2 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-gray-400">
                        Start hour
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={formData.sending_schedule.start_hour}
                          onChange={(e) =>
                            setFormData((p) => ({
                              ...p,
                              sending_schedule: {
                                ...p.sending_schedule,
                                start_hour: parseInt(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                        />
                      </label>
                      <label className="text-xs text-gray-400">
                        End hour
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={formData.sending_schedule.end_hour}
                          onChange={(e) =>
                            setFormData((p) => ({
                              ...p,
                              sending_schedule: {
                                ...p.sending_schedule,
                                end_hour: parseInt(e.target.value) || 0,
                              },
                            }))
                          }
                          className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                        />
                      </label>
                    </div>
                    <label className="text-xs text-gray-400 block">
                      Timezone
                      <select
                        value={formData.sending_schedule.timezone}
                        onChange={(e) =>
                          setFormData((p) => ({
                            ...p,
                            sending_schedule: {
                              ...p.sending_schedule,
                              timezone: e.target.value,
                            },
                          }))
                        }
                        className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                      >
                        <option value="America/New_York">America/New_York</option>
                        <option value="America/Chicago">America/Chicago</option>
                        <option value="America/Denver">America/Denver</option>
                        <option value="America/Los_Angeles">America/Los_Angeles</option>
                        <option value="UTC">UTC</option>
                      </select>
                    </label>
                    <div>
                      <span className="text-xs text-gray-400">Days of week</span>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => {
                          const checked = formData.sending_schedule.days_of_week.includes(d);
                          return (
                            <label
                              key={d}
                              className="text-xs text-gray-300 flex items-center gap-1"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const days = formData.sending_schedule.days_of_week;
                                  const next = e.target.checked
                                    ? [...days, d]
                                    : days.filter((x) => x !== d);
                                  setFormData((p) => ({
                                    ...p,
                                    sending_schedule: {
                                      ...p.sending_schedule,
                                      days_of_week: next,
                                    },
                                  }));
                                }}
                              />
                              {d}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </details>

                {/* Tracking */}
                <details>
                  <summary className="text-sm font-medium text-gray-300 cursor-pointer">
                    Tracking
                  </summary>
                  <div className="space-y-2 mt-2">
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={formData.track_opens}
                        onChange={(e) =>
                          setFormData((p) => ({ ...p, track_opens: e.target.checked }))
                        }
                      />
                      Track opens (open pixel)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={formData.track_clicks}
                        onChange={(e) =>
                          setFormData((p) => ({ ...p, track_clicks: e.target.checked }))
                        }
                      />
                      Track clicks (rewrite links)
                    </label>
                    {(formData.track_opens || formData.track_clicks) && (
                      <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded p-2">
                        Tracking can hurt deliverability for cold outbound. Leave off unless required.
                      </div>
                    )}
                  </div>
                </details>

                {/* Unsubscribe */}
                <details>
                  <summary className="text-sm font-medium text-gray-300 cursor-pointer">
                    Unsubscribe
                  </summary>
                  <div className="space-y-2 mt-2">
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={formData.include_unsubscribe}
                        onChange={(e) =>
                          setFormData((p) => ({
                            ...p,
                            include_unsubscribe: e.target.checked,
                          }))
                        }
                      />
                      Include unsubscribe link + List-Unsubscribe header
                    </label>
                  </div>
                </details>

                {/* Ramp-up */}
                <details>
                  <summary className="text-sm font-medium text-gray-300 cursor-pointer">
                    Ramp-up (optional)
                  </summary>
                  <div className="space-y-2 mt-2">
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={formData.ramp_enabled}
                        onChange={(e) =>
                          setFormData((p) => ({ ...p, ramp_enabled: e.target.checked }))
                        }
                      />
                      Enable ramp-up
                    </label>
                    {formData.ramp_enabled && (
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-xs text-gray-400">
                          Start rate
                          <input
                            type="number"
                            min="1"
                            value={formData.ramp_start_rate ?? ""}
                            onChange={(e) =>
                              setFormData((p) => ({
                                ...p,
                                ramp_start_rate: e.target.value
                                  ? parseInt(e.target.value)
                                  : null,
                              }))
                            }
                            className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                          />
                        </label>
                        <label className="text-xs text-gray-400">
                          Daily +
                          <input
                            type="number"
                            min="1"
                            value={formData.ramp_increment ?? ""}
                            onChange={(e) =>
                              setFormData((p) => ({
                                ...p,
                                ramp_increment: e.target.value
                                  ? parseInt(e.target.value)
                                  : null,
                              }))
                            }
                            className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                          />
                        </label>
                        <label className="text-xs text-gray-400">
                          Target
                          <input
                            type="number"
                            min="1"
                            value={formData.ramp_target_rate ?? ""}
                            onChange={(e) =>
                              setFormData((p) => ({
                                ...p,
                                ramp_target_rate: e.target.value
                                  ? parseInt(e.target.value)
                                  : null,
                              }))
                            }
                            className="w-full bg-gray-700 border border-gray-600 text-white rounded px-2 py-1 mt-1"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            )}

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
