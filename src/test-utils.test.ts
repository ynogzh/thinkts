import { describe, it, expect } from "bun:test";
import { createTestContext, runMiddleware } from "./test-utils";
import type { Middleware } from "./types";

describe("createTestContext", () => {
  it("creates a context with default values", () => {
    const ctx = createTestContext();
    expect(ctx.request).toBeInstanceOf(Request);
    expect(ctx.params).toEqual({});
    expect(ctx.cookie).toEqual({});
    expect(ctx.session).toEqual({});
    expect(ctx.set.status).toBe(200);
    expect(ctx.url.pathname).toBe("/");
    expect(ctx.traceId).toMatch(/^test-/);
  });

  it("allows overrides", () => {
    const ctx = createTestContext({
      params: { id: "42" },
      set: { status: 404, headers: {} },
    });
    expect(ctx.params?.id).toBe("42");
    expect(ctx.set.status).toBe(404);
  });
});

describe("runMiddleware", () => {
  it("runs middleware chain and returns context", async () => {
    const mw: Middleware = {
      onRequest: async (ctx) => {
        ctx.session = { user: "alice" };
      },
    };
    const result = await runMiddleware([mw]);
    expect(result.ctx.session).toEqual({ user: "alice" });
  });

  it("returns response if middleware returns one", async () => {
    const mw: Middleware = {
      onRequest: async () => {
        return new Response("hello");
      },
    };
    const result = await runMiddleware([mw]);
    expect(result.response).toBeInstanceOf(Response);
    expect(await result.response?.text()).toBe("hello");
  });
});
