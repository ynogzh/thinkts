import type { ThinkContext, AppConfig, Middleware } from "./types";
import type { ThinkGlobal } from "./think";
import { Application, type ApplicationOptions } from "./application";
import { loadConfig } from "./config";

/**
 * Create a mock ThinkContext for unit testing controllers/services.
 * All optional fields can be overridden.
 */
export function createTestContext(overrides?: Partial<ThinkContext>): ThinkContext {
  const url = new URL("http://localhost/");
  return {
    request: new Request(url.toString()),
    params: {},
    cookie: {},
    session: {},
    set: { status: 200, headers: {} },
    url,
    traceId: `test-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  } as ThinkContext;
}

/**
 * Create a test Application instance without starting the HTTP server.
 * Useful for integration testing with a real (or in-memory) database.
 */
export async function createTestApp(
  rootPath: string,
  env = "test"
): Promise<{ app: Application; think: ThinkGlobal }> {
  process.env.NODE_ENV = env;
  const appConfig = loadConfig(rootPath, env);
  const app = new Application({
    ROOT_PATH: rootPath,
    env,
    ...appConfig,
  } as unknown as ApplicationOptions);
  return { app, think: (app as unknown as Record<string, unknown>).think as ThinkGlobal };
}

/**
 * Execute a middleware chain against a mock context and return the result.
 */
export async function runMiddleware(
  middlewares: Middleware[],
  ctx?: Partial<ThinkContext>
): Promise<{ ctx: ThinkContext; response?: Response }> {
  const context = createTestContext(ctx);
  for (const mw of middlewares) {
    if (mw.onRequest) {
      const result = await mw.onRequest(context);
      if (result instanceof Response) {
        return { ctx: context, response: result };
      }
    }
  }
  return { ctx: context };
}
