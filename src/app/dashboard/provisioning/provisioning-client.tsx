"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Rocket, Plus, Server, Globe, Loader2 } from "lucide-react";
import type { ProvisioningJobRow } from "@/lib/provisioning/types";

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-green-900/60 text-green-300">Completed</Badge>;
    case "in_progress":
      return <Badge className="bg-blue-900/60 text-blue-300">In Progress</Badge>;
    case "pending":
      return <Badge className="bg-gray-800 text-gray-400">Pending</Badge>;
    case "failed":
      return <Badge className="bg-red-900/60 text-red-300">Failed</Badge>;
    case "rolled_back":
      return <Badge className="bg-orange-900/60 text-orange-300">Rolled Back</Badge>;
    case "cancelled":
      return <Badge className="bg-gray-700 text-gray-400">Cancelled</Badge>;
    default:
      return <Badge className="bg-gray-800 text-gray-400">{status}</Badge>;
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ProvisioningClientProps {
  hasProviders: boolean;
}

export default function ProvisioningClient({ hasProviders }: ProvisioningClientProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<ProvisioningJobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchJobs() {
      try {
        const res = await fetch("/api/provisioning");
        if (res.ok) {
          const data = await res.json();
          setJobs(data);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchJobs();
    // Refresh every 10s for active jobs
    const interval = setInterval(fetchJobs, 10_000);
    return () => clearInterval(interval);
  }, []);

  const activeJobs = jobs.filter((j) => j.status === "pending" || j.status === "in_progress");
  const completedJobs = jobs.filter((j) => j.status !== "pending" && j.status !== "in_progress");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    );
  }

  // No providers configured
  if (!hasProviders) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="py-12 text-center">
          <Server className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">Configure Your Providers First</h3>
          <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
            Before deploying server pairs, you need to add at least one VPS provider and DNS registrar in Settings.
          </p>
          <button
            onClick={() => router.push("/dashboard/settings")}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
          >
            Go to Settings
          </button>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (jobs.length === 0) {
    return (
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="py-16 text-center">
          <div className="w-20 h-20 bg-blue-600/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Rocket className="w-10 h-10 text-blue-400" />
          </div>
          <h3 className="text-xl font-medium text-white mb-2">Deploy Your First Server Pair</h3>
          <p className="text-gray-400 text-sm max-w-lg mx-auto mb-8">
            Automated server pair deployment creates 2 VPS servers, configures DNS, installs HestiaCP,
            sets up mail domains, and verifies deliverability — all in one click.
          </p>
          <button
            onClick={() => router.push("/dashboard/provisioning/new")}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Deploy New Pair
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Active Provisions */}
      {activeJobs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Active Provisions</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {activeJobs.map((job) => (
              <Card
                key={job.id}
                className="bg-gray-900 border-gray-800 cursor-pointer hover:border-gray-700 transition-colors"
                onClick={() => router.push(`/dashboard/provisioning/${job.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-white font-medium flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-400" />
                        {job.ns_domain}
                      </h3>
                      <p className="text-gray-500 text-xs mt-1">
                        {job.sending_domains?.length || 0} sending domains
                      </p>
                    </div>
                    {getStatusBadge(job.status)}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        {job.current_step ? job.current_step.replace(/_/g, " ") : "Queued"}
                      </span>
                      <span className="text-white font-medium">{job.progress_pct}%</span>
                    </div>
                    <Progress value={job.progress_pct} className="h-2 bg-gray-800" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Deploy New Pair button */}
      <div className="flex justify-end">
        <button
          onClick={() => router.push("/dashboard/provisioning/new")}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Deploy New Pair
        </button>
      </div>

      {/* Completed History */}
      {completedJobs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Completed History</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left text-gray-400 font-medium px-4 py-3">NS Domain</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-3 hidden md:table-cell">Domains</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-3">Status</th>
                  <th className="text-left text-gray-400 font-medium px-4 py-3 hidden lg:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/30 transition-colors"
                    onClick={() => router.push(`/dashboard/provisioning/${job.id}`)}
                  >
                    <td className="px-4 py-3 text-white font-mono text-xs">{job.ns_domain}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                      {job.sending_domains?.length || 0} domains
                    </td>
                    <td className="px-4 py-3">{getStatusBadge(job.status)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                      {formatDate(job.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
