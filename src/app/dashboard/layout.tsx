"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Mail,
  Users,
  MessageSquare,
  Smartphone,
  Settings,
  Shield,
  Menu,
  X as XIcon,
  AtSign,
  Inbox,
  Rocket,
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
    label: "Email Accounts",
    href: "/dashboard/email-accounts",
    icon: AtSign,
  },
  {
    label: "Inbox",
    href: "/dashboard/inbox",
    icon: Inbox,
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
    label: "Provisioning",
    href: "/dashboard/provisioning",
    icon: Rocket,
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    label: "Admin",
    href: "/dashboard/admin",
    icon: Shield,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread inbox count
  useEffect(() => {
    async function fetchUnread() {
      try {
        const res = await fetch("/api/inbox/threads?unread=true&per_page=1");
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.pagination?.total ?? 0);
        }
      } catch {
        // silently fail
      }
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-30 w-64 bg-gray-900 border-r border-gray-800 flex flex-col transform transition-transform duration-200 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 lg:static lg:inset-auto`}>
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
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{item.label}</span>
                {item.label === "Inbox" && unreadCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
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
        <header className="bg-gray-900 border-b border-gray-800 px-4 lg:px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden text-gray-400 hover:text-white mr-4"
          >
            <Menu className="w-6 h-6" />
          </button>
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
        <main className="flex-1 overflow-y-auto bg-gray-950 px-4 lg:px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
