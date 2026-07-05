import { describe, it, expect, setSystemTime } from "bun:test";
import { LruCache } from "./lru";

describe("LruCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LruCache<string>(10);
    cache.set("a", "apple");
    expect(cache.get("a")).toBe("apple");
  });

  it("returns undefined for missing keys", () => {
    const cache = new LruCache<string>(10);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts least-recently-used when over capacity", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "apple");
    cache.set("b", "banana");
    cache.set("c", "cherry"); // evicts "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("banana");
    expect(cache.get("c")).toBe("cherry");
  });

  it("updates LRU order on get", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "apple");
    cache.set("b", "banana");
    cache.get("a"); // "a" becomes most-recently-used
    cache.set("c", "cherry"); // evicts "b", not "a"
    expect(cache.get("a")).toBe("apple");
    expect(cache.get("b")).toBeUndefined();
  });

  it("deletes a key", () => {
    const cache = new LruCache<string>(10);
    cache.set("a", "apple");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
  });

  it("clears all entries", () => {
    const cache = new LruCache<string>(10);
    cache.set("a", "apple");
    cache.set("b", "banana");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("reports size correctly", () => {
    const cache = new LruCache<string>(10);
    cache.set("a", "apple");
    cache.set("b", "banana");
    expect(cache.size).toBe(2);
  });

  it("has() returns true for existing keys", () => {
    const cache = new LruCache<string>(10);
    cache.set("a", "apple");
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("evicts expired entries via evictExpired", () => {
    const cache = new LruCache<string>(10);
    setSystemTime(new Date("2024-01-01T00:00:00Z"));
    cache.set("a", "apple", 1000); // expires at T+1000ms
    setSystemTime(new Date("2024-01-01T00:00:02Z"));
    expect(cache.evictExpired()).toBe(1);
    expect(cache.get("a")).toBeUndefined();
  });

  it("does not evict unexpired entries", () => {
    const cache = new LruCache<string>(10);
    setSystemTime(new Date("2024-01-01T00:00:00Z"));
    cache.set("a", "apple", 10000);
    setSystemTime(new Date("2024-01-01T00:00:02Z"));
    expect(cache.evictExpired()).toBe(0);
    expect(cache.get("a")).toBe("apple");
  });
});
