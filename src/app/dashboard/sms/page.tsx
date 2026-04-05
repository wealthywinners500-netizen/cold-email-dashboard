"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, MessageCircle } from "lucide-react";

const smsWorkflows = [
  { id: 1, name: "GHL NY Outreach", region: "NY/LI", status: "Active", sent: 2450, delivered: 2380, replied: 187, credits: 245 },
  { id: 2, name: "GHL GA Network", region: "GA", status: "Active", sent: 3100, delivered: 3009, replied: 278, credits: 310 },
  { id: 3, name: "Stop & Shop Campaign", region: "NY", status: "Active", sent: 1200, delivered: 1164, replied: 94, credits: 120 },
  { id: 4, name: "NY Tops Follow-Up", region: "NY", status: "Active", sent: 950, delivered: 923, replied: 62, credits: 95 },
];

const upcomingMessages = [
  { workflow: "GHL NY Outreach", message: "Next batch scheduled", scheduledFor: "Today at 2:00 PM", count: 150 },
  { workflow: "NY Tops Follow-Up", message: "Follow-up batch", scheduledFor: "Tomorrow at 9:00 AM", count: 85 },
  { workflow: "Stop & Shop Campaign", message: "Re-engagement", scheduledFor: "In 2 days", count: 200 },
];

export default function SMSPage() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-3xl font-bold text-white'>SMS & Text Marketing</h1>
          <p className='text-gray-400 mt-2'>Go High Level text campaigns and workflows</p>
        </div>
        <button className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold'>
          <Plus className='w-5 h-5 inline mr-2' />Create Workflow
        </button>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-4 gap-6'>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Total SMS Sent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>7,700</div>
            <p className='text-sm text-gray-400 mt-2'>This month</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Delivery Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>94.6%</div>
            <p className='text-sm text-gray-400 mt-2'>7,476 delivered</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Reply Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>8.2%</div>
            <p className='text-sm text-gray-400 mt-2'>621 replies</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Credits Available</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>4,850</div>
            <p className='text-sm text-gray-400 mt-2'>Telnyx balance</p>
          </CardContent>
        </Card>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>Active Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-6'>
            {smsWorkflows.map((workflow) => (
              <div key={workflow.id} className='border-b border-gray-800 pb-6 last:border-b-0 last:pb-0'>
                <div className='flex items-center justify-between mb-3'>
                  <div>
                    <h3 className='text-white font-medium'>{workflow.name}</h3>
                    <p className='text-sm text-gray-400'>{workflow.region}</p>
                  </div>
                  <Badge>{workflow.status}</Badge>
                </div>
                <div className='grid grid-cols-4 gap-4 text-sm'>
                  <div>
                    <p className='text-gray-400'>Sent</p>
                    <p className='text-white font-medium'>{workflow.sent}</p>
                  </div>
                  <div>
                    <p className='text-gray-400'>Delivered</p>
                    <p className='text-white font-medium'>{workflow.delivered}</p>
                  </div>
                  <div>
                    <p className='text-gray-400'>Replied</p>
                    <p className='text-white font-medium'>{workflow.replied}</p>
                  </div>
                  <div>
                    <p className='text-gray-400'>Credits Used</p>
                    <p className='text-white font-medium'>{workflow.credits}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <MessageCircle className='w-5 h-5' />Scheduled Messages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {upcomingMessages.map((msg, idx) => (
              <div key={idx} className='flex items-start justify-between py-3 border-b border-gray-800 last:border-b-0'>
                <div>
                  <p className='text-white text-sm font-medium'>{msg.workflow}</p>
                  <p className='text-gray-400 text-xs mt-1'>{msg.message} ({msg.count} messages)</p>
                  <p className='text-gray-500 text-xs mt-1'>{msg.scheduledFor}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
