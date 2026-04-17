// Reoon Email Verification Service — v2 (Phase 1, 2026-04-17)
// Lazy init per Hard Lesson #34. Correct endpoints per 2026-04 Reoon docs.

import { mapReoonStatus, type ReoonStatus } from './reoon-status';

const REOON = 'https://emailverifier.reoon.com/api/v1';

export interface ReoonResult {
  email: string;
  status: ReoonStatus | string;
  overall_score?: number;
  is_role_account?: boolean;
  is_catch_all?: boolean;
  username?: string;
  domain?: string;
  raw: unknown;
}

export async function verifyOne(apiKey: string, email: string): Promise<ReoonResult> {
  const url = `${REOON}/verify?email=${encodeURIComponent(email)}&key=${apiKey}&mode=power`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reoon verify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return {
    email,
    status: json.status,
    overall_score: json.overall_score,
    is_role_account: json.is_role_account,
    is_catch_all: json.is_catch_all,
    username: json.username,
    domain: json.domain,
    raw: json,
  };
}

export async function verifyBulkCreate(apiKey: string, emails: string[], name?: string) {
  const body = { name: (name || 'saas-verify').slice(0, 25), emails, key: apiKey };
  const res = await fetch(`${REOON}/create-bulk-verification-task/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Reoon bulk-create ${res.status}: ${await res.text()}`);
  return (await res.json()) as { task_id: number; status: string; count_submitted: number };
}

export async function verifyBulkPoll(apiKey: string, taskId: number) {
  const url = `${REOON}/get-result-bulk-verification-task/?key=${apiKey}&task_id=${taskId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reoon bulk-poll ${res.status}: ${await res.text()}`);
  return (await res.json()) as {
    task_id: number;
    status: 'waiting' | 'running' | 'completed' | string;
    count_total: number;
    count_checked: number;
    progress_percentage: number;
    results?: Record<string, ReoonResult & { status: ReoonStatus }>;
  };
}

export async function verifyBatchFallback(apiKey: string, emails: string[]): Promise<ReoonResult[]> {
  // Concurrency-capped parallel single calls. Use for ≤50-email batches;
  // larger batches are chunked by the caller until Phase 6 wires pg-boss
  // async polling on top of verifyBulkCreate/verifyBulkPoll.
  const results: ReoonResult[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < emails.length; i += CONCURRENCY) {
    const chunk = emails.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((e) => verifyOne(apiKey, e)));
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ email: chunk[j], status: 'unknown', raw: { error: String(r.reason) } });
    }
  }
  return results;
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const url = `${REOON}/check-account-balance/?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

export { mapReoonStatus };
