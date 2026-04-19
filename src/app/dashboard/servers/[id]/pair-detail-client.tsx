"use client";

// ============================================
// Client component: pair detail + Verify workflow.
//
// - Admin-only "Verify" button → confirmation dialog → POST /api/pairs/[id]/verify
// - Live polls the in-flight run (5s, capped at 5min) via
//   GET /api/pairs/[id]/verifications/[vid].
// - Shows an expandable per-check list, with SEM warnings visually
//   distinct from operational fails.
// - Shows a history table (last 10) — clicking a row replaces the active
//   view without a navigation.
// ============================================

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import {
  POLL_INTERVAL_MS,
  POLL_MAX_MS,
  type PairSummary,
  type VerificationCheck,
  type VerificationRow,
  type VerificationStatus,
} from "./types";

interface PairDetailClientProps {
  pair: PairSummary;
  initialVerifications: VerificationRow[];
  isAdmin: boolean;
}

// --------------------------------------------
// Small visual helpers
// --------------------------------------------

function StatusBadge({ status }: { status: VerificationStatus }) {
  if (status === "running") {
    return (
      <Badge className="bg-gray-700 text-gray-100 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Running
      </Badge>
    );
  }
  if (status === "green") {
    return <Badge className="bg-green-900 text-green-200">Green</Badge>;
  }
  if (status === "yellow") {
    return <Badge className="bg-yellow-900 text-yellow-200">Yellow</Badge>;
  }
  return <Badge className="bg-red-900 text-red-200">Red</Badge>;
}

function CheckResultBadge({ check }: { check: VerificationCheck }) {
  if (check.result === "pass") {
    return (
      <Badge className="bg-green-900 text-green-200 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        pass
      </Badge>
    );
  }
  if (check.result === "warn" && check.is_sem_warning) {
    // SEM-tolerated warning — visually a blue info, not a yellow warning.
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Badge className="bg-blue-900 text-blue-200 flex items-center gap-1 cursor-help">
                <Info className="w-3 h-3" />
                SEM
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent className="bg-gray-800 border-gray-700 text-gray-100 max-w-xs">
            Tolerated SEM list — not a deliverability blocker.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  if (check.result === "warn") {
    return (
      <Badge className="bg-yellow-900 text-yellow-200 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3" />
        warn
      </Badge>
    );
  }
  // operational fail
  return (
    <Badge className="bg-red-900 text-red-200 flex items-center gap-1">
      <XCircle className="w-3 h-3" />
      fail
    </Badge>
  );
}

function formatDetails(details: unknown): string {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function shortRunBy(runBy: string | null): string {
  if (!runBy) return "system";
  if (runBy.length <= 6) return runBy;
  return runBy.slice(-6);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// --------------------------------------------
// Main component
// --------------------------------------------

export default function PairDetailClient({
  pair,
  initialVerifications,
  isAdmin,
}: PairDetailClientProps) {
  const [verifications, setVerifications] =
    useState<VerificationRow[]>(initialVerifications);

  // The verification currently rendered in the "current-run" panel.
  // Defaults to the latest row if any; otherwise null.
  const [activeId, setActiveId] = useState<string | null>(
    initialVerifications[0]?.id ?? null
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pollWarning, setPollWarning] = useState<string | null>(null);

  // Track active poll so we can cancel on unmount.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAtRef = useRef<number>(0);
  const pollVidRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollVidRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const upsertVerification = useCallback((row: VerificationRow) => {
    setVerifications((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      if (idx === -1) {
        // prepend, keep last 10
        return [row, ...prev].slice(0, 10);
      }
      const copy = prev.slice();
      copy[idx] = row;
      return copy;
    });
  }, []);

  const pollOnce = useCallback(
    async (vid: string): Promise<VerificationRow | null> => {
      try {
        const res = await fetch(
          `/api/pairs/${pair.id}/verifications/${vid}`,
          { cache: "no-store" }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as VerificationRow;
        upsertVerification(data);
        return data;
      } catch {
        return null;
      }
    },
    [pair.id, upsertVerification]
  );

  const startPolling = useCallback(
    (vid: string) => {
      stopPolling();
      setPollWarning(null);
      pollVidRef.current = vid;
      pollStartedAtRef.current = Date.now();

      const tick = async () => {
        if (pollVidRef.current !== vid) return;
        const row = await pollOnce(vid);
        const elapsed = Date.now() - pollStartedAtRef.current;
        if (row && row.status !== "running") {
          stopPolling();
          return;
        }
        if (elapsed >= POLL_MAX_MS) {
          stopPolling();
          setPollWarning(
            "Verification is taking longer than expected. The worker may still finish — refresh the page later to see results."
          );
        }
      };

      // run one immediately, then on an interval
      void tick();
      pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
    },
    [pollOnce, stopPolling]
  );

  const triggerVerify = useCallback(async () => {
    if (!isAdmin) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pairs/${pair.id}/verify`, {
        method: "POST",
      });
      if (res.status === 403) {
        toast.error("Admin access required");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body?.error || "Failed to start verification");
      }
      const body = (await res.json()) as { verificationId: string };
      const placeholder: VerificationRow = {
        id: body.verificationId,
        pair_id: pair.id,
        status: "running",
        checks: [],
        duration_ms: null,
        run_by: null,
        run_at: new Date().toISOString(),
        completed_at: null,
      };
      upsertVerification(placeholder);
      setActiveId(body.verificationId);
      setConfirmOpen(false);
      startPolling(body.verificationId);
      toast.success("Verification started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start verification"
      );
    } finally {
      setSubmitting(false);
    }
  }, [isAdmin, pair.id, startPolling, upsertVerification]);

  // If we land on a page where the latest verification is already running,
  // begin polling for it automatically.
  useEffect(() => {
    const latest = initialVerifications[0];
    if (latest && latest.status === "running") {
      startPolling(latest.id);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeVerification = useMemo<VerificationRow | null>(() => {
    if (!activeId) return null;
    return verifications.find((r) => r.id === activeId) ?? null;
  }, [activeId, verifications]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/servers"
            className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Server Pairs
          </Link>
          <h1 className="text-3xl font-bold text-white mt-2">
            Pair P{pair.pair_number} — {pair.ns_domain}
          </h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Verify
          </button>
        )}
      </div>

      {/* Summary card */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-base">Pair Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-gray-950 rounded">
              <div className="text-gray-400 mb-1">Server 1</div>
              <div className="text-white font-medium">{pair.s1_hostname}</div>
              <div className="text-gray-400 font-mono">{pair.s1_ip}</div>
            </div>
            <div className="p-3 bg-gray-950 rounded">
              <div className="text-gray-400 mb-1">Server 2</div>
              <div className="text-white font-medium">{pair.s2_hostname}</div>
              <div className="text-gray-400 font-mono">{pair.s2_ip}</div>
            </div>
            <div className="p-3 bg-gray-950 rounded">
              <div className="text-gray-400 mb-1">Status</div>
              <div className="text-white">{pair.status || "—"}</div>
            </div>
            <div className="p-3 bg-gray-950 rounded">
              <div className="text-gray-400 mb-1">Warmup Day</div>
              <div className="text-white">
                {pair.warmup_day > 0 ? `Day ${pair.warmup_day}` : "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current / selected run panel */}
      {activeVerification ? (
        <CurrentRunPanel
          verification={activeVerification}
          pollWarning={pollWarning}
        />
      ) : (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="pt-6 text-gray-400 text-sm text-center">
            No verifications yet.
            {isAdmin
              ? " Click Verify to run the deliverability audit."
              : " Ask an admin to run a verification."}
          </CardContent>
        </Card>
      )}

      {/* History table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white text-base">
            Recent Verifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          {verifications.length === 0 ? (
            <p className="text-gray-400 text-sm">No history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-2 px-3 text-gray-400">
                      Run At
                    </th>
                    <th className="text-left py-2 px-3 text-gray-400">
                      Run By
                    </th>
                    <th className="text-left py-2 px-3 text-gray-400">
                      Status
                    </th>
                    <th className="text-left py-2 px-3 text-gray-400">
                      Duration
                    </th>
                    {isAdmin && <th className="py-2 px-3" />}
                  </tr>
                </thead>
                <tbody>
                  {verifications.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setActiveId(row.id)}
                      className={`border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer ${
                        row.id === activeId ? "bg-gray-800/30" : ""
                      }`}
                    >
                      <td className="py-2 px-3 text-white">
                        {formatWhen(row.run_at)}
                      </td>
                      <td className="py-2 px-3 text-gray-300 font-mono">
                        {shortRunBy(row.run_by)}
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="py-2 px-3 text-gray-300">
                        {formatDuration(row.duration_ms)}
                      </td>
                      {isAdmin && (
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmOpen(true);
                            }}
                            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded"
                          >
                            Re-verify
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-gray-800 rounded-lg shadow-lg z-50 p-6">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-xl font-bold text-white">
                Run Pair Verification?
              </Dialog.Title>
              <Dialog.Close className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-sm text-gray-300 mb-4">
              This will run a full deliverability audit against P
              {pair.pair_number} ({pair.ns_domain}) and includes:
            </Dialog.Description>
            <ul className="list-disc list-inside text-sm text-gray-300 mb-4 space-y-1">
              <li>MXToolbox domain health</li>
              <li>PTR alignment (multi-resolver)</li>
              <li>DNS propagation consistency</li>
              <li>Operational blacklist sweep (SBL/DBL/Barracuda)</li>
            </ul>
            <p className="text-xs text-gray-400 mb-4">
              Typical runtime: 30–90 seconds. SEM-listed results are reported
              as warnings, not failures.
            </p>
            <div className="flex gap-3">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={triggerVerify}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Start Verify
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// --------------------------------------------
// Current-run panel (expandable check list)
// --------------------------------------------

function CurrentRunPanel({
  verification,
  pollWarning,
}: {
  verification: VerificationRow;
  pollWarning: string | null;
}) {
  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">
            Verification {formatWhen(verification.run_at)}
          </CardTitle>
          <StatusBadge status={verification.status} />
        </div>
      </CardHeader>
      <CardContent>
        {pollWarning && (
          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-800 rounded text-yellow-200 text-sm">
            {pollWarning}
          </div>
        )}
        {verification.status === "running" && verification.checks.length === 0 ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for worker…
          </div>
        ) : verification.checks.length === 0 ? (
          <p className="text-gray-400 text-sm">No checks recorded.</p>
        ) : (
          <div className="space-y-2">
            {verification.checks.map((check, idx) => (
              <CheckRow key={`${check.name}-${idx}`} check={check} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CheckRow({ check }: { check: VerificationCheck }) {
  const [expanded, setExpanded] = useState(false);
  const detailsText = formatDetails(check.details);
  const hasDetails = detailsText.trim().length > 0;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-800/40"
      >
        <div className="flex items-center gap-2">
          {hasDetails ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )
          ) : (
            <span className="inline-block w-4 h-4" />
          )}
          <span className="text-white text-sm font-medium">{check.name}</span>
        </div>
        <CheckResultBadge check={check} />
      </button>
      {expanded && hasDetails && (
        <pre className="px-3 pb-3 pt-1 text-xs font-mono text-gray-300 whitespace-pre-wrap break-words">
          {detailsText}
        </pre>
      )}
    </div>
  );
}
