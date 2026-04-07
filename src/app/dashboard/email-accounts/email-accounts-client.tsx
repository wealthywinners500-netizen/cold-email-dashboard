"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Plus, TestTube, Power, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { toast } from "sonner";
import CreateEmailAccountModal from "@/components/modals/create-email-account-modal";

interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  status: string;
  daily_send_limit: number;
  sends_today: number;
  warmup_day: number;
  last_error: string | null;
  last_sent_at: string | null;
  created_at: string;
}

interface EmailAccountsClientProps {
  accounts: EmailAccount[];
}

export default function EmailAccountsClient({ accounts }: EmailAccountsClientProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const router = useRouter();
  useRealtimeRefresh("email_accounts");

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const totalSendsToday = accounts.reduce((sum, a) => sum + (a.sends_today || 0), 0);
  const totalDailyLimit = accounts.reduce((sum, a) => sum + (a.daily_send_limit || 0), 0);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/email-accounts/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("SMTP connection successful");
      } else {
        toast.error(`Connection failed: ${data.error}`);
      }
    } catch {
      toast.error("Failed to test connection");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggle = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "disabled" : "active";
    try {
      const res = await fetch(`/api/email-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(`Account ${newStatus === "active" ? "enabled" : "disabled"}`);
        router.refresh();
      } else {
        toast.error("Failed to update account");
      }
    } catch {
      toast.error("Failed to update account");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/email-accounts/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Account disabled");
        router.refresh();
      } else {
        toast.error("Failed to disable account");
      }
    } catch {
      toast.error("Failed to disable account");
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Email Accounts</h1>
          <p className="text-gray-400 mt-2">Connect SMTP accounts to send campaign emails</p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Mail className="w-16 h-16 text-gray-600 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No email accounts connected</h3>
          <p className="text-gray-400 mb-6 max-w-md">Add your first email account to start sending campaigns.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
          >
            Add Email Account
          </button>
        </div>
        <CreateEmailAccountModal open={modalOpen} onOpenChange={setModalOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Email Accounts</h1>
          <p className="text-gray-400 mt-2">Connect SMTP accounts to send campaign emails</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Active Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Sends Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {totalSendsToday} <span className="text-lg text-gray-400">/ {totalDailyLimit}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Total Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{accounts.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-gray-900 border-gray-800">
        <CardHeader>
          <CardTitle className="text-white">All Email Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400">Email</th>
                  <th className="text-left py-3 px-4 text-gray-400">Display Name</th>
                  <th className="text-left py-3 px-4 text-gray-400">SMTP Host</th>
                  <th className="text-left py-3 px-4 text-gray-400">Status</th>
                  <th className="text-right py-3 px-4 text-gray-400">Sends Today</th>
                  <th className="text-left py-3 px-4 text-gray-400">Last Sent</th>
                  <th className="text-right py-3 px-4 text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-3 px-4 text-white font-medium">{account.email}</td>
                    <td className="py-3 px-4 text-gray-400">{account.display_name || "—"}</td>
                    <td className="py-3 px-4 text-gray-400">{account.smtp_host}:{account.smtp_port}</td>
                    <td className="py-3 px-4">
                      <Badge variant={account.status === "active" ? "default" : "secondary"}>
                        {account.status}
                      </Badge>
                      {account.last_error && (
                        <span className="ml-2 text-xs text-red-400" title={account.last_error}>
                          Error
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-white text-right">
                      {account.sends_today} / {account.daily_send_limit}
                    </td>
                    <td className="py-3 px-4 text-gray-400">
                      {account.last_sent_at
                        ? new Date(account.last_sent_at).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTest(account.id)}
                          disabled={testingId === account.id}
                          className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                          title="Test Connection"
                        >
                          <TestTube className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggle(account.id, account.status)}
                          className={`p-1.5 transition-colors ${
                            account.status === "active"
                              ? "text-green-400 hover:text-yellow-400"
                              : "text-gray-400 hover:text-green-400"
                          }`}
                          title={account.status === "active" ? "Disable" : "Enable"}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(account.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                          title="Disable Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateEmailAccountModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
