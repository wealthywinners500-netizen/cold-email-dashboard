// ============================================
// /dashboard/admin/dbl-monitor
//
// Admin-only post-launch DBL monitor. Shows:
//   * Last sweep summary (timestamp, domains scanned, new burns)
//   * Run Now button (manual trigger)
//   * Last 10 sweep runs (audit trail)
//   * Per-pair burn count (red badge if >0)
//   * Per-domain status table (filterable by pair)
// ============================================

export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, Activity, Clock } from 'lucide-react';
import RunNowButton from './run-now-button';

interface SweepRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  pairs_scanned: number;
  domains_scanned: number;
  new_burns_found: number;
  burns_detail: unknown;
  error_message: string | null;
  trigger_source: 'cron' | 'manual' | 'test';
}

interface PairRow {
  id: string;
  pair_number: number;
  ns_domain: string;
  total_accounts: number | null;
  warmup_day: number | null;
  status: string;
  provisioning_job_id: string | null;
}

interface DomainRow {
  id: string;
  pair_id: string;
  domain: string;
  blacklist_status: string;
  last_dbl_check_at: string | null;
  dbl_first_burn_at: string | null;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function DblMonitorPage() {
  const { orgRole, orgId: clerkOrgId } = await auth();
  if (orgRole !== 'org:admin') {
    redirect('/dashboard');
  }
  if (!clerkOrgId) {
    redirect('/dashboard');
  }

  const supabase = await createAdminClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .single();

  if (!org) {
    redirect('/dashboard');
  }
  const orgId = org.id as string;

  const { data: runsData } = await supabase
    .from('dbl_sweep_runs')
    .select(
      'id, started_at, completed_at, status, pairs_scanned, domains_scanned, new_burns_found, burns_detail, error_message, trigger_source'
    )
    .eq('org_id', orgId)
    .order('started_at', { ascending: false })
    .limit(10);
  const runs: SweepRun[] = (runsData as SweepRun[] | null) || [];

  const { data: pairsData } = await supabase
    .from('server_pairs')
    .select(
      'id, pair_number, ns_domain, total_accounts, warmup_day, status, provisioning_job_id'
    )
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('pair_number', { ascending: true });
  const pairs: PairRow[] = (pairsData as PairRow[] | null) || [];

  const pairIds = pairs.map((p) => p.id);
  const { data: domainsData } = pairIds.length
    ? await supabase
        .from('sending_domains')
        .select(
          'id, pair_id, domain, blacklist_status, last_dbl_check_at, dbl_first_burn_at'
        )
        .in('pair_id', pairIds)
    : { data: [] };
  const domains: DomainRow[] = (domainsData as DomainRow[] | null) || [];

  const lastRun = runs[0] || null;
  const totalDomains = domains.length;
  const burntDomains = domains.filter((d) => d.blacklist_status === 'burnt').length;
  const burntByPair = new Map<string, number>();
  for (const d of domains) {
    if (d.blacklist_status === 'burnt') {
      burntByPair.set(d.pair_id, (burntByPair.get(d.pair_id) || 0) + 1);
    }
  }
  const pairById = new Map(pairs.map((p) => [p.id, p]));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Shield className="w-7 h-7 text-blue-400" />
            Post-launch DBL Monitor
          </h1>
          <p className="text-gray-400 mt-2 max-w-2xl">
            Re-screens every saga-generated active pair&apos;s sending domains
            against Spamhaus DQS once a week (Mondays 09:00 ET). Newly-listed
            domains surface as critical alerts and are flipped to{' '}
            <code className="text-red-400">blacklist_status=&apos;burnt&apos;</code>{' '}
            automatically; remediation (drop / delist) is manual.
          </p>
        </div>
        <RunNowButton />
      </div>

      {/* Top-line summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Last sweep
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold text-white">
              {lastRun ? fmtTime(lastRun.started_at) : 'Never'}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {lastRun
                ? `${lastRun.trigger_source} · ${lastRun.status}`
                : 'No sweeps recorded yet'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Pairs / domains tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold text-white">
              {pairs.length} pairs · {totalDomains} domains
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {pairs.filter((p) => p.provisioning_job_id !== null).length}{' '}
              saga-generated · {pairs.filter((p) => p.provisioning_job_id === null).length}{' '}
              imported
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Last sweep result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold text-white">
              {lastRun
                ? `${lastRun.domains_scanned} scanned · ${lastRun.new_burns_found} new burn${
                    lastRun.new_burns_found === 1 ? '' : 's'
                  }`
                : '—'}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {lastRun?.completed_at
                ? `Completed ${fmtTime(lastRun.completed_at)}`
                : lastRun?.status === 'running'
                ? 'In progress'
                : '—'}
            </p>
          </CardContent>
        </Card>

        <Card
          className={`bg-gray-900 ${
            burntDomains > 0 ? 'border-red-700/50' : 'border-gray-800'
          }`}
        >
          <CardHeader className="pb-2">
            <CardTitle
              className={`text-sm font-medium flex items-center gap-2 ${
                burntDomains > 0 ? 'text-red-400' : 'text-gray-400'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              Currently burnt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                burntDomains > 0 ? 'text-red-400' : 'text-white'
              }`}
            >
              {burntDomains}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              of {totalDomains} sending domains
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sweep history */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Sweep history (last 10)</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-gray-400 text-sm">
              No sweeps recorded yet. The cron fires every Monday at 13:00 UTC
              (~09:00 ET). Click <strong>Run Sweep Now</strong> to trigger one
              manually.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 border-b border-gray-800">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Started</th>
                    <th className="text-left py-2 px-2 font-medium">Source</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-right py-2 px-2 font-medium">Pairs</th>
                    <th className="text-right py-2 px-2 font-medium">Domains</th>
                    <th className="text-right py-2 px-2 font-medium">New burns</th>
                    <th className="text-left py-2 px-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-gray-800 ${
                        r.new_burns_found > 0 ? 'bg-red-900/10' : ''
                      }`}
                    >
                      <td className="py-2 px-2 font-mono text-xs">
                        {fmtTime(r.started_at)}
                      </td>
                      <td className="py-2 px-2 text-xs">{r.trigger_source}</td>
                      <td className="py-2 px-2">
                        {r.status === 'completed' ? (
                          <Badge className="bg-green-700 text-xs">completed</Badge>
                        ) : r.status === 'running' ? (
                          <Badge className="bg-blue-700 text-xs">running</Badge>
                        ) : (
                          <Badge className="bg-red-700 text-xs">failed</Badge>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {r.pairs_scanned}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {r.domains_scanned}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-mono ${
                          r.new_burns_found > 0 ? 'text-red-400 font-semibold' : ''
                        }`}
                      >
                        {r.new_burns_found}
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        {fmtTime(r.completed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-pair table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">Active pairs</CardTitle>
        </CardHeader>
        <CardContent>
          {pairs.length === 0 ? (
            <p className="text-gray-400 text-sm">No active pairs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 border-b border-gray-800">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">#</th>
                    <th className="text-left py-2 px-2 font-medium">NS domain</th>
                    <th className="text-left py-2 px-2 font-medium">Source</th>
                    <th className="text-right py-2 px-2 font-medium">Warmup day</th>
                    <th className="text-right py-2 px-2 font-medium">Accounts</th>
                    <th className="text-right py-2 px-2 font-medium">Burnt domains</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {pairs.map((p) => {
                    const burnt = burntByPair.get(p.id) || 0;
                    return (
                      <tr
                        key={p.id}
                        className={`border-b border-gray-800 ${
                          burnt > 0 ? 'bg-red-900/10' : ''
                        }`}
                      >
                        <td className="py-2 px-2 font-mono">{p.pair_number}</td>
                        <td className="py-2 px-2 font-mono text-xs">{p.ns_domain}</td>
                        <td className="py-2 px-2 text-xs text-gray-400">
                          {p.provisioning_job_id ? 'saga' : 'imported'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {p.warmup_day ?? '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">
                          {p.total_accounts ?? '—'}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {burnt > 0 ? (
                            <Badge className="bg-red-700">{burnt}</Badge>
                          ) : (
                            <span className="text-gray-500 font-mono">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-domain table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">All sending domains</CardTitle>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <p className="text-gray-400 text-sm">No sending domains.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 border-b border-gray-800">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Pair</th>
                    <th className="text-left py-2 px-2 font-medium">Domain</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Last DBL check</th>
                    <th className="text-left py-2 px-2 font-medium">First burn</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {domains
                    .slice()
                    .sort((a, b) => {
                      // Burnt first, then alphabetical
                      const aBurnt = a.blacklist_status === 'burnt' ? 0 : 1;
                      const bBurnt = b.blacklist_status === 'burnt' ? 0 : 1;
                      if (aBurnt !== bBurnt) return aBurnt - bBurnt;
                      return a.domain.localeCompare(b.domain);
                    })
                    .map((d) => {
                      const pair = pairById.get(d.pair_id);
                      const isBurnt = d.blacklist_status === 'burnt';
                      return (
                        <tr
                          key={d.id}
                          className={`border-b border-gray-800 ${
                            isBurnt ? 'bg-red-900/20' : ''
                          }`}
                        >
                          <td className="py-2 px-2 font-mono text-xs">
                            {pair ? `#${pair.pair_number}` : '—'}
                          </td>
                          <td
                            className={`py-2 px-2 font-mono text-xs ${
                              isBurnt ? 'text-red-400 font-semibold' : ''
                            }`}
                          >
                            {d.domain}
                          </td>
                          <td className="py-2 px-2">
                            {isBurnt ? (
                              <Badge className="bg-red-700">burnt</Badge>
                            ) : d.blacklist_status === 'clean' ? (
                              <Badge className="bg-green-700">clean</Badge>
                            ) : (
                              <Badge className="bg-gray-700">
                                {d.blacklist_status}
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">
                            {fmtTime(d.last_dbl_check_at)}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">
                            {fmtTime(d.dbl_first_burn_at)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
