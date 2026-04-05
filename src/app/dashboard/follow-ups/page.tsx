"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Send } from "lucide-react";

const followUpChains = [
  { id: 1, name: "Medical Spa Sequence", emails: 5, openRate: 34, replyRate: 8, status: "Active", templates: 5 },
  { id: 2, name: "Dental Office Chain", emails: 4, openRate: 28, replyRate: 6, status: "Active", templates: 4 },
  { id: 3, name: "Healthcare Network", emails: 6, openRate: 41, replyRate: 12, status: "Active", templates: 6 },
  { id: 4, name: "Testing - Short Sequence", emails: 3, openRate: 18, replyRate: 3, status: "Paused", templates: 3 },
  { id: 5, name: "Dermatology Clinics", emails: 4, openRate: 32, replyRate: 7, status: "Active", templates: 4 },
];

const recentActivity = [
  { id: 1, event: "1,250 follow-ups sent from sequence #1", timestamp: "2 hours ago" },
  { id: 2, event: "42 replies processed and drafted", timestamp: "4 hours ago" },
  { id: 3, event: "New sequence created: Dermatology Clinics", timestamp: "1 day ago" },
  { id: 4, event: "Sequence #2 achieved 28% open rate", timestamp: "2 days ago" },
  { id: 5, event: "Medical Spa sequence optimized: +6% opens", timestamp: "3 days ago" },
];

export default function FollowUpsPage() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-3xl font-bold text-white'>Follow-Ups</h1>
          <p className='text-gray-400 mt-2'>Manage follow-up sequences and track engagement</p>
        </div>
        <button className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold'>
          <Plus className='w-5 h-5 inline mr-2' />Create Sequence
        </button>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Active Sequences</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>5</div>
            <p className='text-sm text-gray-400 mt-2'>24 templates total</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Avg Open Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>26.6%</div>
            <p className='text-sm text-gray-400 mt-2'>+3.2% vs. last month</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Follow-Ups This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>8,450</div>
            <p className='text-sm text-gray-400 mt-2'>Across 4 sequences</p>
          </CardContent>
        </Card>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>Follow-Up Sequences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b border-gray-800'>
                  <th className='text-left py-3 px-4 text-gray-400'>Sequence</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Status</th>
                  <th className='text-center py-3 px-4 text-gray-400'>Emails</th>
                  <th className='text-center py-3 px-4 text-gray-400'>Open Rate</th>
                  <th className='text-center py-3 px-4 text-gray-400'>Reply Rate</th>
                </tr>
              </thead>
              <tbody>
                {followUpChains.map((chain) => (
                  <tr key={chain.id} className='border-b border-gray-800 hover:bg-gray-800/50'>
                    <td className='py-3 px-4 text-white font-medium'>{chain.name}</td>
                    <td className='py-3 px-4'><Badge>{chain.status}</Badge></td>
                    <td className='py-3 px-4 text-center text-white'>{chain.emails}</td>
                    <td className='py-3 px-4 text-center text-white'>{chain.openRate}%</td>
                    <td className='py-3 px-4 text-center text-white'>{chain.replyRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {recentActivity.map((activity) => (
              <div key={activity.id} className='flex items-start justify-between py-3 border-b border-gray-800 last:border-b-0'>
                <div>
                  <p className='text-white text-sm'>{activity.event}</p>
                  <p className='text-gray-400 text-xs mt-1'>{activity.timestamp}</p>
                </div>
                <Send className='w-4 h-4 text-blue-400 mt-1' />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
