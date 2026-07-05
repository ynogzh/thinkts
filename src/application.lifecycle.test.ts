import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config";
import { Application } from "./application";
import { createThink } from "./think";
import { createTestContext } from "./test-utils";
import type { Middleware } from "./types";

const rootPath = `${import.meta.dir}/..`;

function createApplicationFixture(middlewares: Middleware[]) {
  const config = loadConfig(rootPath, "test");
  const think = createThink(rootPath, config);
  const app = new Application({ ROOT_PATH: rootPath, env: "test" } as never);
  (app as unknown as { think: typeof think }).think = think;
  (app as unknown as { middlewares: Middleware[] }).middlewares = middlewares;
  (app as unknown as { composeMiddlewares: () => void }).composeMiddlewares();
  (app as unknown as { buildKernel: () => void }).buildKernel();
  return { app, think };
}

describe("Application response lifecycle", () => {
  it("runs response middleware once for health responses", async () => {
    let calls = 0;
    const { app, think } = createApplicationFixture([{ onResponse: async () => { calls += 1; } }]);
    const ctx = createTestContext({
      think,
      request: new Request("http://localhost/health"),
      url: new URL("http://localhost/health"),
    });

    await (app as unknown as { kernel: { execute: (ctx: unknown) => Promise<Response> } }).kernel.execute(ctx);
    await (app as unknown as { afterRequest: (ctx: unknown) => Promise<void> }).afterRequest(ctx);

    expect(calls).toBe(1);
  });

  it("runs response middleware once for request short-circuits", async () => {
    let calls = 0;
    const { app, think } = createApplicationFixture([
      {
        onRequest: async () => new Response("blocked", { status: 401 }),
        onResponse: async () => { calls += 1; },
      },
    ]);
    const ctx = createTestContext({
      think,
      request: new Request("http://localhost/protected"),
      url: new URL("http://localhost/protected"),
    });

    const response = await (app as unknown as { kernel: { execute: (ctx: unknown) => Promise<Response> } }).kernel.execute(ctx);
    await (app as unknown as { afterRequest: (ctx: unknown) => Promise<void> }).afterRequest(ctx);

    expect(response.status).toBe(401);
    expect(calls).toBe(1);
  });
});
