"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, AlertCircle } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Generate 30 days of email volume data
const generateEmailVolumeData = () => {
  const data = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    // Ramp sent from ~200 to ~4500
    const sent = Math.floor(200 + (i / 29) * 4300);
    const delivered = Math.floor(sent * (0.94 + Math.random() * 0.02));
    const bounced = Math.floor(sent * (0.01 + Math.random() * 0.02));

    data.push({
      date,
      day,
      sent,
      delivered,
      bounced,
    });
  }
  return data;
};

const emailVolumeData = generateEmailVolumeData();

const leadsbyRegionData = [
  { region: "Long Island", leads: 10537 },
  { region: "Dallas", leads: 9011 },
  { region: "Atlanta", leads: 16824 },
  { region: "Houston", leads: 26926 },
  { region: "Pittsburgh", leads: 0 },
];

const recentActivity = [
  {
    id: 1,
    event: "Pair 4 imported 30 accounts",
    timestamp: "2 hours ago",
    status: "success",
  },
  {
    id: 2,
    event: "Pair 7 warming started",
    timestamp: "3 hours ago",
    status: "success",
  },
  {
    id: 3,
    event: "Pair 5 blacklist detected",
    timestamp: "5 hours ago",
    status: "warning",
  },
  {
    id: 4,
    event: "Campaign A/B test launched",
    timestamp: "1 day ago",
    status: "success",
  },
  {
    id: 5,
    event: "3,918 leads verified (LI Med Spas)",
    timestamp: "2 days ago",
    status: "success",
  },
];

export default function DashboardOverview() {
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
              <div className='text-3xl font-bold text-white'>8</div>
              <div className='text-sm text-gray-400'>/ 10</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>7 healthy, 1 needs attention</p>
            <div className='flex gap-2 mt-4'>
              <Badge className='bg-green-900 text-green-200'>7 Complete</Badge>
              <Badge className='bg-yellow-900 text-yellow-200'>1 Alert</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Accounts Warming</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>75</div>
              <div className='text-sm text-gray-400'>/ 300</div>
            </div>
            <div className='mt-4'>
              <Progress value={25} className='h-2' />
            </div>
            <p className='text-xs text-gray-400 mt-3'>25% warming phase</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>8</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>2 regions active</p>
            <div className='flex gap-2 mt-4'>
              <Badge className='bg-blue-900 text-blue-200'>GA Region</Badge>
              <Badge className='bg-purple-900 text-purple-200'>NY/LI</Badge>
            </div>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Lead Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='flex items-baseline gap-2'>
              <div className='text-3xl font-bold text-white'>36,000</div>
              <div className='text-sm text-gray-400'>+</div>
            </div>
            <p className='text-sm text-gray-400 mt-3'>5 cities scraped</p>
            <div className='flex gap-2 mt-4'>
              <Badge className='bg-cyan-900 text-cyan-200'>Verified</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            Email Volume (Last 30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div>Chart would render here</div>
        </CardContent>
      </Card>
    </div>
  );
}
