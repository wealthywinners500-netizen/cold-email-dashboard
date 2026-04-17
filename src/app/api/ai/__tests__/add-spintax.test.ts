/**
 * Tests for POST /api/ai/add-spintax.
 *
 * Every external dependency is mocked: Clerk auth, Supabase admin client,
 * Anthropic SDK, rate-limit helper. No network calls.
 */

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
  const mod = await import('../add-spintax/route');
  return mod.POST;
}

function mkRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/add-spintax', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/add-spintax', () => {
  it('401 when not authed', async () => {
    authMock.mockResolvedValue({ orgId: null, userId: null });
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hi', intensity: 'minimal' }) as never);
    expect(resp.status).toBe(401);
  });

  it('429 when rate-limited', async () => {
    rateLimitMock.mockReturnValue(false);
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hi', intensity: 'minimal' }) as never);
    expect(resp.status).toBe(429);
    const body = await resp.json();
    expect(body.error).toBe('rate_limited');
  });

  it('400 when text is missing', async () => {
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ intensity: 'minimal' }) as never);
    expect(resp.status).toBe(400);
  });

  it('400 when text exceeds 8000 chars', async () => {
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'x'.repeat(8001), intensity: 'minimal' }) as never);
    expect(resp.status).toBe(400);
  });

  it('happy path: returns rewritten text, logs usage', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Hi {{RANDOM | there | friend}}!' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'Hi there!', intensity: 'minimal' }) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.text).toBe('Hi {{RANDOM | there | friend}}!');
    expect(logAiUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        endpoint: 'add-spintax',
        inputTokens: 10,
        outputTokens: 20,
        status: 'ok',
      })
    );
  });

  it('anthropic 429 → route returns 429 and logs rate_limited', async () => {
    const err: Error & { status?: number } = new Error('rate limited');
    err.status = 429;
    anthropicCreateMock.mockRejectedValue(err);
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hi', intensity: 'minimal' }) as never);
    expect(resp.status).toBe(429);
    expect(logAiUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rate_limited' })
    );
  });

  it('anthropic not configured → 500', async () => {
    getAnthropicMock.mockImplementation(() => {
      throw new Error('anthropic_not_configured');
    });
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hi', intensity: 'minimal' }) as never);
    expect(resp.status).toBe(500);
  });
});
