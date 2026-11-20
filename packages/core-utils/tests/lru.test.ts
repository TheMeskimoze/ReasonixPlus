import { describe, expect, it, vi } from "vitest";
import { LruCache, TtlLruCache } from "../src/lru.js";

describe("LruCache", () => {
  it("evicts the least recently used key, not the oldest insert", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("overwrites in place without growing past the limit", () => {
    const cache = new LruCache<string, number>(1);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBe(2);
  });

  it("clears every entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("TtlLruCache", () => {
  it("treats an expired entry as a miss", () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlLruCache<string, number>(2, 1_000);
      cache.set("a", 1);
      vi.advanceTimersByTime(999);
      expect(cache.get("a")).toBe(1);
      vi.advanceTimersByTime(1);
      expect(cache.get("a")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
