import type { NextRequest } from "next/server";

const store = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitTokenResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface TakeRateLimitTokenInput {
  scope: string;
  identifier: string;
  max: number;
  windowMs: number;
}

/**
 * Best-effort in-memory limiter for Next.js route handlers.
 * Suitable for local/dev and single-process deployments.
 */
export function takeRateLimitToken(input: TakeRateLimitTokenInput): RateLimitTokenResult {
  const now = Date.now();
  const key = `${input.scope}:${input.identifier}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + input.windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: input.max,
      remaining: Math.max(0, input.max - 1),
      resetAt,
      retryAfterSeconds: Math.ceil(input.windowMs / 1000),
    };
  }

  if (existing.count >= input.max) {
    const retryAfterMs = Math.max(0, existing.resetAt - now);
    return {
      ok: false,
      limit: input.max,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  existing.count += 1;
  store.set(key, existing);
  return {
    ok: true,
    limit: input.max,
    remaining: Math.max(0, input.max - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.ceil(Math.max(0, existing.resetAt - now) / 1000),
  };
}

export function rateLimitHeaders(result: RateLimitTokenResult): HeadersInit {
  return {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.floor(result.resetAt / 1000)),
    "retry-after": String(Math.max(1, result.retryAfterSeconds)),
  };
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
