"use client";

import { useState, type ReactNode } from "react";
import SystemHealthClient from "./system-health-client";

interface AdminTabsProps {
  overviewContent: ReactNode;
}

export default function AdminTabs({ overviewContent }: AdminTabsProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "health">("overview");

  return (
    <div>
      {/* Tab Buttons */}
      <div className="flex gap-1 border-b border-gray-800 mb-6">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "overview"
              ? "text-white border-b-2 border-blue-500"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("health")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "health"
              ? "text-white border-b-2 border-blue-500"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          System Health
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" ? overviewContent : <SystemHealthClient />}
    </div>
  );
}
