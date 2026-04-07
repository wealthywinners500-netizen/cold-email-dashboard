"use client";

import { CampaignSequence } from "@/lib/supabase/types";

interface SequenceFlowDiagramProps {
  sequences: CampaignSequence[];
}

export function SequenceFlowDiagram({ sequences }: SequenceFlowDiagramProps) {
  const primarySequence = sequences.find((s) => s.sequence_type === "primary");
  const subsequences = sequences.filter((s) => s.sequence_type === "subsequence");

  if (!primarySequence) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        No primary sequence found
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-8">
      <div className="space-y-8">
        {/* Primary Sequence */}
        <div className="flex flex-col items-center">
          <div className="bg-blue-900 border-2 border-blue-600 rounded-lg px-6 py-4 text-center">
            <h3 className="text-white font-semibold mb-3">{primarySequence.name}</h3>
            <div className="flex items-center gap-3 justify-center">
              {primarySequence.steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                    {step.step_number}
                  </div>
                  {idx < primarySequence.steps.length - 1 && (
                    <div className="w-6 h-0.5 bg-blue-600"></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Connector line to subsequences */}
          {subsequences.length > 0 && (
            <div className="w-0.5 h-12 bg-gray-700 my-4"></div>
          )}
        </div>

        {/* Subsequences */}
        {subsequences.length > 0 && (
          <div className="space-y-6">
            {subsequences.map((subseq) => {
              let triggerLabel = "";
              if (subseq.trigger_event === "Reply Classified") {
                const condition = subseq.trigger_condition as any;
                triggerLabel = `Classified as ${condition?.classification || "Unknown"}`;
              } else if (subseq.trigger_event === "No Reply") {
                const condition = subseq.trigger_condition as any;
                triggerLabel = `No reply after ${condition?.days || 0} days`;
              } else {
                triggerLabel = subseq.trigger_event || "Unknown";
              }

              return (
                <div key={subseq.id} className="flex items-center gap-4">
                  {/* Arrow and trigger label */}
                  <div className="flex-shrink-0 text-right w-40">
                    <div className="text-xs text-gray-400 mb-1">Trigger:</div>
                    <div className="text-xs text-gray-300 bg-gray-800 rounded px-2 py-1">
                      {triggerLabel}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex-shrink-0">
                    <svg width="32" height="24" viewBox="0 0 32 24" className="text-gray-600">
                      <path
                        d="M0 12 L24 12 M20 8 L24 12 L20 16"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                      />
                    </svg>
                  </div>

                  {/* Subsequence Box */}
                  <div className="flex-1 bg-amber-900 border-2 border-amber-600 rounded-lg px-6 py-4">
                    <h4 className="text-white font-semibold mb-3">{subseq.name}</h4>
                    <div className="flex items-center gap-3">
                      {subseq.steps.map((step, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs font-bold">
                            {step.step_number}
                          </div>
                          {idx < subseq.steps.length - 1 && (
                            <div className="w-4 h-0.5 bg-amber-600"></div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
