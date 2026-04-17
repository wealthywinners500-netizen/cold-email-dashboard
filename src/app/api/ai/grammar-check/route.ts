import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

async function getInternalOrgId(): Promise<string | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  const supabase = await createAdminClient();
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .single();
  return data?.id || null;
}

interface LTMatch {
  offset: number;
  length: number;
  message: string;
  replacements?: Array<{ value: string }>;
}

interface ResponseIssue {
  offset: number;
  length: number;
  message: string;
  suggestions: string[];
}

const DEFAULT_LT_URL = 'https://api.languagetool.org/v2/check';

export async function POST(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`lt:${orgId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { text?: unknown; lang?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const lang = typeof body.lang === 'string' && body.lang.length > 0 ? body.lang : 'en-US';
  if (!text) {
    return NextResponse.json({ issues: [] as ResponseIssue[] });
  }

  const url = process.env.LANGUAGETOOL_API_URL ?? DEFAULT_LT_URL;
  const form = new URLSearchParams();
  form.set('text', text);
  form.set('language', lang);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.status === 429) {
      // Upstream rate-limited us — surface to UI as a soft banner, 200 OK.
      return NextResponse.json({ issues: [] as ResponseIssue[], rateLimited: true });
    }
    if (!resp.ok) {
      return NextResponse.json(
        { error: 'languagetool_error', status: resp.status },
        { status: 502 }
      );
    }

    const data = (await resp.json()) as { matches?: LTMatch[] };
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const issues: ResponseIssue[] = matches.map((m) => ({
      offset: m.offset,
      length: m.length,
      message: m.message,
      suggestions: Array.isArray(m.replacements)
        ? m.replacements.slice(0, 5).map((r) => r.value).filter((v): v is string => typeof v === 'string')
        : [],
    }));

    return NextResponse.json({ issues });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'languagetool_error', message },
      { status: 502 }
    );
  }
}
