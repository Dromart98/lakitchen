export type AiRateLimitName = "generate-diet" | "analyze-meal" | "estimate-meal" | (string & {});

export type RateLimitConfig = {
  name: AiRateLimitName;
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

const buckets = new Map<string, RateLimitBucket>();
const ONE_HOUR_MS = 60 * 60 * 1000;

export const aiRateLimits = {
  generateDiet: { name: "generate-diet", limit: 10, windowMs: ONE_HOUR_MS },
  analyzeMeal: { name: "analyze-meal", limit: 15, windowMs: ONE_HOUR_MS },
  estimateMeal: { name: "estimate-meal", limit: 20, windowMs: ONE_HOUR_MS },
} satisfies Record<string, RateLimitConfig>;

/**
 * In-memory fixed-window rate limiter for expensive AI API calls.
 *
 * This is an initial protection layer and intentionally keeps the storage
 * interface small so it can be replaced later by Supabase, Upstash, Redis, or
 * another shared store without changing endpoint handlers.
 *
 * Limitation: Vercel serverless instances do not share memory. A warm instance
 * will enforce these counters, but parallel/cold instances may have separate
 * buckets. This is useful as a first guardrail, not a perfect global quota.
 */
export function checkRateLimit(config: RateLimitConfig, userId: string, now = Date.now()): RateLimitResult {
  cleanupExpiredBuckets(now);

  const key = getBucketKey(config.name, userId);
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + config.windowMs };

  if (bucket.count >= config.limit) {
    buckets.set(key, bucket);
    return toResult(false, config.limit, 0, bucket.resetAt, now);
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return toResult(true, config.limit, Math.max(0, config.limit - bucket.count), bucket.resetAt, now);
}

export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return json(
    {
      error: "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.",
      code: "rate_limited",
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
    },
    429,
    { "Retry-After": String(result.retryAfterSeconds) },
  );
}

function toResult(
  allowed: boolean,
  limit: number,
  remaining: number,
  resetAtMs: number,
  now: number,
): RateLimitResult {
  return {
    allowed,
    limit,
    remaining,
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
  };
}

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function getBucketKey(name: string, userId: string) {
  return `${name}:${userId}`;
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
