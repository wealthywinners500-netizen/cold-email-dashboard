"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, Key, Bell, Zap } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className='space-y-8'>
      <div>
        <h1 className='text-3xl font-bold text-white'>Settings</h1>
        <p className='text-gray-400 mt-2'>Manage your account and integration settings</p>
      </div>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <Key className='w-5 h-5' />API Keys & Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div>
            <h3 className='text-white font-medium mb-2'>Supabase</h3>
            <p className='text-gray-400 text-sm mb-4'>Database and authentication service</p>
            <Badge className='bg-green-900 text-green-200'>Connected</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Clerk</h3>
            <p className='text-gray-400 text-sm mb-4'>Authentication and user management</p>
            <Badge className='bg-green-900 text-green-200'>Connected</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Snov.io</h3>
            <p className='text-gray-400 text-sm mb-4'>Email account management and campaigns</p>
            <Badge className='bg-green-900 text-green-200'>Connected</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Go High Level (GHL)</h3>
            <p className='text-gray-400 text-sm mb-4'>SMS and text messaging campaigns</p>
            <Badge className='bg-green-900 text-green-200'>Connected</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Reoon Email Verifier</h3>
            <p className='text-gray-400 text-sm mb-4'>Email validation and verification</p>
            <Badge className='bg-green-900 text-green-200'>Connected</Badge>
          </div>
        </CardContent>
      </Card>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <Zap className='w-5 h-5' />Billing & Usage
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div>
            <h3 className='text-white font-medium mb-2'>Current Plan</h3>
            <p className='text-gray-400 text-sm'>Pro Plan - $2,999/month</p>
            <p className='text-gray-500 text-xs mt-1'>Unlimited servers, 300+ accounts, advanced analytics</p>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Usage This Month</h3>
            <div className='space-y-3'>
              <div>
                <div className='flex items-center justify-between mb-1'>
                  <p className='text-gray-400 text-sm'>Email Volume</p>
                  <p className='text-white text-sm'>125,000 / Unlimited</p>
                </div>
              </div>
              <div>
                <div className='flex items-center justify-between mb-1'>
                  <p className='text-gray-400 text-sm'>Lead Imports</p>
                  <p className='text-white text-sm'>28,400 / 100,000</p>
                </div>
              </div>
              <div>
                <div className='flex items-center justify-between mb-1'>
                  <p className='text-gray-400 text-sm'>API Calls</p>
                  <p className='text-white text-sm'>843,250 / 10,000,000</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <Bell className='w-5 h-5' />Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-white font-medium'>Email Alerts</p>
              <p className='text-gray-400 text-sm'>Receive emails for critical events</p>
            </div>
            <Badge className='bg-blue-900 text-blue-200'>Enabled</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-white font-medium'>Blacklist Notifications</p>
              <p className='text-gray-400 text-sm'>Alert when domain is blacklisted</p>
            </div>
            <Badge className='bg-blue-900 text-blue-200'>Enabled</Badge>
          </div>
          <Separator className='bg-gray-800' />
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-white font-medium'>Campaign Performance Digest</p>
              <p className='text-gray-400 text-sm'>Weekly summary of campaign metrics</p>
            </div>
            <Badge className='bg-blue-900 text-blue-200'>Enabled</Badge>
          </div>
        </CardContent>
      </Card>
      <Card className='bg-gray-900 border-gray-800'>
        <CardHeader>
          <CardTitle className='text-white flex items-center gap-2'>
            <SettingsIcon className='w-5 h-5' />Organization
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div>
            <h3 className='text-white font-medium mb-2'>Organization Name</h3>
            <p className='text-gray-400'>StealthMail Operations</p>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Organization ID</h3>
            <p className='text-gray-400 font-mono text-sm'>org_1a2b3c4d5e6f7g8h</p>
          </div>
          <Separator className='bg-gray-800' />
          <div>
            <h3 className='text-white font-medium mb-2'>Danger Zone</h3>
            <p className='text-gray-400 text-sm mb-4'>Irreversible actions</p>
            <button className='px-4 py-2 border border-red-600 text-red-400 rounded-lg hover:bg-red-600/10 font-semibold'>
              Delete Organization
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
