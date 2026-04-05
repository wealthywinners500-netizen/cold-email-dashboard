"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Download } from "lucide-react";

const leadSources = [
  { region: "Long Island", source: "Outscraper Google Maps", leads: 3918, verified: 3247, bounceRate: 8, lastUpdated: "2 days ago" },
  { region: "Atlanta", source: "Outscraper Google Maps", leads: 5200, verified: 4576, bounceRate: 12, lastUpdated: "3 days ago" },
  { region: "Houston", source: "Outscraper Google Maps", leads: 8932, verified: 7839, bounceRate: 10, lastUpdated: "1 day ago" },
  { region: "Dallas", source: "Outscraper Google Maps", leads: 4250, verified: 3825, bounceRate: 9, lastUpdated: "4 days ago" },
  { region: "Miami", source: "Outscraper Google Maps", leads: 6100, verified: 5490, bounceRate: 11, lastUpdated: "1 day ago" },
];

export default function LeadsPage() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-3xl font-bold text-white'>Lead Pipeline</h1>
          <p className='text-gray-400 mt-2'>Manage and track lead sources</p>
        </div>
        <button className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold'>
          <Plus className='w-5 h-5 inline mr-2' />Import Leads
        </button>
      </div>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Total Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>28,400</div>
            <p className='text-sm text-gray-400 mt-2'>Across 5 regions</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Verified Emails</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>23,977</div>
            <p className='text-sm text-gray-400 mt-2'>84.5% verification rate</p>
          </CardContent>
        </Card>
        <Card className='bg-gray-900 border-gray-800'>
          <CardHeader className='pb-2'>
            <CardTitle className='text-sm font-medium text-gray-400'>Avg Bounce Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-3xl font-bold text-white'>10%</div>
            <p className='text-sm text-gray-400 mt-2'>Industry standard</p>
          </CardContent>
        </Card>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>Lead Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-6'>
            {leadSources.map((source) => (
              <div key={source.region} className='border-b border-gray-800 pb-6 last:border-b-0 last:pb-0'>
                <div className='flex items-center justify-between mb-4'>
                  <div>
                    <h3 className='text-white font-medium'>{source.region}</h3>
                    <p className='text-sm text-gray-400'>{source.source}</p>
                  </div>
                  <Badge>{source.leads} leads</Badge>
                </div>
                <div className='grid grid-cols-3 gap-4 text-sm'>
                  <div>
                    <p className='text-gray-400'>Verified</p>
                    <p className='text-white font-medium'>{source.verified}</p>
                  </div>
                  <div>
                    <p className='text-gray-400'>Bounce Rate</p>
                    <p className='text-white font-medium'>{source.bounceRate}%</p>
                  </div>
                  <div>
                    <p className='text-gray-400'>Updated</p>
                    <p className='text-white font-medium'>{source.lastUpdated}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
