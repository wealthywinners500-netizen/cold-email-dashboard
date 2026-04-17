import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const authMock = vi.fn();
const createAdminClientMock = vi.fn();
const rateLimitMock = vi.fn();

function makeSupabaseAdmin(orgRow: { id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: orgRow, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  authMock.mockReset();
  createAdminClientMock.mockReset();
  rateLimitMock.mockReset();
  authMock.mockResolvedValue({ orgId: 'clerk-org-1', userId: 'user-1' });
  createAdminClientMock.mockResolvedValue(makeSupabaseAdmin({ id: 'org-1' }));
  rateLimitMock.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadRoute() {
  vi.doMock('@clerk/nextjs/server', () => ({ auth: authMock }));
  vi.doMock('@/lib/supabase/server', () => ({ createAdminClient: createAdminClientMock }));
  vi.doMock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }));
  const mod = await import('../grammar-check/route');
  return mod.POST;
}

function mkRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/grammar-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/grammar-check', () => {
  it('401 when not authed', async () => {
    authMock.mockResolvedValue({ orgId: null, userId: null });
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hello' }) as never);
    expect(resp.status).toBe(401);
  });

  it('429 when local rate limit trips', async () => {
    rateLimitMock.mockReturnValue(false);
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'hello' }) as never);
    expect(resp.status).toBe(429);
  });

  it('empty text → 200 with empty issues array', async () => {
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: '' }) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.issues).toEqual([]);
  });

  it('happy path: maps LanguageTool matches to our shape', async () => {
    const ltResponse = {
      matches: [
        {
          offset: 5,
          length: 4,
          message: 'Possible spelling mistake',
          replacements: [{ value: 'world' }, { value: 'word' }],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(ltResponse), { status: 200 })
      )
    );
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'Hello worldd' }) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.issues).toEqual([
      {
        offset: 5,
        length: 4,
        message: 'Possible spelling mistake',
        suggestions: ['world', 'word'],
      },
    ]);
  });

  it('LanguageTool 429 → returns 200 with rateLimited: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 }))
    );
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'Hello world' }) as never);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.rateLimited).toBe(true);
    expect(body.issues).toEqual([]);
  });

  it('upstream 500 → 502 from our endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 500 }))
    );
    const POST = await loadRoute();
    const resp = await POST(mkRequest({ text: 'Hello' }) as never);
    expect(resp.status).toBe(502);
  });
});
