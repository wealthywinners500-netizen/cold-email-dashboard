"use client";

import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { SequenceStep, ABVariant } from "@/lib/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus } from "lucide-react";
import { isFeatureEnabledSync } from "@/lib/featureFlags";
import { AddRandomSpintaxButton } from "@/components/campaigns/add-random-spintax-button";
import {
  AICopyBuilderModal,
  type GeneratedVariant,
} from "@/components/campaigns/ai-copy-builder-modal";
import { GrammarCheck } from "@/components/campaigns/grammar-check";

interface SequenceStepEditorProps {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
  readOnly?: boolean;
}

export function SequenceStepEditor({
  steps,
  onChange,
  readOnly = false,
}: SequenceStepEditorProps) {
  const [selectedStep, setSelectedStep] = useState<number>(0);
  const [selectedVariant, setSelectedVariant] = useState<string>("A");
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  // Phase 4: gate new spintax / AI / grammar UI behind FEATURE_CAMPAIGNS_V2.
  // Flag off → renders pixel-identical to pre-phase-4 (existing merge buttons unchanged).
  const v2 = isFeatureEnabledSync("campaigns_v2");

  const currentStep = steps[selectedStep];
  if (!currentStep) {
    return (
      <div className="text-center py-8 text-gray-400">
        No steps available
      </div>
    );
  }

  const currentVariant = currentStep.ab_variants.find(v => v.variant === selectedVariant);

  const handleStepChange = (field: string, value: any) => {
    if (readOnly) return;
    const updatedSteps = [...steps];
    updatedSteps[selectedStep] = {
      ...currentStep,
      [field]: value,
    };
    onChange(updatedSteps);
  };

  const handleVariantChange = (field: string, value: any) => {
    if (readOnly) return;
    const updatedSteps = [...steps];
    const variantIndex = currentStep.ab_variants.findIndex(v => v.variant === selectedVariant);
    if (variantIndex >= 0) {
      const updatedVariants = [...currentStep.ab_variants];
      updatedVariants[variantIndex] = {
        ...currentVariant!,
        [field]: value,
      };
      updatedSteps[selectedStep] = {
        ...currentStep,
        ab_variants: updatedVariants,
      };
      onChange(updatedSteps);
    }
  };

  const handleAddVariant = () => {
    if (readOnly) return;
    const variants = ['A', 'B', 'C', 'D'];
    const existingVariants = currentStep.ab_variants.map(v => v.variant);
    const nextVariant = variants.find(v => !existingVariants.includes(v));

    if (nextVariant) {
      const updatedSteps = [...steps];
      updatedSteps[selectedStep] = {
        ...currentStep,
        ab_variants: [
          ...currentStep.ab_variants,
          {
            variant: nextVariant,
            subject: "",
            body_html: "",
            body_text: "",
          },
        ],
      };
      onChange(updatedSteps);
      setSelectedVariant(nextVariant);
    }
  };

  const handleDeleteStep = () => {
    if (readOnly) return;
    const updatedSteps = steps.filter((_, i) => i !== selectedStep);
    onChange(updatedSteps);
    if (selectedStep > 0) {
      setSelectedStep(selectedStep - 1);
    }
  };

  const handleAddStep = () => {
    if (readOnly) return;
    const newStep: SequenceStep = {
      step_number: steps.length + 1,
      delay_days: 0,
      delay_hours: 0,
      subject: "",
      body_html: "",
      body_text: "",
      send_in_same_thread: steps.length > 0,
      ab_variants: [
        {
          variant: "A",
          subject: "",
          body_html: "",
          body_text: "",
        },
      ],
    };
    onChange([...steps, newStep]);
  };

  const insertMergeField = (field: "subject" | "body_html" | "body_text", mergeField: string) => {
    if (readOnly) return;
    const targetField = field === "body_html" ? "body_text" : field;
    const currentValue = targetField === "subject" ? currentVariant?.subject || "" : currentVariant?.body_text || "";
    const newValue = currentValue + mergeField;
    handleVariantChange(targetField, newValue);
  };

  return (
    <div className="space-y-6">
      {/* Step Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {steps.map((step, idx) => (
          <button
            key={idx}
            onClick={() => {
              setSelectedStep(idx);
              setSelectedVariant("A");
            }}
            className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-colors ${
              selectedStep === idx
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            Step {step.step_number}
          </button>
        ))}
        {!readOnly && (
          <button
            onClick={handleAddStep}
            className="flex-shrink-0 px-4 py-2 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            Add
          </button>
        )}
      </div>

      {/* Step Details */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">
            Step {currentStep.step_number} Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Delay */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Delay Days
              </label>
              <input
                type="number"
                min="0"
                value={currentStep.delay_days}
                onChange={(e) => handleStepChange("delay_days", parseInt(e.target.value))}
                disabled={readOnly}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Delay Hours
              </label>
              <input
                type="number"
                min="0"
                max="23"
                value={currentStep.delay_hours}
                onChange={(e) => handleStepChange("delay_hours", parseInt(e.target.value))}
                disabled={readOnly}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Same Thread Toggle */}
          {currentStep.step_number > 1 && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="same-thread"
                checked={currentStep.send_in_same_thread}
                onChange={(e) => handleStepChange("send_in_same_thread", e.target.checked)}
                disabled={readOnly}
                className="w-4 h-4 rounded cursor-pointer disabled:opacity-50"
              />
              <label htmlFor="same-thread" className="text-sm text-gray-300 cursor-pointer">
                Send in same thread
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* A/B Variants */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">A/B Variants</h3>
          <p className="text-xs text-gray-500">
            V3 Standard: Each variant needs unique body copy, not just unique subjects
          </p>
        </div>

        <Tabs.Root value={selectedVariant} onValueChange={setSelectedVariant}>
          <Tabs.List className="flex gap-1 bg-gray-800 rounded-lg p-1 mb-4 border border-gray-700">
            {currentStep.ab_variants.map((variant) => (
              <Tabs.Trigger
                key={variant.variant}
                value={variant.variant}
                className="px-4 py-2 rounded font-medium text-sm transition-colors text-gray-400 hover:text-white data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                disabled={readOnly}
              >
                {variant.variant}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {currentStep.ab_variants.map((variant) => (
            <Tabs.Content key={variant.variant} value={variant.variant} className="space-y-4">
              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Subject Line
                </label>
                <input
                  id={`step-subject`}
                  type="text"
                  value={variant.subject}
                  onChange={(e) => handleVariantChange("subject", e.target.value)}
                  disabled={readOnly}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Enter subject line"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Body
                </label>
                <textarea
                  id={`step-body_html`}
                  value={variant.body_text}
                  onChange={(e) => handleVariantChange("body_text", e.target.value)}
                  disabled={readOnly}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white font-mono text-sm min-h-[150px] disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="Enter email body"
                />
              </div>

              {/* Merge Fields */}
              {!readOnly && (
                <div className="flex gap-2">
                  <button
                    onClick={() => insertMergeField("body_html", "{{first_name}}")}
                    className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                  >
                    first_name
                  </button>
                  <button
                    onClick={() => insertMergeField("body_html", "{{last_name}}")}
                    className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                  >
                    last_name
                  </button>
                  <button
                    onClick={() => insertMergeField("body_html", "{{company_name}}")}
                    className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                  >
                    company_name
                  </button>
                </div>
              )}

              {/* Phase 4: spintax / AI / grammar — flag-gated, not readOnly */}
              {!readOnly && v2 && variant.variant === selectedVariant && (
                <div className="flex flex-wrap gap-2 items-center">
                  <AddRandomSpintaxButton
                    value={variant.body_text || ""}
                    onChange={(next) => handleVariantChange("body_text", next)}
                    intensity="minimal"
                  />
                  <button
                    type="button"
                    onClick={() => setAiModalOpen(true)}
                    className="px-3 py-1 text-xs bg-purple-700 hover:bg-purple-600 text-white rounded transition-colors"
                  >
                    AI Copy Builder
                  </button>
                </div>
              )}

              {/* Phase 4: grammar panel below body */}
              {!readOnly && v2 && variant.variant === selectedVariant && variant.body_text && (
                <div className="mt-2">
                  <GrammarCheck
                    text={variant.body_text || ""}
                    onApplySuggestion={(offset, length, replacement) => {
                      const current = variant.body_text || "";
                      const next =
                        current.slice(0, offset) + replacement + current.slice(offset + length);
                      handleVariantChange("body_text", next);
                    }}
                  />
                </div>
              )}
            </Tabs.Content>
          ))}
        </Tabs.Root>

        {!readOnly && currentStep.ab_variants.length < 4 && (
          <button
            onClick={handleAddVariant}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            Add Variant
          </button>
        )}
      </div>

      {/* Delete Step */}
      {!readOnly && steps.length > 1 && (
        <button
          onClick={handleDeleteStep}
          className="px-4 py-2 text-sm bg-red-900 hover:bg-red-800 text-red-200 rounded-lg transition-colors flex items-center gap-2"
        >
          <Trash2 size={16} />
          Delete Step
        </button>
      )}

      {/* Phase 4: AI Copy Builder modal — mounted ONCE outside the variant loop
          so it isn't remounted per variant. Gated on v2 + not readOnly. */}
      {v2 && !readOnly && (
        <AICopyBuilderModal
          open={aiModalOpen}
          onOpenChange={setAiModalOpen}
          onPick={(variants: GeneratedVariant[]) => {
            if (variants.length === 1) {
              // Replace current variant's subject + body.
              handleVariantChange("subject", variants[0].subject);
              handleVariantChange("body_text", variants[0].body);
            } else {
              // Replace all A/B/C/D variants in order, creating rows as needed.
              const variantLetters = ["A", "B", "C", "D"];
              const updatedSteps = [...steps];
              const newVariants: ABVariant[] = variants.slice(0, 4).map((gv, i) => ({
                variant: variantLetters[i],
                subject: gv.subject,
                body_html: "",
                body_text: gv.body,
              }));
              updatedSteps[selectedStep] = {
                ...currentStep,
                ab_variants: newVariants,
              };
              onChange(updatedSteps);
              setSelectedVariant("A");
            }
          }}
          availableVariables={["first_name", "last_name", "company_name"]}
        />
      )}
    </div>
  );
}
