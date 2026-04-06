"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Server } from "lucide-react";

interface ServerPair {
  pair_number: number;
  ns_domain: string;
  s1_ip: string;
  s1_hostname: string;
  s2_ip: string;
  s2_hostname: string;
  status: string;
  mxtoolbox_errors: number;
  warmup_day: number;
  total_accounts: number;
}

interface ServersClientProps {
  serverPairs: ServerPair[];
}

export default function ServersClient({ serverPairs }: ServersClientProps) {
  // Helper to get status badge color
  const getStatusBadge = (status: string) => {
    if (status === "complete") {
      return "bg-green-900 text-green-200";
    } else if (status === "needs_attention") {
      return "bg-yellow-900 text-yellow-200";
    } else {
      return "bg-gray-700 text-gray-200";
    }
  };

  // Helper to get status display text
  const getStatusText = (status: string) => {
    if (status === "complete") {
      return "Complete";
    } else if (status === "needs_attention") {
      return "Needs Attention";
    } else {
      return "Planned";
    }
  };

  // Helper to get warmup day display
  const getWarmupDisplay = (warmupDay: number, status: string, pairNumber: number) => {
    if (warmupDay === 0) {
      if (status === "complete" && pairNumber <= 3) {
        return { text: "Blocked", color: "text-red-400", badge: "bg-red-900/30" };
      } else if (status === "planned") {
        return { text: "—", color: "text-gray-400", badge: "" };
      }
      return { text: "—", color: "text-gray-400", badge: "" };
    }
    return { text: `Day ${warmupDay}`, color: "text-blue-400", badge: "bg-blue-900/30" };
  };

  // Helper to get warmup progress percentage
  const getWarmupProgress = (warmupDay: number) => {
    if (warmupDay === 0) return 0;
    return Math.round((warmupDay / 14) * 100);
  };

  // Compute summary stats
  const completePairs = serverPairs.filter((p) => p.status === "complete").length;
  const needsAttentionPairs = serverPairs.filter((p) => p.status === "needs_attention").length;
  const plannedPairs = serverPairs.filter((p) => p.status === "planned").length;
  const totalAccounts = serverPairs.reduce((sum, p) => sum + p.total_accounts, 0);

  // Sort pairs by pair_number
  const sortedPairs = [...serverPairs].sort((a, b) => a.pair_number - b.pair_number);

  return (
    <div className='space-y-8'>
      <div>
        <h1 className='text-3xl font-bold text-white'>Server Pairs</h1>
        <p className='text-gray-400 mt-2'>Manage HestiaCP server pairs and SMTP relay status</p>
      </div>

      {/* Summary Stats */}
      <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
        <Card className='bg-gray-900 border-gray-800'>
          <CardContent className='pt-6'>
            <div className='text-2xl font-bold text-white'>{completePairs}</div>
            <div className='text-sm text-gray-400'>Complete</div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardContent className='pt-6'>
            <div className='text-2xl font-bold text-white'>{needsAttentionPairs}</div>
            <div className='text-sm text-gray-400'>Needs Attention</div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardContent className='pt-6'>
            <div className='text-2xl font-bold text-white'>{plannedPairs}</div>
            <div className='text-sm text-gray-400'>Planned</div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardContent className='pt-6'>
            <div className='text-2xl font-bold text-white'>{totalAccounts}</div>
            <div className='text-sm text-gray-400'>Total Accounts</div>
          </CardContent>
        </Card>
      </div>

      {/* Server Pairs Table */}
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>All Pairs ({sortedPairs.length}/{sortedPairs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b border-gray-800'>
                  <th className='text-left py-3 px-4 text-gray-400'>Pair</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Domain</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Status</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Errors</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Accounts</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Warmup</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Progress</th>
                </tr>
              </thead>
              <tbody>
                {sortedPairs.map((pair) => {
                  const warmup = getWarmupDisplay(pair.warmup_day, pair.status, pair.pair_number);
                  const progress = getWarmupProgress(pair.warmup_day);

                  return (
                    <tr key={pair.pair_number} className='border-b border-gray-800 hover:bg-gray-800/50'>
                      <td className='py-3 px-4 text-white font-medium'>P{pair.pair_number}</td>
                      <td className='py-3 px-4 text-white'>{pair.ns_domain}</td>
                      <td className='py-3 px-4'>
                        <Badge className={getStatusBadge(pair.status)}>{getStatusText(pair.status)}</Badge>
                      </td>
                      <td className='py-3 px-4'>
                        {pair.mxtoolbox_errors > 0 ? (
                          <span className='text-red-400 font-medium flex items-center gap-1'>
                            <AlertCircle className='w-4 h-4' />
                            {pair.mxtoolbox_errors}
                          </span>
                        ) : (
                          <span className='text-green-400'>0</span>
                        )}
                      </td>
                      <td className='py-3 px-4 text-white'>{pair.total_accounts}</td>
                      <td className={`py-3 px-4 font-medium ${warmup.color}`}>{warmup.text}</td>
                      <td className='py-3 px-4 w-20'>
                        {progress > 0 && (
                          <div className='flex items-center gap-2'>
                            <Progress value={progress} className='h-1 flex-1' />
                            <span className='text-xs text-gray-400'>{progress}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Status Notes */}
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <AlertCircle className='w-5 h-5' />
            Status Notes
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {needsAttentionPairs > 0 && (
            <div className='p-3 bg-yellow-900/20 border border-yellow-800 rounded text-yellow-200 text-sm'>
              {needsAttentionPairs} pair(s) need attention. Check MXToolbox errors and resolve any domain validation issues.
            </div>
          )}
          {plannedPairs > 0 && (
            <div className='p-3 bg-blue-900/20 border border-blue-800 rounded text-blue-200 text-sm'>
              {plannedPairs} pair(s) are in planning stage. Awaiting IPs from cloud provider.
            </div>
          )}
          {completePairs > 0 && (
            <div className='p-3 bg-green-900/20 border border-green-800 rounded text-green-200 text-sm'>
              {completePairs} pair(s) fully deployed. Monitor warmup phase and MXToolbox health.
            </div>
          )}
          <div className='p-3 bg-gray-800/50 border border-gray-700 rounded text-gray-300 text-sm'>
            <strong>Port 25 Status:</strong> Verify UDP/TCP port 25 connectivity before launching campaigns. Check ISP/cloud provider restrictions.
          </div>
          <div className='p-3 bg-gray-800/50 border border-gray-700 rounded text-gray-300 text-sm'>
            <strong>Warmup Schedule:</strong> Pairs with warmup_day &gt; 0 are actively warming. Day-by-day volume increases prevent blacklisting.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
