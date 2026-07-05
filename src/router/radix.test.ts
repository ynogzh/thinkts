import { describe, expect, it } from "bun:test";
import { RadixTree } from "./radix";

describe("RadixTree", () => {
  it("matches exact static paths", () => {
    const tree = new RadixTree();
    tree.insert("/health", { match: "/health", handler: async () => "ok" } as any);
    tree.insert("/api/users", { match: "/api/users", handler: async () => "users" } as any);

    expect(tree.match("/health")?.entry.match).toBe("/health");
    expect(tree.match("/api/users")?.entry.match).toBe("/api/users");
    expect(tree.match("/unknown")).toBeUndefined();
  });

  it("matches parameterized paths", () => {
    const tree = new RadixTree();
    tree.insert("/api/users/:id", { match: "/api/users/:id", handler: async () => "user" } as any);
    tree.insert("/api/posts/:id/comments/:cid", { match: "/api/posts/:id/comments/:cid", handler: async () => "comment" } as any);

    const m1 = tree.match("/api/users/42");
    expect(m1?.entry.match).toBe("/api/users/:id");
    expect(m1?.params).toEqual({ id: "42" });

    const m2 = tree.match("/api/posts/7/comments/3");
    expect(m2?.entry.match).toBe("/api/posts/:id/comments/:cid");
    expect(m2?.params).toEqual({ id: "7", cid: "3" });
  });

  it("prefers static over param when both exist", () => {
    const tree = new RadixTree();
    tree.insert("/api/users/list", { match: "/api/users/list", handler: async () => "list" } as any);
    tree.insert("/api/users/:id", { match: "/api/users/:id", handler: async () => "user" } as any);

    expect(tree.match("/api/users/list")?.entry.match).toBe("/api/users/list");
    expect(tree.match("/api/users/42")?.entry.match).toBe("/api/users/:id");
  });

  it("handles deep nested DSL routes", () => {
    const tree = new RadixTree();
    tree.insert("/iotbiz/device/category/list", { match: "/iotbiz/device/category/list", handler: async () => "list" } as any);
    tree.insert("/iotbiz/device/category/get/:id", { match: "/iotbiz/device/category/get/:id", handler: async () => "get" } as any);
    tree.insert("/iotbiz/device/category/update/:id", { match: "/iotbiz/device/category/update/:id", handler: async () => "update" } as any);

    expect(tree.match("/iotbiz/device/category/list")?.entry.match).toBe("/iotbiz/device/category/list");
    expect(tree.match("/iotbiz/device/category/get/99")?.params).toEqual({ id: "99" });
    expect(tree.match("/iotbiz/device/category/update/1")?.params).toEqual({ id: "1" });
  });

  it("returns undefined for non-existent routes", () => {
    const tree = new RadixTree();
    tree.insert("/api/test", { match: "/api/test", handler: async () => {} } as any);

    expect(tree.match("/api")).toBeUndefined();
    expect(tree.match("/api/test/extra")).toBeUndefined();
    expect(tree.match("/")).toBeUndefined();
  });

  it("tracks node count", () => {
    const tree = new RadixTree();
    expect(tree.size).toBe(1); // root only

    tree.insert("/a/b/c", { match: "/a/b/c", handler: async () => {} } as any);
    // root → a → b → c = 4 nodes
    expect(tree.size).toBe(4);

    tree.insert("/a/b/d", { match: "/a/b/d", handler: async () => {} } as any);
    // root → a → b → c, d = 5 nodes (shares root/a/b)
    expect(tree.size).toBe(5);

    tree.insert("/a/:id", { match: "/a/:id", handler: async () => {} } as any);
    // root → a → (static) + (:id param node) → param child = 6 nodes
    expect(tree.size).toBe(6);
  });
});
