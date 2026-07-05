import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { createTestContext, runMiddleware } from "./test-utils";
import { createHandler, normalizePath } from "./router/handler";
import { matchRoute, buildRouteTable } from "./router/table";
import { ControllerBase } from "./controller";
import { BaseService } from "./service";
import type { Middleware } from "./types";
import { Validate } from "./decorator";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function now(): number {
  return performance.now();
}

function stats(timesMs: number[]) {
  const sorted = [...timesMs].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const avg = total / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  return { avg, p50, p90, p99, total };
}

async function runConcurrent<T>(concurrency: number, total: number, task: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    const local: T[] = [];
    while (true) {
      const i = index++;
      if (i >= total) break;
      local.push(await task(i));
    }
    return local;
  });
  for (const batch of await Promise.all(workers)) {
    results.push(...batch);
  }
  return results;
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

class StressController extends ControllerBase {
  indexAction() {
    return { message: "hello", ts: Date.now() };
  }

  echoAction(opts: Record<string, unknown>) {
    return { echo: opts.q ?? opts.body, method: this.ctx.request.method };
  }

  calcAction(opts: Record<string, unknown>) {
    const n = Number(opts.n ?? 0);
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += i;
    return { n, sum };
  }

  @Validate(v.object({ id: v.pipe(v.string(), v.uuid()) }))
  validateAction(opts: Record<string, unknown>) {
    return { id: opts.id };
  }
}

class StressService extends BaseService {
  async ping() {
    return { pong: true };
  }
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

describe("stress tests", () => {
  it("handles 50k direct handler invocations", async () => {
    const handler = createHandler(
      { module: "stress", controller: "stress", action: "index", extra: [] },
      { StressController, stress: StressController },
      { StressService, stress: StressService },
      {}
    );

    const times: number[] = [];
    const results = await runConcurrent(64, 50000, async () => {
      const ctx = createTestContext();
      const t0 = now();
      const result = await handler(ctx);
      times.push(now() - t0);
      return result;
    });

    expect(results).toHaveLength(50000);
    expect(results.every((r) => (r as Record<string, unknown>).message === "hello")).toBe(true);
    const s = stats(times);
    console.log(
      `[handler] 50k requests, concurrency=64, total=${s.total.toFixed(1)}ms, avg=${s.avg.toFixed(3)}ms, p50=${s.p50.toFixed(3)}ms, p90=${s.p90.toFixed(3)}ms, p99=${s.p99.toFixed(3)}ms, rps=${((50000 / s.total) * 1000).toFixed(0)}`
    );
  });

  it("routes 20k dynamic requests through matchRoute", async () => {
    const routeTable = buildRouteTable(
      { defaultAction: "index" } as unknown as import("./types").AppConfig,
      { StressController },
      { StressService },
      {},
      [
        { match: /\/stress\/(?<id>[^/]+)/, target: "stress/echo" },
        { match: "/stress/calc", target: "stress/calc" },
      ]
    );

    const times: number[] = [];
    const results = await runConcurrent(32, 20000, async (i) => {
      const path = i % 2 === 0 ? `/stress/${i}` : "/stress/calc";
      const t0 = now();
      const match = matchRoute(routeTable, path);
      times.push(now() - t0);
      return match?.entry.type;
    });

    expect(results).toHaveLength(20000);
    const s = stats(times);
    console.log(
      `[router] 20k lookups, concurrency=32, total=${s.total.toFixed(1)}ms, avg=${s.avg.toFixed(3)}ms, p99=${s.p99.toFixed(3)}ms, rps=${((20000 / s.total) * 1000).toFixed(0)}`
    );
  });

  it("validates 10k requests with valibot schema", async () => {
    const handler = createHandler(
      { module: "stress", controller: "stress", action: "validate", extra: [] },
      { StressController, stress: StressController },
      {},
      {}
    );

    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const results = await runConcurrent(32, 10000, async () => {
      const ctx = createTestContext({ url: new URL(`http://localhost/?id=${id}`) });
      return handler(ctx);
    });

    expect(results).toHaveLength(10000);
    expect(results.every((r) => (r as Record<string, unknown>).id === id)).toBe(true);
  });

  it("runs a middleware chain under load", async () => {
    const mw: Middleware = {
      onRequest: async (ctx) => {
        ctx.session = { count: ((ctx.session as Record<string, number>)?.count ?? 0) + 1 };
      },
    };

    const results = await runConcurrent(32, 10000, async () => {
      const result = await runMiddleware([mw]);
      return (result.ctx.session as Record<string, number>).count;
    });

    expect(results).toHaveLength(10000);
    expect(results.every((c) => c === 1)).toBe(true);
  });

  it("normalizes 100k paths", async () => {
    const paths = [
      "/api//user/../profile",
      "/api/user/./settings/",
      "/api/user/../../secret",
      "/api\\user\\files",
      "/",
    ];
    const times: number[] = [];
    const results: string[] = [];
    for (let i = 0; i < 100000; i++) {
      const t0 = now();
      try {
        const r = normalizePath(paths[i % paths.length]);
        results.push(r);
      } catch {
        results.push("INVALID_PATH_TRAVERSAL");
      }
      times.push(now() - t0);
    }

    expect(results).toHaveLength(100000);
    const s = stats(times);
    console.log(
      `[normalizePath] 100k calls, concurrency=16, total=${s.total.toFixed(1)}ms, avg=${s.avg.toFixed(3)}ms, p99=${s.p99.toFixed(3)}ms, rps=${((100000 / s.total) * 1000).toFixed(0)}`
    );
  });
});
