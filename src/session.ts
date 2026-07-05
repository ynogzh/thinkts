import type { BunRedisConfig, BunRedisAdapter } from "./model/adapters/redis";
import { createRedisAdapter } from "./model/adapters/redis";
import { LruCache } from "./lru";
export interface SessionStore {
  get(sid: string): Promise<Record<string, unknown> | null>;
  set(sid: string, data: Record<string, unknown>, maxAge?: number): Promise<void>;
  destroy(sid: string): Promise<void>;
}

export interface SessionConfig {
  type?: "memory" | "redis";
  name?: string;
  secret?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
  domain?: string;
  redis?: BunRedisConfig;
}

// ── Memory Store ────────────────────────────────────────────────

class MemoryStore implements SessionStore {
  private data = new LruCache<Record<string, unknown>>(10000);

  async get(sid: string): Promise<Record<string, unknown> | null> {
    return this.data.get(sid) ?? null;
  }

  async set(sid: string, data: Record<string, unknown>, maxAge?: number): Promise<void> {
    this.data.set(sid, data, maxAge ? maxAge * 1000 : undefined);
  }

  async destroy(sid: string): Promise<void> {
    this.data.delete(sid);
  }
}

// ── Redis Store ─────────────────────────────────────────────────

class RedisStore implements SessionStore {
  private client: BunRedisAdapter;
  private prefix: string;

  constructor(config: BunRedisConfig = {}) {
    this.client = createRedisAdapter(config);
    this.prefix = config.prefix ? `${config.prefix}:sess:` : "sess:";
  }

  async get(sid: string): Promise<Record<string, unknown> | null> {
    const raw = await this.client.get(`${this.prefix}${sid}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async set(sid: string, data: Record<string, unknown>, maxAge?: number): Promise<void> {
    const value = JSON.stringify(data);
    await this.client.set(`${this.prefix}${sid}`, value, maxAge);
  }

  async destroy(sid: string): Promise<void> {
    await this.client.delete(`${this.prefix}${sid}`);
  }
}

// ── Factory ─────────────────────────────────────────────────────

export function createSessionStore(config?: SessionConfig): SessionStore {
  if (config?.type === "redis") {
    return new RedisStore(config.redis);
  }
  return new MemoryStore();
}

// ── Utilities ───────────────────────────────────────────────────

export function generateSid(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function serializeCookie(name: string, value: string, config?: SessionConfig): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  const maxAge = config?.maxAge ?? 86400;
  if (maxAge > 0) parts.push(`Max-Age=${String(maxAge)}`);
  if (config?.path) parts.push(`Path=${config.path}`);
  if (config?.domain) parts.push(`Domain=${config.domain}`);
  if (config?.secure) parts.push("Secure");
  if (config?.httpOnly !== false) parts.push("HttpOnly");
  if (config?.sameSite) {
    if (config.sameSite === "None" && config.secure !== true) {
      throw new Error("SameSite=None requires Secure=true");
    }
    parts.push(`SameSite=${config.sameSite}`);
  }
  return parts.join("; ");
}
