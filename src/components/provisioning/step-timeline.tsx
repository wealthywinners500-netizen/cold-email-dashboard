"use client";

import { useState } from "react";
import {
  Server,
  Globe,
  Settings,
  Download,
  Mail,
  Shield,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  Circle,
  XCircle,
  AlertTriangle,
  Loader2,
  MinusCircle,
} from "lucide-react";
import type { StepType, StepStatus } from "@/lib/provisioning/types";

const STEP_CONFIG: Record<StepType, { label: string; icon: React.ElementType }> = {
  create_vps: { label: "Create VPS Pair", icon: Server },
  set_ptr: { label: "Set PTR Records", icon: Globe },
  configure_registrar: { label: "Configure DNS Registrar", icon: Settings },
  await_dns_propagation: { label: "Wait for DNS Propagation", icon: Clock },
  install_hestiacp: { label: "Install HestiaCP", icon: Download },
  setup_dns_zones: { label: "Setup DNS Zones", icon: Globe },
  setup_mail_domains: { label: "Setup Mail Domains", icon: Mail },
  security_hardening: { label: "Security Hardening", icon: Shield },
  verification_gate: { label: "Verification Gate", icon: CheckCircle2 },
};

interface StepData {
  step_type: StepType;
  status: StepStatus;
  duration_ms?: number | null;
  output?: string | null;
  error_message?: string | null;
}

interface StepTimelineProps {
  steps: StepData[];
  onStepSelect?: (stepType: StepType) => void;
  selectedStep?: StepType | null;
}

function getStatusStyles(status: StepStatus) {
  switch (status) {
    case "completed":
      return {
        node: "bg-green-500/20 border-green-500 text-green-400",
        line: "bg-green-500",
        badge: "bg-green-900/60 text-green-300",
        badgeLabel: "Completed",
      };
    case "in_progress":
      return {
        node: "bg-blue-500/20 border-blue-500 text-blue-400 animate-pulse",
        line: "bg-blue-500/40",
        badge: "bg-blue-900/60 text-blue-300",
        badgeLabel: "In Progress",
      };
    case "failed":
      return {
        node: "bg-red-500/20 border-red-500 text-red-400",
        line: "bg-red-500/40",
        badge: "bg-red-900/60 text-red-300",
        badgeLabel: "Failed",
      };
    case "manual_required":
      return {
        node: "bg-yellow-500/20 border-yellow-500 text-yellow-400",
        line: "bg-yellow-500/40",
        badge: "bg-yellow-900/60 text-yellow-300",
        badgeLabel: "Manual Required",
      };
    case "skipped":
      return {
        node: "bg-gray-700/20 border-gray-600 border-dashed text-gray-500",
        line: "bg-gray-700",
        badge: "bg-gray-800/60 text-gray-400",
        badgeLabel: "Skipped",
      };
    default:
      return {
        node: "bg-gray-800/50 border-gray-700 text-gray-500",
        line: "bg-gray-700",
        badge: "bg-gray-800/60 text-gray-500",
        badgeLabel: "Pending",
      };
  }
}

function getStatusIcon(status: StepStatus) {
  switch (status) {
    case "completed":
      return CheckCircle2;
    case "in_progress":
      return Loader2;
    case "failed":
      return XCircle;
    case "manual_required":
      return AlertTriangle;
    case "skipped":
      return MinusCircle;
    default:
      return Circle;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function StepTimeline({ steps, onStepSelect, selectedStep }: StepTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<StepType>>(new Set());

  const toggleExpand = (stepType: StepType) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepType)) {
        next.delete(stepType);
      } else {
        next.add(stepType);
      }
      return next;
    });
  };

  return (
    <div className="relative space-y-0">
      {steps.map((step, index) => {
        const config = STEP_CONFIG[step.step_type];
        const styles = getStatusStyles(step.status);
        const StatusIcon = getStatusIcon(step.status);
        const StepIcon = config.icon;
        const isExpanded = expandedSteps.has(step.step_type);
        const isSelected = selectedStep === step.step_type;
        const isLast = index === steps.length - 1;
        const hasOutput = step.output || step.error_message;

        return (
          <div key={step.step_type} className="relative">
            {/* Connecting line */}
            {!isLast && (
              <div
                className={`absolute left-5 top-12 w-0.5 ${styles.line}`}
                style={{ height: isExpanded ? "calc(100% - 24px)" : "32px" }}
              />
            )}

            {/* Step node */}
            <div
              className={`flex items-start gap-4 p-3 rounded-lg cursor-pointer transition-colors ${
                isSelected ? "bg-gray-800/80" : "hover:bg-gray-800/40"
              }`}
              onClick={() => {
                if (hasOutput) toggleExpand(step.step_type);
                onStepSelect?.(step.step_type);
              }}
            >
              {/* Icon node */}
              <div className={`relative flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center ${styles.node}`}>
                {step.status === "in_progress" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : step.status === "completed" ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : step.status === "failed" ? (
                  <XCircle className="w-5 h-5" />
                ) : step.status === "manual_required" ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <StepIcon className="w-5 h-5" />
                )}
              </div>

              {/* Step info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm">{config.label}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${styles.badge}`}>
                    {styles.badgeLabel}
                  </span>
                  {step.duration_ms != null && (
                    <span className="text-xs text-gray-500">
                      {formatDuration(step.duration_ms)}
                    </span>
                  )}
                  {hasOutput && (
                    <span className="ml-auto text-gray-500">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </span>
                  )}
                </div>

                {step.error_message && !isExpanded && (
                  <p className="text-red-400 text-xs mt-1 truncate">{step.error_message}</p>
                )}
              </div>
            </div>

            {/* Expanded output */}
            {isExpanded && hasOutput && (
              <div className="ml-14 mr-3 mb-3 p-3 bg-gray-950 rounded-lg border border-gray-800 max-h-48 overflow-y-auto">
                {step.error_message && (
                  <p className="text-red-400 text-xs font-mono mb-2">{step.error_message}</p>
                )}
                {step.output && (
                  <pre className="text-gray-300 text-xs font-mono whitespace-pre-wrap break-all">
                    {step.output}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
