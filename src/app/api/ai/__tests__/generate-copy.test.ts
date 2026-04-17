import { describe, it, expect, vi, beforeEach } from 'vitest';

const anthropicCreateMock = vi.fn();
const authMock = vi.fn();
const createAdminClientMock = vi.fn();
const rateLimitMock = vi.fn();
const logAiUsageMock = vi.fn();
const getAnthropicMock = vi.fn();

function makeSupabaseAdmin(orgRow: { id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: orgRow, error: null }),
        }),
      }),
      insert: async () => ({ data: null, error: null }),
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  anthropicCreateMock.mockReset();
  authMock.mockReset();
  createAdminClientMock.mockReset();
  rateLimitMock.mockReset();
  logAiUsageMock.mockReset();
  getAnthropicMock.mockReset();

  authMock.mockResolvedValue({ orgId: 'clerk-org-1', userId: 'user-1' });
  createAdminClientMock.mockResolvedValue(makeSupabaseAdmin({ id: 'org-1' }));
  rateLimitMock.mockReturnValue(true);
  getAnthropicMock.mockReturnValue({
    messages: { create: anthropicCreateMock },
  });
});

async function loadRoute() {
  vi.doMock('@clerk/nextjs/server', () => ({ auth: authMock }));
  vi.doMock('@/lib/supabase/server', () => ({ createAdminClient: createAdminClientMock }));
  vi.doMock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }));
  vi.doMock('@/lib/ai/anthropic', () => ({
    getAnthropic: getAnthropicMock,
    logAiUsage: logAiUsageMock,
    MODELS: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-6' },
  }));
  const mod = await import('../generate-copy/route');
  return mod.POST;
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: 'Widget',
    audience: 'SMB owners',
    problem_solved: 'inventory chaos',
    cta: '15-min call',
    tone: 'professional',
    length: 'medium',
    step_type: 'initial',
    variants: 2,
    include_spintax: false,
    personalization_variables: ['first_name', 'company_name'],
    ...overrides,
  };
}

function mkRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/generate-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-copy', () => {
  it('401 when not authed', async () => {
    authMock.mockResolvedValue({ orgId: null, userId: null });
    const POST = await loadRoute();
    const resp = await POST(mkRequest(validBody()) as never);
    expect(resp.status).toBe(401);
  });

  it('400 on invalid request shape', async () => {
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ bogus: true }) as never);
    expect(resp.status).toBe(400);
  });

  it('happy path: parses valid JSON variants from Claude', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            variants: [
              { subject: 'Subject 1', body: 'Body 1' },
              { subject: 'Subject 2', body: 'Body 2' },
            ],
          }),
        },
      ],
      usage: { input_tokens: 150, output_tokens: 300 },
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest(validBody()) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.variants).toHaveLength(2);
    expect(body.variants[0]).toEqual({ subject: 'Subject 1', body: 'Body 1' });
    expect(logAiUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'generate-copy', status: 'ok' })
    );
  });

  it('malformed JSON from Claude → 502 ai_parse_error', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest(validBody()) as never);
    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.error).toBe('ai_parse_error');
    expect(logAiUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });

  it('variants clamped to 1..4', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ variants: [{ subject: 's', body: 'b' }] }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest(validBody({ variants: 99 })) as never);
    expect(resp.status).toBe(200);
    // Look at the user message we sent — should say "Variants to produce: 4"
    const call = anthropicCreateMock.mock.calls[0][0];
    const userMsg = call.messages[0].content as string;
    expect(userMsg).toContain('Variants to produce: 4');
  });

  it('response with zero valid variants → 502', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ variants: [] }) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest(validBody()) as never);
    expect(resp.status).toBe(502);
  });
});
