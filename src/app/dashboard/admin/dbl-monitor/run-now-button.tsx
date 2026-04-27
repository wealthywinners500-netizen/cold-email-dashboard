'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function RunNowButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function onClick() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/dbl-monitor/run', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
      } else {
        setMessage(
          `Sweep enqueued (job ${json.jobId?.slice(0, 8)}…). The worker picks ` +
            `it up within ~10s; refresh in a minute to see the result.`
        );
        // Re-fetch the page so the new dbl_sweep_runs row shows up once the
        // worker writes it. Pretty optimistic — the row may still be 'running'.
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded font-medium transition-colors"
      >
        {pending ? 'Enqueuing…' : 'Run Sweep Now'}
      </button>
      {message && <p className="text-green-400 text-xs max-w-xs text-right">{message}</p>}
      {error && <p className="text-red-400 text-xs max-w-xs text-right">{error}</p>}
    </div>
  );
}
