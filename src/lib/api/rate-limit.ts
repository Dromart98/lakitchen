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

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
  scope: "user" | "ip";
};

const buckets = new Map<string, RateLimitBucket>();
const ONE_HOUR_MS = 60 * 60 * 1000;

export const aiRateLimits = {
  generateDiet: { name: "generate-diet", limit: 10, windowMs: ONE_HOUR_MS },
  analyzeMeal: { name: "analyze-meal", limit: 15, windowMs: ONE_HOUR_MS },
  estimateMeal: { name: "estimate-meal", limit: 20, windowMs: ONE_HOUR_MS },
} satisfies Record<string, RateLimitConfig>;

export const aiIpRateLimits = {
  generateDiet: { name: "generate-diet", limit: 30, windowMs: ONE_HOUR_MS },
  analyzeMeal: { name: "analyze-meal", limit: 45, windowMs: ONE_HOUR_MS },
  estimateMeal: { name: "estimate-meal", limit: 60, windowMs: ONE_HOUR_MS },
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
export function checkRateLimit(
  config: RateLimitConfig,
  identifier: string,
  scope: "user" | "ip" = "user",
  now = Date.now(),
): RateLimitResult {
  cleanupExpiredBuckets(now);

  const key = getBucketKey(config.name, scope, identifier);
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + config.windowMs };

  if (bucket.count >= config.limit) {
    buckets.set(key, bucket);
    return toResult(false, config.limit, 0, bucket.resetAt, now, scope);
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return toResult(true, config.limit, Math.max(0, config.limit - bucket.count), bucket.resetAt, now, scope);
}

export function checkAiRateLimit(
  request: Request,
  userConfig: RateLimitConfig,
  ipConfig: RateLimitConfig,
  userId: string,
  now = Date.now(),
): RateLimitResult {
  const userResult = checkRateLimit(userConfig, userId, "user", now);
  if (!userResult.allowed) return userResult;

  const ip = getClientIp(request);
  return checkRateLimit(ipConfig, ip, "ip", now);
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor.slice(0, 80);

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 80);

  return "unknown";
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
  scope: "user" | "ip",
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

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function getBucketKey(name: string, scope: "user" | "ip", identifier: string) {
  return `${name}:${scope}:${identifier}`;
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
