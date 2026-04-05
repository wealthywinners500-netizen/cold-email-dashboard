"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus } from "lucide-react";

const campaigns = [
  {
    id: 1,
    name: "Long Island Medical Spas - Batch A",
    leads: 1250,
    sent: 1200,
    delivered: 1128,
    opens: 315,
    clicks: 42,
    replies: 8,
    status: "Active",
    region: "NY/LI",
  },
  {
    id: 2,
    name: "Long Island Medical Spas - Batch B",
    leads: 1100,
    sent: 950,
    delivered: 893,
    opens: 218,
    clicks: 31,
    replies: 5,
    status: "Active",
    region: "NY/LI",
  },
  {
    id: 3,
    name: "Atlanta Dental Offices",
    leads: 3200,
    sent: 2800,
    delivered: 2548,
    opens: 812,
    clicks: 118,
    replies: 22,
    status: "Active",
    region: "GA",
  },
  {
    id: 4,
    name: "Houston Dentists",
    leads: 2850,
    sent: 0,
    delivered: 0,
    opens: 0,
    clicks: 0,
    replies: 0,
    status: "Paused",
    region: "TX",
  },
  {
    id: 5,
    name: "Dallas Dental - Testing",
    leads: 450,
    sent: 450,
    delivered: 405,
    opens: 84,
    clicks: 12,
    replies: 2,
    status: "Complete",
    region: "TX",
  },
  {
    id: 6,
    name: "Pittsburgh Medical Test",
    leads: 0,
    sent: 0,
    delivered: 0,
    opens: 0,
    clicks: 0,
    replies: 0,
    status: "Planning",
    region: "PA",
  },
  {
    id: 7,
    name: "Miami Dermatology",
    leads: 1800,
    sent: 1600,
    delivered: 1440,
    opens: 432,
    clicks: 54,
    replies: 10,
    status: "Active",
    region: "FL",
  },
  {
    id: 8,
    name: "Boston Healthcare",
    leads: 2100,
    sent: 1900,
    delivered: 1710,
    opens: 513,
    clicks: 68,
    replies: 14,
    status: "Active",
    region: "MA",
  },
];

export default function CampaignsPage() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-3xl font-bold text-white'>Campaigns</h1>
          <p className='text-gray-400 mt-2'>Manage email campaigns and track performance</p>
        </div>
        <button className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold'>
          <Plus className='w-5 h-5 inline mr-2' />Create Campaign
        </button>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>All Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b border-gray-800'>
                  <th className='text-left py-3 px-4 text-gray-400'>Campaign</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Region</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Status</th>
                  <th className='text-right py-3 px-4 text-gray-400'>Sent</th>
                  <th className='text-right py-3 px-4 text-gray-400'>Opens</th>
                  <th className='text-right py-3 px-4 text-gray-400'>Replies</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className='border-b border-gray-800 hover:bg-gray-800/50'>
                    <td className='py-3 px-4 text-white font-medium'>{campaign.name}</td>
                    <td className='py-3 px-4'><Badge>{campaign.region}</Badge></td>
                    <td className='py-3 px-4'><Badge>{campaign.status}</Badge></td>
                    <td className='py-3 px-4 text-white text-right'>{campaign.sent}</td>
                    <td className='py-3 px-4 text-white text-right'>{campaign.opens}</td>
                    <td className='py-3 px-4 text-white text-right'>{campaign.replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
