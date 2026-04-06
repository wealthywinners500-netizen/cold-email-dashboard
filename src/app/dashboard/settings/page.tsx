export const dynamic = 'force-dynamic';

import { auth } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, Key, Bell, Zap, CreditCard } from "lucide-react";
import { OrganizationProfile } from "@clerk/nextjs";
import { getPlanLimits } from "@/lib/plan-limits";
import { BillingButton } from "./billing-button";

async function getOrganization() {
  const { orgId } = await auth();

  if (!orgId) {
    return null;
  }

  const supabase = await createAdminClient();

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, plan_tier, clerk_org_id")
    .eq("clerk_org_id", orgId)
    .single();

  if (error) {
    console.error("Failed to fetch organization:", error);
    return null;
  }

  return data;
}

function getPlanBadgeColor(planTier: string): string {
  switch (planTier?.toLowerCase()) {
    case "enterprise":
      return "bg-purple-900 text-purple-200";
    case "pro":
      return "bg-blue-900 text-blue-200";
    case "starter":
    default:
      return "bg-gray-800 text-gray-200";
  }
}

export default async function SettingsPage() {
  const org = await getOrganization();
  const { orgId } = await auth();

  if (!org || !orgId) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-gray-400 mt-2">Unable to load organization settings</p>
        </div>
      </div>
    );
  }

  const planLimits = getPlanLimits(org.plan_tier);
  const planLabel = org.plan_tier.charAt(0).toUpperCase() + org.plan_tier.slice(1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 mt-2">Manage your account and integration settings</p>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-white font-medium mb-2">Organization Name</h3>
            <p className="text-gray-400">{org.name}</p>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Organization ID</h3>
            <p className="text-gray-400 font-mono text-sm">{org.clerk_org_id}</p>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Danger Zone</h3>
            <p className="text-gray-400 text-sm mb-4">Irreversible actions</p>
            <button className="px-4 py-2 border border-red-600 text-red-400 rounded-lg hover:bg-red-600/10 font-semibold">
              Delete Organization
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Billing & Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-white font-medium mb-2">Current Plan</h3>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-gray-400 text-sm">{planLabel} Plan</p>
              <Badge className={getPlanBadgeColor(org.plan_tier)}>{planLabel}</Badge>
            </div>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-4">Plan Limits</h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-gray-400 text-sm">Max Server Pairs</p>
                  <p className="text-white text-sm font-mono">
                    {planLimits.maxServerPairs === Infinity ? "Unlimited" : planLimits.maxServerPairs}
                  </p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-gray-400 text-sm">Max Users</p>
                  <p className="text-white text-sm font-mono">
                    {planLimits.maxUsers === Infinity ? "Unlimited" : planLimits.maxUsers}
                  </p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-gray-400 text-sm">API Access</p>
                  <p className="text-white text-sm font-mono">
                    {planLimits.apiAccess ? "Enabled" : "Disabled"}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <BillingButton />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Key className="w-5 h-5" />
            API Keys & Integrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-white font-medium mb-2">Supabase</h3>
            <p className="text-gray-400 text-sm mb-4">Database and authentication service</p>
            <Badge className="bg-green-900 text-green-200">Connected</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Clerk</h3>
            <p className="text-gray-400 text-sm mb-4">Authentication and user management</p>
            <Badge className="bg-green-900 text-green-200">Connected</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Snov.io</h3>
            <p className="text-gray-400 text-sm mb-4">Email account management and campaigns</p>
            <Badge className="bg-green-900 text-green-200">Connected</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Go High Level (GHL)</h3>
            <p className="text-gray-400 text-sm mb-4">SMS and text messaging campaigns</p>
            <Badge className="bg-green-900 text-green-200">Connected</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div>
            <h3 className="text-white font-medium mb-2">Reoon Email Verifier</h3>
            <p className="text-gray-400 text-sm mb-4">Email validation and verification</p>
            <Badge className="bg-green-900 text-green-200">Connected</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Email Alerts</p>
              <p className="text-gray-400 text-sm">Receive emails for critical events</p>
            </div>
            <Badge className="bg-blue-900 text-blue-200">Enabled</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Blacklist Notifications</p>
              <p className="text-gray-400 text-sm">Alert when domain is blacklisted</p>
            </div>
            <Badge className="bg-blue-900 text-blue-200">Enabled</Badge>
          </div>
          <Separator className="bg-gray-800" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Campaign Performance Digest</p>
              <p className="text-gray-400 text-sm">Weekly summary of campaign metrics</p>
            </div>
            <Badge className="bg-blue-900 text-blue-200">Enabled</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Team Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <OrganizationProfile />
        </CardContent>
      </Card>
    </div>
  );
}
