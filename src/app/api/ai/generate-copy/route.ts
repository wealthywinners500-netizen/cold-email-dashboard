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

const SYSTEM_PROMPT = `You are a cold email copywriter specializing in deliverability-safe, conversational outreach. Follow these rules strictly:
- Plain text only — no markdown, no HTML.
- No tracking language, no pixel references, no "unsubscribe" text (handled separately).
- Personalization variables use double curly braces: {{first_name}}, {{company_name}}. Use only variables the user lists as available.
- Spintax only when requested — format {{RANDOM | option1 | option2}} with 2-3 options. Never spintax-ify variables.
- Follow-up steps should feel like a short reply-style nudge, not a fresh pitch.
- Follow-up subject should be empty unless the user requests otherwise.
- Keep lines under ~80 chars.
- Never start more than two sentences total with "I".
- Never invent stats, studies, or numbers.
- Return STRICT JSON matching: {"variants":[{"subject":"...","body":"..."}, ...]}. No prose before or after the JSON.`;

interface GenerateCopyRequest {
  product: string;
  audience: string;
  problem_solved: string;
  cta: string;
  tone: 'casual' | 'professional' | 'friendly' | 'direct';
  length: 'short' | 'medium' | 'long';
  step_type: 'initial' | 'followup';
  variants: number;
  include_spintax: boolean;
  personalization_variables: string[];
}

function validate(body: unknown): GenerateCopyRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const tones = ['casual', 'professional', 'friendly', 'direct'] as const;
  const lengths = ['short', 'medium', 'long'] as const;
  const stepTypes = ['initial', 'followup'] as const;
  if (
    typeof b.product !== 'string' ||
    typeof b.audience !== 'string' ||
    typeof b.problem_solved !== 'string' ||
    typeof b.cta !== 'string' ||
    typeof b.tone !== 'string' ||
    !tones.includes(b.tone as (typeof tones)[number]) ||
    typeof b.length !== 'string' ||
    !lengths.includes(b.length as (typeof lengths)[number]) ||
    typeof b.step_type !== 'string' ||
    !stepTypes.includes(b.step_type as (typeof stepTypes)[number]) ||
    typeof b.variants !== 'number' ||
    typeof b.include_spintax !== 'boolean' ||
    !Array.isArray(b.personalization_variables)
  ) {
    return null;
  }
  const variantsClamped = Math.max(1, Math.min(4, Math.floor(b.variants)));
  return {
    product: b.product,
    audience: b.audience,
    problem_solved: b.problem_solved,
    cta: b.cta,
    tone: b.tone as GenerateCopyRequest['tone'],
    length: b.length as GenerateCopyRequest['length'],
    step_type: b.step_type as GenerateCopyRequest['step_type'],
    variants: variantsClamped,
    include_spintax: b.include_spintax,
    personalization_variables: (b.personalization_variables as unknown[]).filter(
      (v): v is string => typeof v === 'string'
    ),
  };
}

function buildUserMessage(req: GenerateCopyRequest): string {
  const wordBudget =
    req.length === 'short' ? 50 : req.length === 'medium' ? 100 : 200;
  const vars = req.personalization_variables.length > 0
    ? req.personalization_variables.join(', ')
    : '(none)';
  return [
    `Product/service: ${req.product}`,
    `Target audience: ${req.audience}`,
    `Problem it solves: ${req.problem_solved}`,
    `Call to action: ${req.cta}`,
    `Tone: ${req.tone}`,
    `Length: ~${wordBudget} words`,
    `Step type: ${req.step_type}`,
    `Variants to produce: ${req.variants}`,
    `Include spintax: ${req.include_spintax ? 'yes' : 'no'}`,
    `Available variables: ${vars}`,
    '',
    `Produce exactly ${req.variants} distinct variant(s). Return strict JSON.`,
  ].join('\n');
}

export async function POST(request: NextRequest) {
  const orgId = await getInternalOrgId();
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userId } = await auth();

  if (!rateLimit(`ai:generate-copy:${orgId}`, 5, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const req = validate(rawBody);
  if (!req) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const startedAt = Date.now();
  let anthropic;
  try {
    anthropic = getAnthropic();
  } catch {
    return NextResponse.json({ error: 'anthropic_not_configured' }, { status: 500 });
  }

  try {
    const resp = await anthropic.messages.create({
      model: MODELS.sonnet,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(req) }],
    });

    const rawText = resp.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Try to parse strict JSON from the response.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      await logAiUsage({
        orgId,
        userId: userId ?? null,
        endpoint: 'generate-copy',
        model: MODELS.sonnet,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorMessage: 'ai_parse_error',
      });
      return NextResponse.json(
        { error: 'ai_parse_error', rawText },
        { status: 502 }
      );
    }

    const shape = parsed as { variants?: unknown };
    const variantsOut = Array.isArray(shape.variants)
      ? (shape.variants as unknown[])
          .filter(
            (v): v is { subject: string; body: string } =>
              typeof v === 'object' &&
              v !== null &&
              typeof (v as Record<string, unknown>).subject === 'string' &&
              typeof (v as Record<string, unknown>).body === 'string'
          )
          .map((v) => ({ subject: v.subject, body: v.body }))
      : [];

    if (variantsOut.length === 0) {
      await logAiUsage({
        orgId,
        userId: userId ?? null,
        endpoint: 'generate-copy',
        model: MODELS.sonnet,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorMessage: 'no_variants_in_response',
      });
      return NextResponse.json({ error: 'ai_parse_error' }, { status: 502 });
    }

    await logAiUsage({
      orgId,
      userId: userId ?? null,
      endpoint: 'generate-copy',
      model: MODELS.sonnet,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });

    return NextResponse.json({ variants: variantsOut }, { headers: { 'Cache-Control': 'no-store' } });
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
      endpoint: 'generate-copy',
      model: MODELS.sonnet,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: isRateLimit ? 'rate_limited' : 'error',
      errorMessage: message,
    });

    if (isRateLimit) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    return NextResponse.json({ error: 'ai_error', message }, { status: 502 });
  }
}
