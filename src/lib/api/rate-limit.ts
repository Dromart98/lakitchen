export type AiRateLimitName = "generate-diet" | "analyze-meal" | "estimate-meal" | (string & {});
export type RateLimitScope = "user" | "ip";

export type RateLimitConfig = {
  name: AiRateLimitName;
  userLimit: number;
  ipLimit: number;
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
  scope: RateLimitScope;
};

const buckets = new Map<string, RateLimitBucket>();
const ONE_HOUR_MS = 60 * 60 * 1000;

export const aiRateLimits = {
  generateDiet: { name: "generate-diet", userLimit: 10, ipLimit: 30, windowMs: ONE_HOUR_MS },
  analyzeMeal: { name: "analyze-meal", userLimit: 15, ipLimit: 45, windowMs: ONE_HOUR_MS },
  estimateMeal: { name: "estimate-meal", userLimit: 20, ipLimit: 60, windowMs: ONE_HOUR_MS },
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
export function checkRateLimitForRequest(
  config: RateLimitConfig,
  userId: string,
  request: Request,
  now = Date.now(),
): RateLimitResult {
  cleanupExpiredBuckets(now);

  const ip = getClientIp(request);
  if (ip) {
    const ipLimit = checkBucket(config, "ip", ip, config.ipLimit, now, false);
    if (!ipLimit.allowed) return ipLimit;
  }

  const userLimit = checkBucket(config, "user", userId, config.userLimit, now, false);
  if (!userLimit.allowed) return userLimit;

  if (ip) checkBucket(config, "ip", ip, config.ipLimit, now, true);

  return checkBucket(config, "user", userId, config.userLimit, now, true);
}

export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return json(
    {
      error: "Has alcanzado el límite de usos por ahora. Inténtalo más tarde.",
      code: "rate_limited",
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt,
      scope: result.scope,
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
  scope: RateLimitScope,
): RateLimitResult {
  return {
    allowed,
    limit,
    remaining,
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    scope,
  };
}

function checkBucket(
  config: RateLimitConfig,
  scope: RateLimitScope,
  identifier: string,
  limit: number,
  now: number,
  consume: boolean,
): RateLimitResult {
  const key = getBucketKey(config.name, scope, identifier);
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + config.windowMs };

  if (bucket.count >= limit) {
    buckets.set(key, bucket);
    return toResult(false, limit, 0, bucket.resetAt, now, scope);
  }

  if (consume) {
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return toResult(true, limit, Math.max(0, limit - bucket.count), bucket.resetAt, now, scope);
}

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function getBucketKey(name: string, scope: RateLimitScope, identifier: string) {
  return `${name}:${scope}:${identifier}`;
}

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
