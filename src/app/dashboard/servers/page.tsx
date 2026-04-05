"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Server } from "lucide-react";

const serverPairs = [
  {
    pair: 1,
    domain: "grocerysynergy.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Blocked",
    note: "Port 25 blocked",
  },
  {
    pair: 2,
    domain: "krogernetworks.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Blocked",
    note: "Port 25 blocked",
  },
  {
    pair: 3,
    domain: "krogertogether.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Blocked",
    note: "Port 25 blocked",
  },
  {
    pair: 4,
    domain: "albertsonsfresh.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Blocked",
    note: "Port 25 blocked",
  },
  {
    pair: 5,
    domain: "safewaydistribution.info",
    status: "Swap in Progress",
    errors: 2,
    accounts: 15,
    warmupDay: "Day 5/14",
    warmupProgress: 36,
    note: "Awaiting second IP",
  },
  {
    pair: 6,
    domain: "publixgrocery.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Day 7/14",
    warmupProgress: 50,
    note: "Warming on schedule",
  },
  {
    pair: 7,
    domain: "weis-markets.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Day 8/14",
    warmupProgress: 57,
    note: "Warming on schedule",
  },
  {
    pair: 8,
    domain: "shopsrite-team.info",
    status: "Complete",
    errors: 0,
    accounts: 30,
    warmupDay: "Day 3/14",
    warmupProgress: 21,
    note: "Warming on schedule",
  },
  {
    pair: 9,
    domain: "food-lion-mail.info",
    status: "Planning",
    errors: 0,
    accounts: 0,
    warmupDay: "Not Started",
    warmupProgress: 0,
    note: "Awaiting IPs from Clouding",
  },
  {
    pair: 10,
    domain: "harris-teeter-mail.info",
    status: "Planning",
    errors: 0,
    accounts: 0,
    warmupDay: "Not Started",
    warmupProgress: 0,
    note: "Awaiting IPs from Clouding",
  },
];

export default function ServersPage() {
  return (
    <div className='space-y-8'>
      <div>
        <h1 className='text-3xl font-bold text-white'>Server Pairs</h1>
        <p className='text-gray-400 mt-2'>Manage HestiaCP server pairs and SMTP relay status</p>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white'>All Pairs (10/10)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead>
                <tr className='border-b border-gray-800'>
                  <th className='text-left py-3 px-4 text-gray-400'>Pair</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Domain</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Status</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Accounts</th>
                  <th className='text-left py-3 px-4 text-gray-400'>Warmup</th>
                </tr>
              </thead>
              <tbody>
                {serverPairs.map((pair) => (
                  <tr key={pair.pair} className='border-b border-gray-800 hover:bg-gray-800/50'>
                    <td className='py-3 px-4 text-white font-medium'>P{pair.pair}</td>
                    <td className='py-3 px-4 text-white'>{pair.domain}</td>
                    <td className='py-3 px-4'>
                      <Badge>{pair.status}</Badge>
                    </td>
                    <td className='py-3 px-4 text-white'>{pair.accounts}</td>
                    <td className='py-3 px-4 text-white'>{pair.warmupDay}</td>
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
