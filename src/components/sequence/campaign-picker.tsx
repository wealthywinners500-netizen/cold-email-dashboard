"use client";

// CC #UI-4 (2026-05-02): dropdown for picking which campaign a subsequence
// attaches to, used inside <SequenceComposerModal> when the modal is opened
// from the org-wide /dashboard/follow-ups Subsequences tab (no fixed
// campaign context). Disabled in edit mode — campaign re-attach is out of
// scope for this CC. Campaigns list is passed as a prop so the page can
// fetch once server-side and avoid an extra client roundtrip.

interface Campaign {
  id: string;
  name: string;
  status: string;
}

interface CampaignPickerProps {
  value: string | null;
  onChange: (campaignId: string) => void;
  campaigns: Campaign[];
  disabled?: boolean;
  error?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  active: "active",
  paused: "paused",
  scheduled: "scheduled",
  sending: "sending",
  completed: "completed",
};

export function CampaignPicker({
  value,
  onChange,
  campaigns,
  disabled = false,
  error,
}: CampaignPickerProps) {
  const visible = campaigns.filter((c) => c.status !== "archived");

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">
        Attach to Campaign
      </label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
        aria-label="Attach subsequence to campaign"
      >
        <option value="" disabled>
          {visible.length === 0 ? "No campaigns available" : "Pick a campaign…"}
        </option>
        {visible.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({STATUS_LABEL[c.status] ?? c.status})
          </option>
        ))}
      </select>
      {disabled && (
        <p className="text-xs text-gray-500 mt-1">
          Campaign attachment is locked when editing an existing subsequence.
        </p>
      )}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
