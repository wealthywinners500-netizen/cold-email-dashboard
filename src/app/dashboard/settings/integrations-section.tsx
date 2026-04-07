"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Key, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface IntegrationsSectionProps {
  initialKeys: {
    outscraper_api_key?: string;
    reoon_api_key?: string;
  };
}

export default function IntegrationsSection({ initialKeys }: IntegrationsSectionProps) {
  const [outscraperKey, setOutscraperKey] = useState("");
  const [reoonKey, setReoonKey] = useState("");
  const [outscraperSaved, setOutscraperSaved] = useState(initialKeys.outscraper_api_key || "");
  const [reoonSaved, setReoonSaved] = useState(initialKeys.reoon_api_key || "");
  const [savingOutscraper, setSavingOutscraper] = useState(false);
  const [savingReoon, setSavingReoon] = useState(false);
  const [testingOutscraper, setTestingOutscraper] = useState(false);
  const [testingReoon, setTestingReoon] = useState(false);
  const [outscraperStatus, setOutscraperStatus] = useState<"idle" | "success" | "error">("idle");
  const [reoonStatus, setReoonStatus] = useState<"idle" | "success" | "error">("idle");

  const saveKey = async (provider: "outscraper" | "reoon") => {
    const key = provider === "outscraper" ? outscraperKey : reoonKey;
    if (!key.trim()) {
      toast.error("Please enter an API key");
      return;
    }

    const setSaving = provider === "outscraper" ? setSavingOutscraper : setSavingReoon;
    setSaving(true);

    try {
      const body: Record<string, string> = {};
      if (provider === "outscraper") body.outscraper_api_key = key;
      else body.reoon_api_key = key;

      const res = await fetch("/api/settings/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to save");
      toast.success(`${provider === "outscraper" ? "Outscraper" : "Reoon"} API key saved`);

      // Update saved display
      const masked = "••••" + key.slice(-4);
      if (provider === "outscraper") {
        setOutscraperSaved(masked);
        setOutscraperKey("");
      } else {
        setReoonSaved(masked);
        setReoonKey("");
      }
    } catch {
      toast.error("Failed to save API key");
    } finally {
      setSaving(false);
    }
  };

  const testKey = async (provider: "outscraper" | "reoon") => {
    const setTesting = provider === "outscraper" ? setTestingOutscraper : setTestingReoon;
    const setStatus = provider === "outscraper" ? setOutscraperStatus : setReoonStatus;
    setTesting(true);
    setStatus("idle");

    try {
      const res = await fetch(`/api/settings/integrations?test=${provider}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setStatus(data.success ? "success" : "error");
      if (data.success) toast.success("Connection successful");
      else toast.error("Connection failed — check your API key");
    } catch {
      setStatus("error");
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Key className="w-5 h-5" />
          Lead Generation Integrations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Outscraper */}
        <div>
          <h3 className="text-white font-medium mb-1">Outscraper</h3>
          <p className="text-gray-400 text-sm mb-3">Google Maps business search for lead generation</p>
          {outscraperSaved && (
            <p className="text-gray-500 text-sm mb-2 font-mono">{outscraperSaved}</p>
          )}
          {!outscraperSaved && (
            <p className="text-yellow-500 text-sm mb-2">Not configured</p>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              value={outscraperKey}
              onChange={(e) => setOutscraperKey(e.target.value)}
              placeholder="Enter Outscraper API key"
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm placeholder-gray-500"
            />
            <button
              onClick={() => saveKey("outscraper")}
              disabled={savingOutscraper}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded text-sm font-medium"
            >
              {savingOutscraper ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
            <button
              onClick={() => testKey("outscraper")}
              disabled={testingOutscraper || !outscraperSaved}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded text-sm font-medium flex items-center gap-1"
            >
              {testingOutscraper ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : outscraperStatus === "success" ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : outscraperStatus === "error" ? (
                <XCircle className="w-4 h-4 text-red-400" />
              ) : null}
              Test
            </button>
          </div>
        </div>

        <Separator className="bg-gray-800" />

        {/* Reoon */}
        <div>
          <h3 className="text-white font-medium mb-1">Reoon Email Verifier</h3>
          <p className="text-gray-400 text-sm mb-3">Email validation and verification for lead quality</p>
          {reoonSaved && (
            <p className="text-gray-500 text-sm mb-2 font-mono">{reoonSaved}</p>
          )}
          {!reoonSaved && (
            <p className="text-yellow-500 text-sm mb-2">Not configured</p>
          )}
          <div className="flex gap-2">
            <input
              type="password"
              value={reoonKey}
              onChange={(e) => setReoonKey(e.target.value)}
              placeholder="Enter Reoon API key"
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm placeholder-gray-500"
            />
            <button
              onClick={() => saveKey("reoon")}
              disabled={savingReoon}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded text-sm font-medium"
            >
              {savingReoon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
            <button
              onClick={() => testKey("reoon")}
              disabled={testingReoon || !reoonSaved}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded text-sm font-medium flex items-center gap-1"
            >
              {testingReoon ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : reoonStatus === "success" ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : reoonStatus === "error" ? (
                <XCircle className="w-4 h-4 text-red-400" />
              ) : null}
              Test
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
