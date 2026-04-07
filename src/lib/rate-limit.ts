/**
 * Simple in-memory rate limiter using a Map with TTL.
 * For Vercel serverless, this provides per-instance rate limiting.
 * For stricter enforcement, use Redis or Vercel KV in production.
 */
const rateMap = new Map<string, { count: number; resetAt: number }>();

// Periodically clean expired entries to prevent memory leaks
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) {
      rateMap.delete(key);
    }
  }
}

/**
 * Check if a request should be allowed under rate limit.
 * @returns true if allowed, false if rate limited
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 60_000
): boolean {
  cleanupExpired();

  const now = Date.now();
  const entry = rateMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}
