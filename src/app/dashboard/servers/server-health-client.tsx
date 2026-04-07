"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type {
  DomainHealthReport,
  DomainHealthScore,
  ServerHealthScore,
} from "@/lib/provisioning/verification";

interface ServerHealthProps {
  serverPairId: string;
  nsDomain: string;
  server1IP: string;
  server2IP: string;
  provisioningJobId?: string | null;
  lastHealthReport?: DomainHealthReport | null;
}

// Status icon helper
function StatusIcon({ status }: { status: "PASS" | "FAIL" | "WARN" }) {
  if (status === "PASS") return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (status === "WARN") return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
}

// Cell status badge
function CellBadge({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <span className="text-green-400 text-sm" title={label}>✅</span>
  ) : (
    <span className="text-red-400 text-sm" title={label}>❌</span>
  );
}

export default function ServerHealthClient({
  serverPairId,
  nsDomain,
  server1IP,
  server2IP,
  provisioningJobId,
  lastHealthReport,
}: ServerHealthProps) {
  const [report, setReport] = useState<DomainHealthReport | null>(lastHealthReport || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runHealthCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/server-pairs/${serverPairId}/health`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Health check failed");
      }
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run health check");
    } finally {
      setLoading(false);
    }
  }, [serverPairId]);

  // Overall status badge
  const getOverallBadge = (overall: string) => {
    if (overall === "PASS") return "bg-green-900 text-green-200";
    if (overall === "WARN") return "bg-yellow-900 text-yellow-200";
    return "bg-red-900 text-red-200";
  };

  const getOverallIcon = (overall: string) => {
    if (overall === "PASS") return <ShieldCheck className="w-5 h-5 text-green-400" />;
    if (overall === "WARN") return <ShieldAlert className="w-5 h-5 text-yellow-400" />;
    return <ShieldX className="w-5 h-5 text-red-400" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-xl font-bold text-white">Domain Health Check</h2>
            <p className="text-sm text-gray-400">{nsDomain}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <Badge className={getOverallBadge(report.overall)}>
              {report.overall}
            </Badge>
          )}
          <button
            onClick={runHealthCheck}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {loading ? "Checking..." : "Run Health Check"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Last checked timestamp */}
      {report && (
        <p className="text-xs text-gray-500">
          Last checked: {new Date(report.timestamp).toLocaleString()}
        </p>
      )}

      {!report && !loading && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="pt-6 text-center">
            <Shield className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">
              No health check data yet. Click &quot;Run Health Check&quot; to scan all domains.
            </p>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  {getOverallIcon(report.overall)}
                  <div>
                    <div className="text-lg font-bold text-white">
                      {report.summary.domainsChecked}
                    </div>
                    <div className="text-xs text-gray-400">Domains Checked</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <div>
                    <div className="text-lg font-bold text-green-400">
                      {report.summary.domainsPassing}
                    </div>
                    <div className="text-xs text-gray-400">Passing</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-400" />
                  <div>
                    <div className="text-lg font-bold text-red-400">
                      {report.summary.domainsFailing}
                    </div>
                    <div className="text-xs text-gray-400">Failing</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  <div>
                    <div className="text-lg font-bold text-yellow-400">
                      {report.totalIssues}
                    </div>
                    <div className="text-xs text-gray-400">Total Issues</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Server PTR/A/HELO Alignment */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-base">
                Server Alignment (PTR / A / HELO)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {report.servers.map((server: ServerHealthScore) => (
                  <div
                    key={server.ip}
                    className="flex items-center justify-between p-3 bg-gray-950 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon status={server.overall} />
                      <div>
                        <span className="text-white font-medium">{server.hostname}</span>
                        <span className="text-gray-500 ml-2 text-sm">({server.ip})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">PTR:</span>
                        <CellBadge ok={server.alignment.ptr_ok} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">A:</span>
                        <CellBadge ok={server.alignment.a_ok} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">HELO:</span>
                        <CellBadge ok={server.alignment.helo_ok} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400">BL:</span>
                        <CellBadge ok={!server.blacklist.listed} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Blacklist Status */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-base">
                Blacklist Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.servers.map((server: ServerHealthScore) => (
                  <div key={server.ip} className="p-3 bg-gray-950 rounded-lg">
                    <div className="text-sm text-gray-400 mb-2">{server.ip}</div>
                    <div className="flex flex-wrap gap-2">
                      {server.blacklist.blacklists.map((bl) => (
                        <Badge
                          key={bl.name}
                          className={
                            bl.listed
                              ? "bg-red-900 text-red-200"
                              : "bg-green-900/50 text-green-300"
                          }
                        >
                          {bl.listed ? "❌" : "✅"} {bl.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Domain Health Grid */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-base">
                Domain Health Grid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-2 px-3 text-gray-400">Domain</th>
                      <th className="text-center py-2 px-3 text-gray-400">DNS</th>
                      <th className="text-center py-2 px-3 text-gray-400">SPF</th>
                      <th className="text-center py-2 px-3 text-gray-400">DKIM</th>
                      <th className="text-center py-2 px-3 text-gray-400">DMARC</th>
                      <th className="text-center py-2 px-3 text-gray-400">Blacklist</th>
                      <th className="text-center py-2 px-3 text-gray-400">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* NS Domain row */}
                    <DomainRow domain={report.nsDomain} isNs />
                    {/* Sending domain rows */}
                    {report.domains.map((d: DomainHealthScore) => (
                      <DomainRow key={d.domain} domain={d} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Issues List */}
          {report.totalIssues > 0 && (
            <Card className="bg-gray-900 border-gray-800">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  Issues ({report.totalIssues})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {/* Server issues */}
                  {report.servers.map((server: ServerHealthScore) =>
                    server.issues.map((issue: string, i: number) => (
                      <div
                        key={`${server.ip}-${i}`}
                        className="p-2 bg-red-900/10 border border-red-900/30 rounded text-sm text-red-300"
                      >
                        <span className="text-gray-500">[{server.hostname}]</span> {issue}
                      </div>
                    ))
                  )}
                  {/* Domain issues */}
                  {[report.nsDomain, ...report.domains].map((domain: DomainHealthScore) =>
                    domain.issues.map((issue: string, i: number) => (
                      <div
                        key={`${domain.domain}-${i}`}
                        className="p-2 bg-yellow-900/10 border border-yellow-900/30 rounded text-sm text-yellow-300"
                      >
                        <span className="text-gray-500">[{domain.domain}]</span> {issue}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Provisioning link */}
          {provisioningJobId && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <ExternalLink className="w-4 h-4" />
              <a
                href={`/dashboard/provisioning/${provisioningJobId}`}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                View Provisioning History
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Domain row sub-component for the health grid
function DomainRow({
  domain,
  isNs = false,
}: {
  domain: DomainHealthScore;
  isNs?: boolean;
}) {
  const spfOk = domain.checks.spf?.found && domain.checks.spf?.valid;
  const dkimOk = domain.checks.dkim?.found && domain.checks.dkim?.valid;
  const dmarcOk = domain.checks.dmarc?.found;

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/30">
      <td className="py-2 px-3">
        <span className="text-white">{domain.domain}</span>
        {isNs && (
          <Badge className="ml-2 bg-blue-900/50 text-blue-300 text-xs">NS</Badge>
        )}
      </td>
      <td className="text-center py-2 px-3">
        <CellBadge ok={domain.dns_ok} />
      </td>
      <td className="text-center py-2 px-3">
        <CellBadge
          ok={!!spfOk}
          label={domain.checks.spf?.record || "No SPF"}
        />
      </td>
      <td className="text-center py-2 px-3">
        <CellBadge
          ok={!!dkimOk}
          label={domain.checks.dkim?.record || "No DKIM"}
        />
      </td>
      <td className="text-center py-2 px-3">
        <CellBadge
          ok={!!dmarcOk}
          label={domain.checks.dmarc?.record || "No DMARC"}
        />
      </td>
      <td className="text-center py-2 px-3">
        <CellBadge ok={domain.blacklist_ok} />
      </td>
      <td className="text-center py-2 px-3">
        <StatusIcon status={domain.overall} />
      </td>
    </tr>
  );
}
