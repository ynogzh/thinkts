import { BunRedisAdapter, createRedisAdapter } from "./model/adapters/redis";
import { LruCache } from "./lru";

const DEFAULT_MAX_CACHE_SIZE = 1024;

interface CacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, timeout?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CacheConfig {
  handle?: string | (new (config: Record<string, unknown>) => CacheAdapter);
  timeout?: number;
  [key: string]: unknown;
}

/** Default in-process memory cache — works out of the box without any config. */
class MemoryCacheAdapter implements CacheAdapter {
  private data = new LruCache<{ value: string; expires?: number }>(DEFAULT_MAX_CACHE_SIZE);

  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (entry === undefined) return null;
    return entry.value;
  }

  async set(key: string, value: string, timeout?: number): Promise<void> {
    this.data.set(key, { value }, timeout ? timeout * 1000 : undefined);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}
const adapterInstances = new Map<string, CacheAdapter>();
const defaultMemoryAdapter = new MemoryCacheAdapter();

function getAdapter(name: string, config?: CacheConfig): CacheAdapter | undefined {
  if (!config?.handle) {
    // No explicit handle configured — use default memory adapter
    // (users can still register named adapters via thinkCache adapterInstances)
    return adapterInstances.get(name) ?? defaultMemoryAdapter;
  }
  if (adapterInstances.has(name)) {
    return adapterInstances.get(name);
  }
  const Handle = config.handle;
  let adapter: CacheAdapter;
  if (typeof Handle === "string") {
    try {
      const mod = require(Handle);
      const Cls = mod.default ?? mod;
      adapter = new Cls(config);
    } catch (err) {
      throw new Error(`Failed to load cache adapter "${Handle}": ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (typeof Handle === "function") {
    adapter = new Handle(config);
  } else {
    throw new TypeError("config.handle must be a string or constructor");
  }
  adapterInstances.set(name, adapter);
  return adapter;
}

function isCacheAdapter(value: unknown): value is CacheAdapter {
  return (
    value !== null &&
    typeof value === "object" &&
    "get" in value &&
    "set" in value &&
    "delete" in value
  );
}

export async function thinkCache(
  name: string,
  value?: unknown,
  config?: CacheConfig
): Promise<unknown> {
  const adapter = getAdapter(name, config);
  if (!isCacheAdapter(adapter)) {
    throw new Error(`Cache adapter for "${name}" is not available`);
  }
  if (value === null) {
    await adapter.delete(name);
    return;
  }
  if (value === undefined) {
    const result = await adapter.get(name);
    return result ?? undefined;
  }
  if (typeof value === "function") {
    const cached = await adapter.get(name);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
    const result = await (value as () => unknown | Promise<unknown>)();
    if (result !== undefined) {
      await adapter.set(name, typeof result === "string" ? result : JSON.stringify(result));
    }
    return result;
  }
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const timeout = config?.timeout;
  await adapter.set(name, serialized, timeout);
  return;
}

/** JSON cache helper — auto-serializes on write and parses on read. */
export async function thinkCacheJSON<T = unknown>(
  name: string,
  value?: T,
  config?: CacheConfig
): Promise<T | undefined> {
  if (value === undefined) {
    const raw = await thinkCache(name, undefined, config);
    if (raw === undefined || raw === null) return undefined;
    try {
      return JSON.parse(raw as string) as T;
    } catch {
      return undefined;
    }
  }
  await thinkCache(name, JSON.stringify(value), config);
  return value;
}
export { BunRedisAdapter, createRedisAdapter };
