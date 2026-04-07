export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOrganization, getTableCounts, getServerPairs, getCampaigns } from "@/lib/supabase/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Database, Activity, Server } from "lucide-react";
import AdminTabs from "./admin-tabs";

export default async function AdminPage() {
  // RBAC: Only org admins can access this page
  const { orgRole } = await auth();
  if (orgRole !== 'org:admin') {
    redirect('/dashboard');
  }

  const [organization, tableCounts, serverPairs, campaigns] = await Promise.all([
    getOrganization(),
    getTableCounts(),
    getServerPairs(),
    getCampaigns(),
  ]);

  // Calculate total accounts across all server pairs
  const totalAccounts = serverPairs.reduce((sum: number, pair: { total_accounts?: number }) => sum + (pair.total_accounts || 0), 0);

  // Count active campaigns
  const activeCampaigns = campaigns.filter((c: { status: string }) => c.status === "active").length;

  const overviewContent = (
    <div className="space-y-8">
      {/* Organization Details */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            Organization Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-gray-400 text-sm uppercase">Name</p>
              <p className="text-white font-semibold mt-1">{organization.name}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm uppercase">Plan Tier</p>
              <p className="text-white font-semibold mt-1">{organization.plan_tier}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm uppercase">Organization ID</p>
              <p className="text-white font-mono text-xs mt-1">{organization.id}</p>
            </div>
            <div>
              <p className="text-gray-400 text-sm uppercase">Clerk Org ID</p>
              <p className="text-white font-mono text-xs mt-1">
                {organization.clerk_org_id}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm uppercase">Created</p>
              <p className="text-white font-semibold mt-1">
                {new Date(organization.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table Row Counts */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-green-400" />
            Table Row Counts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">Server Pairs</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.server_pairs}
              </p>
            </div>
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">Campaigns</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.campaigns}
              </p>
            </div>
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">Leads</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.leads}
              </p>
            </div>
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">Follow-Ups</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.follow_ups}
              </p>
            </div>
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">SMS Workflows</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.sms_workflows}
              </p>
            </div>
            <div className="border border-gray-800 rounded-lg p-4">
              <p className="text-gray-400 text-sm uppercase">Sending Domains</p>
              <p className="text-3xl font-bold text-white mt-2">
                {tableCounts.sending_domains}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Health */}
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border-l-4 border-green-500 pl-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <p className="text-white font-medium">Supabase Connection</p>
              </div>
              <p className="text-gray-400 text-sm mt-2">Data loaded successfully</p>
            </div>
            <div className="border-l-4 border-green-500 pl-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <p className="text-white font-medium">Clerk Status</p>
              </div>
              <p className="text-gray-400 text-sm mt-2">
                App ID: {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.substring(0, 16)}...
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
              <Server className="w-4 h-4" />
              Total Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{totalAccounts}</div>
            <p className="text-sm text-gray-400 mt-2">
              Across {tableCounts.server_pairs} server pairs
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{activeCampaigns}</div>
            <p className="text-sm text-gray-400 mt-2">
              Of {tableCounts.campaigns} total campaigns
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Re-seed Instructions */}
      <Card className="bg-gray-900 border-gray-800 border-yellow-700/30">
        <CardHeader>
          <CardTitle className="text-yellow-400 flex items-center gap-2">
            <Database className="w-5 h-5" />
            Re-seed Database
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-300 text-sm">
            To re-seed the database with fresh test data, run the seed script:
          </p>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 font-mono text-xs text-gray-300">
            <p className="mb-2">npm run seed</p>
            <p className="text-gray-500">or</p>
            <p className="mt-2">pnpm exec tsx scripts/seed.ts</p>
          </div>
          <p className="text-gray-400 text-xs">
            This will reset all tables and populate with seed data. Current counts
            shown above will be updated.
          </p>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-gray-400 mt-2">System overview and configuration</p>
        </div>
        <Badge className="bg-blue-600">Admin</Badge>
      </div>

      <AdminTabs overviewContent={overviewContent} />
    </div>
  );
}
