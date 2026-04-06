"use client";

import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Mail,
  Users,
  MessageSquare,
  Smartphone,
  Settings,
} from "lucide-react";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";

const navigationItems = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Servers",
    href: "/dashboard/servers",
    icon: Server,
  },
  {
    label: "Campaigns",
    href: "/dashboard/campaigns",
    icon: Mail,
  },
  {
    label: "Leads",
    href: "/dashboard/leads",
    icon: Users,
  },
  {
    label: "Follow-Ups",
    href: "/dashboard/follow-ups",
    icon: MessageSquare,
  },
  {
    label: "SMS",
    href: "/dashboard/sms",
    icon: Smartphone,
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white">StealthMail</h1>
          <p className="text-xs text-gray-400 mt-1">Cold Email Dashboard</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom spacer */}
        <div className="px-4 py-4 border-t border-gray-800"></div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-gray-900 border-b border-gray-800 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">Organization</div>
            <OrganizationSwitcher
              appearance={{
                elements: {
                  organizationSwitcherTrigger:
                    "bg-gray-800 text-white hover:bg-gray-700 border border-gray-700",
                },
              }}
            />
          </div>
          <UserButton
            appearance={{
              elements: {
                userButtonBox: "bg-gray-800",
              },
            }}
          />
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto bg-gray-950 px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
