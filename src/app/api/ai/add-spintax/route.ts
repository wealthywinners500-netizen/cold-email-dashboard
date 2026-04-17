import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getAnthropic, logAiUsage, MODELS } from '@/lib/ai/anthropic';

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

const SYSTEM_PROMPT = `You edit cold-email copy to add minimal, natural-sounding spintax for deliverability. Do NOT change the core meaning, tone, or CTA. Replace common filler phrases ("Hi there", "I hope this finds you well", "Let me know", "Thanks") with spintax using the format {{RANDOM | option1 | option2 | option3}}. Provide 2-3 options per block. For intensity='minimal', only 3-5 phrases total. For intensity='moderate', up to 8. Never spintax-ify the recipient's name ({{first_name}}), company name ({{company_name}}), or specific product/service names. Return only the rewritten text — no commentary, no markdown fences, no quotes wrapping the output.`;

export async function POST(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const { userId } = await auth();

  if (!rateLimit(`ai:add-spintax:${orgId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let body: { text?: unknown; intensity?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  const intensity = body.intensity === 'moderate' ? 'moderate' : 'minimal';

  if (!text) {
    return NextResponse.json({ error: 'text_required' }, { status: 400 });
  }
  if (text.length > 8000) {
    return NextResponse.json({ error: 'text_too_long' }, { status: 400 });
  }

  const startedAt = Date.now();
  let anthropic;
  try {
    anthropic = getAnthropic();
  } catch {
    return NextResponse.json(
      { error: 'anthropic_not_configured' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const resp = await anthropic.messages.create({
      model: MODELS.haiku,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `intensity=${intensity}\n---\n${text}`,
        },
      ],
    });

    const outText = resp.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    await logAiUsage({
      orgId,
      userId: userId ?? null,
      endpoint: 'add-spintax',
      model: MODELS.haiku,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });

    return NextResponse.json({ text: outText }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isRateLimit =
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status: number }).status === 429;

    await logAiUsage({
      orgId,
      userId: userId ?? null,
      endpoint: 'add-spintax',
      model: MODELS.haiku,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: isRateLimit ? 'rate_limited' : 'error',
      errorMessage: message,
    });

    if (isRateLimit) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    return NextResponse.json(
      { error: 'ai_error', message },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
