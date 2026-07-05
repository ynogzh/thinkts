/**
 * Simple LRU (Least Recently Used) cache with TTL support.
 * Used by MemoryCacheAdapter, MemoryRateLimiter, MemoryStore, SCHEMA_CACHE.
 */

interface LruEntry<V> {
  value: V;
  expires?: number;
}

export class LruCache<V> {
  private data = new Map<string, LruEntry<V>>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const entry = this.data.get(key);
    if (entry === undefined) return undefined;
    if (entry.expires !== undefined && Date.now() > entry.expires) {
      this.data.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.data.delete(key);
    this.data.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    // Remove old entry if exists
    this.data.delete(key);
    const expires = ttlMs ? Date.now() + ttlMs : undefined;
    this.data.set(key, { value, expires });
    if (this.data.size > this.maxSize) {
      const first = this.data.keys().next().value;
      if (first !== undefined) this.data.delete(first);
    }
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.data.size;
  }

  /** Evict expired entries. Returns number of evicted items. */
  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.data) {
      if (entry.expires !== undefined && now > entry.expires) {
        this.data.delete(key);
        count++;
      }
    }
    return count;
  }
}
