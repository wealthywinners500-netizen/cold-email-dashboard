"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, AlertCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DashboardData {
  serverPairs: Array<{
    pair_number: number;
    status: string;
    warmup_day: number;
    total_accounts: number;
    mxtoolbox_errors: number;
  }>;
  campaigns: Array<{
    name: string;
    status: string;
    recipients: number;
  }>;
  leads: Array<{
    state: string;
    total_scraped: number;
    verified_count: number;
  }>;
  followUps: Array<any>;
  smsWorkflows: Array<any>;
}

export default function OverviewClient({ data }: { data: DashboardData }) {
  // Compute server pair stats
  const completePairs = data.serverPairs.filter((p) => p.status === "complete").length;
  const needsAttentionPairs = data.serverPairs.filter((p) => p.status === "needs_attention").length;
  const totalPairs = data.serverPairs.length;

  // Compute warming accounts (where warmup_day > 0)
  const warmingAccounts = data.serverPairs.reduce((sum, p) => {
    return sum + (p.warmup_day > 0 ? p.total_accounts : 0);
  }, 0);

  // Compute total accounts across all pairs
  const totalAccountsCapacity = data.serverPairs.reduce((sum, p) => sum + p.total_accounts, 0);

  // Active campaigns (status = "active")
  const activeCampaigns = data.campaigns.filter((c) => c.status === "active").length;

  // Total verified leads
  const totalVerifiedLeads = data.leads.reduce((sum, l) => sum + l.verified_count, 0);

  // Leads by region (state)
  const leadsByRegion = data.leads
    .filter((l) => l.total_scraped > 0)
    .map((l) => ({
      region: l.state,
      leads: l.verified_count,
    }))
    .sort((a, b) => b.leads - a.leads);


  // Compute percentages
  const warmingPercentage = totalAccountsCapacity > 0 ? Math.round((warmingAccounts / totalAccountsCapacity) * 100) : 0;

  // Get regions for active campaigns badge
  const campaignRegions = data.campaigns
    .filter((c) => c.status === "active")
    .map((c) => c.name)
    .slice(0, 2);

  return (
    <div className='space-y-8'>
      <div>
        <h1 className='text-3xl font-bold text-white'>Dashboard Overview</h1>
        <p className='text-gray-400 mt-2'>Real-time status of your cold email infrastructure</p>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Server Pairs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>{completePairs}</div>
              <div className='text-sm text-gray-400'>/ {totalPairs}</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>
              {completePairs} healthy{needsAttentionPairs > 0 ? `, ${needsAttentionPairs} needs attention` : ""}
            </p>
            <div className='flex gap-2 mt-4'>
              {completePairs > 0 && <Badge className='bg-green-900 text-green-200'>{completePairs} Complete</Badge>}
              {needsAttentionPairs > 0 && <Badge className='bg-yellow-900 text-yellow-200'>{needsAttentionPairs} Alert</Badge>}
            </div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Accounts Warming</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>{warmingAccounts}</div>
              <div className='text-sm text-gray-400'>/ {totalAccountsCapacity}</div>
            </div>
            <div className='mt-4'>
              <Progress value={warmingPercentage} className='h-2' />
            </div>
            <p className='text-xs text-gray-400 mt-3'>{warmingPercentage}% warming phase</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>{activeCampaigns}</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>{campaignRegions.length} region{campaignRegions.length !== 1 ? "s" : ""} active</p>
            <div className='flex gap-2 mt-4 flex-wrap'>
              {campaignRegions.map((region, idx) => (
                <Badge key={idx} className={idx === 0 ? "bg-blue-900 text-blue-200" : "bg-purple-900 text-purple-200"}>
                  {region}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Lead Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>{totalVerifiedLeads.toLocaleString()}</div>
              <div className='text-sm text-gray-400'>+</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>{data.leads.length} cities scraped</p>
            <div className='flex gap-2 mt-4'>
              <Badge className='bg-cyan-900 text-cyan-200'>Verified</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email Volume Chart */}
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <TrendingUp className='w-5 h-5' />
            Email Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='flex items-center justify-center py-12'>
            <p className='text-gray-400'>Email volume tracking will be available once campaign sending begins. Estimated daily volume based on account warm-up schedule.</p>
          </div>
        </CardContent>
      </Card>

      {/* Leads by Region Chart */}
      {leadsByRegion.length > 0 && (
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader>
            <CardTitle className='text-white'>Leads by Region</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width='100%' height={300}>
              <BarChart data={leadsByRegion}>
                <CartesianGrid strokeDasharray='3 3' stroke='#374151' />
                <XAxis dataKey='region' stroke='#9ca3af' />
                <YAxis stroke='#9ca3af' />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: "0.5rem",
                  }}
                  labelStyle={{ color: "#f3f4f6" }}
                />
                <Bar dataKey='leads' fill='#3b82f6' name='Verified Leads' />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-gray-400'>Recent activity will appear here as you use the dashboard</p>
        </CardContent>
      </Card>
    </div>
  );
}
