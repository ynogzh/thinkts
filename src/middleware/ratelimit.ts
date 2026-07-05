import { RateLimitError } from "../error";
import type { ThinkContext, Middleware } from "../types";
import type { BunRedisConfig, BunRedisAdapter } from "../model/adapters/redis";
import { createRedisAdapter } from "../model/adapters/redis";
import { LruCache } from "../lru";

export interface RateLimitConfig {
  type?: "memory" | "redis";
  windowMs?: number;
  max?: number;
  keyGenerator?: (ctx: ThinkContext) => string;
  skip?: (string | RegExp)[];
  message?: string;
  headers?: boolean;
  redis?: BunRedisConfig;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class MemoryRateLimiter {
  private data = new LruCache<RateLimitEntry>(10000);
  private windowMs: number;
  private max: number;

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  async check(key: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    let entry = this.data.get(key);

    if (!entry || now >= entry.resetTime) {
      entry = { count: 1, resetTime: now + this.windowMs };
      this.data.set(key, entry, this.windowMs);
      return { allowed: true, remaining: this.max - 1, resetTime: entry.resetTime };
    }

    entry.count++;
    if (entry.count > this.max) {
      return { allowed: false, remaining: 0, resetTime: entry.resetTime };
    }
    return { allowed: true, remaining: this.max - entry.count, resetTime: entry.resetTime };
  }
}
class RedisRateLimiter {
  private client: BunRedisAdapter;
  private windowMs: number;
  private max: number;

  constructor(windowMs: number, max: number, redisConfig: BunRedisConfig) {
    this.windowMs = windowMs;
    this.max = max;
    this.client = createRedisAdapter(redisConfig);
  }

  async check(key: string): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const fullKey = `ratelimit:${key}`;
    const count = await this.client.incr(fullKey);
    if (count === 1) {
      await this.client.expire(fullKey, Math.ceil(this.windowMs / 1000));
    }
    const ttl = await this.client.ttl(fullKey);
    const resetTime = Date.now() + (ttl > 0 ? ttl : Math.ceil(this.windowMs / 1000)) * 1000;

    if (count > this.max) {
      return { allowed: false, remaining: 0, resetTime };
    }
    return { allowed: true, remaining: Math.max(this.max - count, 0), resetTime };
  }
}

function shouldSkip(pathname: string, skipList: (string | RegExp)[]): boolean {
  for (const pattern of skipList) {
    if (typeof pattern === "string") {
      if (pathname === pattern || pathname.startsWith(pattern + "/")) return true;
    } else if (pattern instanceof RegExp) {
      if (pattern.test(pathname)) return true;
    }
  }
  return false;
}

export function createRateLimitMiddleware(config?: RateLimitConfig): Middleware {
  const windowMs = config?.windowMs ?? 60000;
  const max = config?.max ?? 100;
  const skipList = config?.skip ?? [];
  const message = config?.message ?? "Too many requests, please try again later.";
  const includeHeaders = config?.headers ?? true;
  const keyGenerator = config?.keyGenerator ?? ((ctx: ThinkContext) => {
    const info = ctx.server.requestIP(ctx.request);
    return info?.address ?? "unknown";
  });

  const limiter = config?.type === "redis"
    ? new RedisRateLimiter(windowMs, max, config.redis ?? {})
    : new MemoryRateLimiter(windowMs, max);
  return {
    async onRequest(ctx: ThinkContext): Promise<Response | void> {
      if (shouldSkip(ctx.url.pathname, skipList)) return;

      const key = keyGenerator(ctx);
      const result = await limiter.check(key);

      if (includeHeaders) {
        ctx.set.headers["X-RateLimit-Limit"] = String(max);
        ctx.set.headers["X-RateLimit-Remaining"] = String(Math.max(result.remaining, 0));
        ctx.set.headers["X-RateLimit-Reset"] = String(Math.ceil(result.resetTime / 1000));
      }

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        throw new RateLimitError(message, { traceId: ctx.traceId, retryAfter });
      }
    },
  };
}
