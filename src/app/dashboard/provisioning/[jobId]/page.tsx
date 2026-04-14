"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Loader2,
  XCircle,
  CheckCircle2,
  Download,
  Server,
  RotateCcw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { StepTimeline } from "@/components/provisioning/step-timeline";
import { SSHLogViewer } from "@/components/provisioning/ssh-log-viewer";
import { useRealtimeCallback } from "@/hooks/use-realtime";
import type { ProvisioningJobRow, StepType, StepStatus } from "@/lib/provisioning/types";

interface StepData {
  step_type: StepType;
  status: StepStatus;
  duration_ms?: number | null;
  output?: string | null;
  error_message?: string | null;
}

interface LogLine {
  timestamp?: string;
  text: string;
  type: "stdout" | "stderr" | "progress";
}

const STEP_NAMES: Record<StepType, string> = {
  create_vps: "Create VPS Pair",
  install_hestiacp: "Install HestiaCP",
  configure_registrar: "Configure DNS Registrar",
  await_dns_propagation: "Await DNS Propagation",
  setup_dns_zones: "Setup DNS Zones",
  set_ptr: "Set PTR Records",
  setup_mail_domains: "Setup Mail Domains",
  security_hardening: "Security Hardening",
  verification_gate: "Verification Gate",
};

function estimateTimeRemaining(progressPct: number, startedAt: string | null): string {
  if (!startedAt || progressPct <= 0) return "Calculating...";
  const elapsed = Date.now() - new Date(startedAt).getTime();
  if (progressPct >= 100) return "Done";
  const estimated = (elapsed / progressPct) * (100 - progressPct);
  const minutes = Math.ceil(estimated / 60_000);
  if (minutes <= 1) return "Less than a minute";
  return `~${minutes} minutes remaining`;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<ProvisioningJobRow | null>(null);
  const [steps, setSteps] = useState<StepData[]>([]);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [selectedStep, setSelectedStep] = useState<StepType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [dryRunExecuting, setDryRunExecuting] = useState(false);
  const dryRunAbortRef = useRef(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 5;

  // Supabase Realtime: re-fetch job+steps when DB changes (worker callbacks)
  // This gives instant UI updates even when the saga loop is idle/waiting
  const refreshJobData = useCallback(async () => {
    try {
      const res = await fetch(`/api/provisioning/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
        setSteps(data.steps);
      }
    } catch {
      // silently fail
    }
  }, [jobId]);

  useRealtimeCallback("provisioning_steps", refreshJobData, {
    column: "job_id",
    value: jobId,
  });

  // Fetch initial job data
  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await fetch(`/api/provisioning/${jobId}`);
        if (!res.ok) {
          setError("Job not found");
          return;
        }
        const data = await res.json();
        setJob(data.job);
        setSteps(data.steps);
      } catch {
        setError("Failed to load job");
      } finally {
        setLoading(false);
      }
    }
    fetchJob();
  }, [jobId]);

  // SSE connection
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/provisioning/${jobId}/progress`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSseConnected(true);
      retryCountRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "init":
            setJob((prev) => prev ? { ...prev, ...data.job } : prev);
            if (data.steps) {
              setSteps(data.steps);
            }
            break;

          case "progress":
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    progress_pct: data.pct,
                    current_step: data.step,
                    status: "in_progress",
                  }
                : prev
            );
            if (data.message) {
              setLogLines((prev) => [
                ...prev,
                {
                  timestamp: new Date().toLocaleTimeString(),
                  text: data.message,
                  type: "progress",
                },
              ]);
            }
            break;

          case "step_complete":
            setSteps((prev) =>
              prev.map((s) =>
                s.step_type === data.step
                  ? { ...s, status: "completed" as StepStatus, duration_ms: data.duration_ms }
                  : s
              )
            );
            setLogLines((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString(),
                text: `✓ ${STEP_NAMES[data.step as StepType] || data.step} completed (${data.duration_ms}ms)`,
                type: "stdout",
              },
            ]);
            break;

          case "complete":
            setJob((prev) =>
              prev
                ? { ...prev, status: "completed", progress_pct: 100, server_pair_id: data.server_pair_id }
                : prev
            );
            setLogLines((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString(),
                text: "🎉 Provisioning complete! Server pair is ready.",
                type: "stdout",
              },
            ]);
            es.close();
            break;

          case "error":
            setJob((prev) =>
              prev ? { ...prev, status: "failed", error_message: data.message } : prev
            );
            if (data.step) {
              setSteps((prev) =>
                prev.map((s) =>
                  s.step_type === data.step
                    ? { ...s, status: "failed" as StepStatus, error_message: data.message }
                    : s
                )
              );
            }
            setLogLines((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString(),
                text: `ERROR: ${data.message}`,
                type: "stderr",
              },
            ]);
            es.close();
            break;

          case "worker_step":
            // Worker VPS is running a step — update timeline to show in_progress
            if (data.step) {
              setSteps((prev) =>
                prev.map((s) =>
                  s.step_type === data.step
                    ? { ...s, status: "in_progress" as StepStatus }
                    : s
                )
              );
              setJob((prev) =>
                prev ? { ...prev, current_step: data.step } : prev
              );
            }
            break;

          case "timeout":
            setLogLines((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString(),
                text: `TIMEOUT: ${data.message}`,
                type: "stderr",
              },
            ]);
            es.close();
            break;
        }
      } catch {
        // Parse error — skip
      }
    };

    es.onerror = () => {
      setSseConnected(false);
      es.close();

      // Auto-reconnect with exponential backoff
      if (retryCountRef.current < maxRetries) {
        const delay = Math.pow(2, retryCountRef.current) * 1000;
        retryCountRef.current++;
        setTimeout(connectSSE, delay);
      }
    };
  }, [jobId]);

  // Client-driven saga execution loop
  // Hard lesson (Test #12, 2026-04-10): This loop was previously gated on
  // provider_type === "dry_run", which left real provisioning jobs frozen at
  // pending forever because (a) pollProvisioningJobs cron is disabled and
  // (b) the legacy monolithic handler is disabled. The canonical path is now
  // exclusively client → /execute-step → worker bridge, so this loop must
  // run for ALL provider types. The /execute-step route handles serverless
  // steps (3,5) inline and dispatches worker steps (1,2,4,6,7,8) to the VPS.
  const executeDryRunLoop = useCallback(async () => {
    if (dryRunExecuting) return;
    setDryRunExecuting(true);
    dryRunAbortRef.current = false;

    // Track which steps we've already logged as dispatched to avoid duplicate log lines
    const loggedDispatched = new Set<string>();

    try {
      while (!dryRunAbortRef.current) {
        const res = await fetch(`/api/provisioning/${jobId}/execute-step`, {
          method: "POST",
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Request failed" }));
          setLogLines((prev) => [
            ...prev,
            { timestamp: new Date().toLocaleTimeString(), text: `ERROR: ${errData.error}`, type: "stderr" as const },
          ]);
          break;
        }

        const data = await res.json();

        // Always update progress from server response
        if (data.progress_pct !== undefined) {
          setJob((prev) =>
            prev ? { ...prev, progress_pct: data.progress_pct } : prev
          );
        }

        // Handle step completed
        if (data.step && data.status === "completed") {
          loggedDispatched.delete(data.step);
          setSteps((prev) =>
            prev.map((s) =>
              s.step_type === data.step
                ? { ...s, status: "completed" as StepStatus, duration_ms: data.duration_ms }
                : s
            )
          );
          setLogLines((prev) => [
            ...prev,
            {
              timestamp: new Date().toLocaleTimeString(),
              text: `✓ ${STEP_NAMES[data.step as StepType] || data.step} completed (${Math.round((data.duration_ms || 0) / 1000)}s)`,
              type: "stdout" as const,
            },
          ]);
          setJob((prev) =>
            prev ? { ...prev, status: "in_progress" } : prev
          );
          // Quick pace for next step dispatch
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        // Handle step dispatched to worker
        if (data.status === "dispatched_to_worker" && data.step) {
          setSteps((prev) =>
            prev.map((s) =>
              s.step_type === data.step
                ? { ...s, status: "in_progress" as StepStatus }
                : s
            )
          );
          setJob((prev) =>
            prev ? { ...prev, status: "in_progress", current_step: data.step } : prev
          );
          if (!loggedDispatched.has(data.step)) {
            loggedDispatched.add(data.step);
            setLogLines((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString(),
                text: `⚙ ${STEP_NAMES[data.step as StepType] || data.step} dispatched to worker VPS...`,
                type: "progress" as const,
              },
            ]);
          }
          // Worker steps take time — poll with 5s delay
          await new Promise((r) => setTimeout(r, 5_000));
          continue;
        }

        // Handle awaiting worker completion OR step still executing
        if ((data.status === "awaiting_worker" || data.status === "in_progress") && data.step) {
          setSteps((prev) =>
            prev.map((s) =>
              s.step_type === data.step
                ? { ...s, status: "in_progress" as StepStatus }
                : s
            )
          );
          setJob((prev) =>
            prev ? { ...prev, status: "in_progress", current_step: data.step } : prev
          );
          // Poll at 5s intervals while step runs
          await new Promise((r) => setTimeout(r, 5_000));
          continue;
        }

        // Handle all complete
        if (data.allComplete) {
          setJob((prev) =>
            prev ? { ...prev, status: "completed", progress_pct: 100 } : prev
          );
          setLogLines((prev) => [
            ...prev,
            { timestamp: new Date().toLocaleTimeString(), text: "🎉 Provisioning complete! Server pair is ready.", type: "stdout" as const },
          ]);
          // Refresh to get server_pair_id and final step data
          const refreshRes = await fetch(`/api/provisioning/${jobId}`);
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            setJob(refreshData.job);
            setSteps(refreshData.steps);
          }
          break;
        }

        // Handle failure
        if (data.status === "failed") {
          setJob((prev) =>
            prev ? { ...prev, status: "failed", error_message: data.error } : prev
          );
          if (data.step) {
            setSteps((prev) =>
              prev.map((s) =>
                s.step_type === data.step
                  ? { ...s, status: "failed" as StepStatus, error_message: data.error }
                  : s
              )
            );
          }
          setLogLines((prev) => [
            ...prev,
            { timestamp: new Date().toLocaleTimeString(), text: `ERROR: ${data.error}`, type: "stderr" as const },
          ]);
          break;
        }

        // Handle terminal states returned from already-finished jobs
        if (["completed", "failed", "rolled_back", "cancelled"].includes(data.status)) {
          setJob((prev) =>
            prev ? { ...prev, status: data.status, progress_pct: data.progress_pct } : prev
          );
          break;
        }

        // Default pacing for serverless steps
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      setLogLines((prev) => [
        ...prev,
        { timestamp: new Date().toLocaleTimeString(), text: `Network error: ${err}`, type: "stderr" as const },
      ]);
    } finally {
      setDryRunExecuting(false);
    }
  }, [jobId, dryRunExecuting]);

  useEffect(() => {
    if (job && (job.status === "pending" || job.status === "in_progress")) {
      connectSSE();
    }

    return () => {
      eventSourceRef.current?.close();
    };
  }, [job?.status, connectSSE]);

  // Auto-start saga execution loop when job loads.
  // Runs for ALL provider types (dry_run + real) because the canonical
  // execute-step → worker bridge is the only active saga driver — the worker
  // pollProvisioningJobs cron and legacy monolithic handler are both disabled.
  useEffect(() => {
    if (
      job &&
      !dryRunExecuting &&
      (job.status === "pending" || job.status === "in_progress")
    ) {
      executeDryRunLoop();
    }
  }, [job?.id, job?.status]);

  const handleCancel = async () => {
    if (!confirm("Cancel this provisioning job? Any created resources will be rolled back.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/provisioning/${jobId}`, { method: "DELETE" });
      if (res.ok) {
        setJob((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
        eventSourceRef.current?.close();
      }
    } catch {
      // silently fail
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    // For DryRun, retry by re-executing the loop
    if (
      job?.config &&
      typeof job.config === "object" &&
      (job.config as Record<string, unknown>).provider_type === "dry_run"
    ) {
      // Reset the failed step to pending so it can be re-executed
      setJob((prev) => prev ? { ...prev, status: "in_progress", error_message: null } : prev);
      executeDryRunLoop();
      return;
    }
    // For real providers, redirect to wizard
    router.push("/dashboard/provisioning/new");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="text-center py-20">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl text-white font-medium mb-2">{error || "Job not found"}</h2>
        <button
          onClick={() => router.push("/dashboard/provisioning")}
          className="text-blue-400 hover:text-blue-300 text-sm"
        >
          ← Back to Provisioning
        </button>
      </div>
    );
  }

  const isTerminal = ["completed", "failed", "rolled_back", "cancelled"].includes(job.status);
  const isActive = job.status === "pending" || job.status === "in_progress";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/provisioning")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{job.ns_domain}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-gray-400 text-sm">
                {job.sending_domains?.length || 0} sending domains
              </span>
              {sseConnected && isActive && (
                <span className="flex items-center gap-1 text-green-400 text-xs">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Live
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Status badge */}
        {job.status === "completed" && (
          <Badge className="bg-green-900/60 text-green-300 text-sm px-3 py-1">
            <CheckCircle2 className="w-4 h-4 mr-1" /> Completed
          </Badge>
        )}
        {job.status === "failed" && (
          <Badge className="bg-red-900/60 text-red-300 text-sm px-3 py-1">
            <XCircle className="w-4 h-4 mr-1" /> Failed
          </Badge>
        )}
        {job.status === "cancelled" && (
          <Badge className="bg-gray-700 text-gray-400 text-sm px-3 py-1">Cancelled</Badge>
        )}
        {job.status === "rolled_back" && (
          <Badge className="bg-orange-900/60 text-orange-300 text-sm px-3 py-1">Rolled Back</Badge>
        )}
      </div>

      {/* Overall progress */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-white font-medium">Overall Progress</span>
              {isActive && (
                <span className="text-gray-500 text-xs">
                  {estimateTimeRemaining(job.progress_pct, job.started_at)}
                </span>
              )}
            </div>
            <span className="text-white font-bold text-lg">{job.progress_pct}%</span>
          </div>
          <Progress value={job.progress_pct} className="h-3 bg-gray-800" />
          {job.current_step && isActive && (
            <p className="text-gray-400 text-xs mt-2">
              Current: {STEP_NAMES[job.current_step] || job.current_step}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step Timeline */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-5">
          <h3 className="text-white font-medium mb-4">Deployment Steps</h3>
          <StepTimeline
            steps={steps}
            onStepSelect={setSelectedStep}
            selectedStep={selectedStep}
          />
        </CardContent>
      </Card>

      {/* SSH Output Viewer */}
      <div className="relative">
        <SSHLogViewer lines={logLines} className="min-h-[250px]" />
      </div>

      {/* Error message */}
      {job.error_message && (
        <Card className="bg-red-900/10 border-red-900/50">
          <CardContent className="p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-medium">Error</p>
              <p className="text-red-400 text-sm mt-1">{job.error_message}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        {isActive && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-red-300 text-sm rounded-lg transition-colors"
          >
            {cancelling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            Cancel & Rollback
          </button>
        )}

        {job.status === "failed" && (
          <button
            onClick={handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Retry
          </button>
        )}
      </div>

      {/* Completion state */}
      {job.status === "completed" && (
        <Card className="bg-green-900/10 border-green-900/50">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
              <div>
                <h3 className="text-white font-medium text-lg">Deployment Complete!</h3>
                <p className="text-gray-400 text-sm">
                  Your server pair is ready and verified.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                <Server className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                <span className="text-white font-medium block">2 Servers</span>
                <span className="text-gray-500 text-xs">
                  {job.server1_ip && job.server2_ip
                    ? `${job.server1_ip} / ${job.server2_ip}`
                    : "IPs assigned"}
                </span>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                <span className="text-2xl block mb-1">🌐</span>
                <span className="text-white font-medium block">{job.sending_domains?.length || 0} Domains</span>
                <span className="text-gray-500 text-xs">Configured</span>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                <span className="text-2xl block mb-1">📧</span>
                <span className="text-white font-medium block">
                  {(job.sending_domains?.length || 0) * job.mail_accounts_per_domain} Accounts
                </span>
                <span className="text-gray-500 text-xs">Created</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {job.server_pair_id && (
                <button
                  onClick={() => router.push("/dashboard/servers")}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Server Pair
                </button>
              )}
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/provisioning/${job.id}/csv`);
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({ error: 'Download failed' }));
                      alert(err.error || 'Failed to download CSV');
                      return;
                    }
                    const csv = await res.text();
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `snovio-import-${job.ns_domain}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    console.error('CSV download failed:', err);
                    alert('Failed to download CSV. Please try again.');
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Snov.io CSV
              </button>
            </div>

            {/* Port 25 reminder */}
            {job.config && typeof job.config === "object" && (
              <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-900/10 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                Remember to unblock port 25 on your VPS provider if required.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
