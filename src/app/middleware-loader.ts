import type { Middleware } from "../types";
import type { Logger } from "../logger";
import { loadMiddlewareConfig } from "../loader";
import {
  createStaticMiddleware,
  createTraceMiddleware,
  createCORSMiddleware,
  createJWTMiddleware,
  createSessionMiddleware,
  createRateLimitMiddleware,
  createGraphQLMiddleware,
} from "../middleware";

export function loadMiddlewares(
  configPath: string,
  rootPath: string,
  logger: Logger,
  env: string
): { middlewares: Middleware[]; readies: Promise<void>[] } {
  const middlewares: Middleware[] = [];
  const readies: Promise<void>[] = [];
  const entries = loadMiddlewareConfig(configPath);
  for (const mw of entries) {
    const handle = typeof mw === "string" ? mw : ((mw as Record<string, unknown>).handle as string);
    const enable = typeof mw === "string" ? true : ((mw as Record<string, unknown>).enable ?? true);
    let opts: Record<string, unknown> = {};
    if (typeof mw !== "string") {
      opts = (mw as Record<string, unknown>).options as Record<string, unknown> ?? {};
    }
    if (!enable) continue;

    switch (handle) {
      case "static":
        middlewares.push(createStaticMiddleware(rootPath, opts as { root?: string; publicPath?: string }));
        break;
      case "trace":
        middlewares.push(createTraceMiddleware(logger, env === "development"));
        break;
      case "cors":
        middlewares.push(createCORSMiddleware(opts as { origin?: string; methods?: string; headers?: string; credentials?: boolean; maxAge?: number }));
        break;
      case "jwt": {
        const m = createJWTMiddleware(opts as { secret: string; algorithm?: string; ignore?: (string | RegExp)[] });
        readies.push(m.ready);
        middlewares.push(m);
        break;
      }
      case "bearer": {
        const m = createJWTMiddleware({ ...(opts as Record<string, unknown>), secret: (opts as { secret: string }).secret });
        readies.push(m.ready);
        middlewares.push(m);
        break;
      }
      case "cookie":
        break;
      case "session":
        middlewares.push(createSessionMiddleware(opts as { name?: string; secret?: string; maxAge?: number; type?: "memory" | "redis"; redis?: Record<string, unknown> }));
        break;
      case "ratelimit":
        middlewares.push(createRateLimitMiddleware(opts as { windowMs?: number; max?: number; skip?: (string | RegExp)[]; message?: string; headers?: boolean }));
        break;
      case "graphql":
        middlewares.push(createGraphQLMiddleware(opts as { schema?: unknown; rootValue?: Record<string, unknown>; graphiql?: boolean; playground?: boolean }));
        break;
      default: {
        const custom = loadCustomMiddleware(handle, opts, rootPath, logger, middlewares);
        if (custom) middlewares.push(custom);
      }
    }
  }
  return { middlewares, readies };
}

function loadCustomMiddleware(
  handle: string,
  opts: Record<string, unknown>,
  rootPath: string,
  logger: Logger,
  outMiddlewares: Middleware[]
): Middleware | undefined {
  const paths = [
    `${rootPath}/src/middleware/${handle}.ts`,
    `${rootPath}/src/middleware/${handle}.js`,
    `${rootPath}/middleware/${handle}.ts`,
    `${rootPath}/middleware/${handle}.js`,
  ];
  for (const p of paths) {
    try {
      const mod = require(p) as Record<string, unknown>;
      const exported = mod.default ?? mod[handle] ?? mod;
      if (typeof exported === "function") {
        const result = (exported as (opts: Record<string, unknown>) => Middleware | Middleware[])(opts);
        if (Array.isArray(result)) {
          for (const mw of result) outMiddlewares.push(mw);
          return undefined;
        }
        return result as Middleware;
      }
      if (exported && (typeof exported === "object")) {
        return exported as Middleware;
      }
    } catch (err) {
      if (err instanceof Error && !err.message.includes("Cannot find module")) {
        logger.warn(`Middleware ${handle} error: ${err.message}`);
      }
      continue;
    }
  }
  logger.warn(`Unknown middleware: ${handle}`);
  return undefined;
}
