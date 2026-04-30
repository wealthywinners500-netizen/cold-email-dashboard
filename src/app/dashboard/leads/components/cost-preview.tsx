"use client";

import { COST_PER_LEAD_USD, formatCostUsd } from "@/lib/outscraper/cost";

export function CostPreview({
  estimatedLeadCount,
}: {
  estimatedLeadCount: number;
}) {
  const cents = Math.round(
    Math.max(0, estimatedLeadCount) * COST_PER_LEAD_USD * 100
  );
  return (
    <div className="rounded border border-gray-700 bg-gray-800 p-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-gray-400">Estimated leads</span>
        <span className="text-white font-semibold">
          {estimatedLeadCount.toLocaleString()}
        </span>
      </div>
      <div className="flex items-baseline justify-between mt-1">
        <span className="text-gray-400">Estimated cost</span>
        <span className="text-white font-semibold">{formatCostUsd(cents)}</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Blended ${COST_PER_LEAD_USD.toFixed(4)}/lead — actual cost varies with
        results.
      </p>
    </div>
  );
}
