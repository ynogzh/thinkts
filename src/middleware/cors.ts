import type { ThinkContext } from "../types";

export interface CORSOptions {
  origin?: string;
  methods?: string;
  headers?: string;
  credentials?: boolean;
  maxAge?: number;
}

export function createCORSMiddleware(
  options?: CORSOptions
): { onRequest: (ctx: ThinkContext) => Response | void } {
  const origin = options?.origin ?? "*";
  const methods = options?.methods ?? "GET, POST, PUT, DELETE, PATCH, OPTIONS";
  const headers = options?.headers ?? "Content-Type, Authorization";
  const credentials = options?.credentials ?? false;
  const maxAge = options?.maxAge;

  return {
    onRequest(ctx: ThinkContext): Response | void {
      ctx.set.headers["Access-Control-Allow-Origin"] = origin;
      ctx.set.headers["Access-Control-Allow-Methods"] = methods;
      ctx.set.headers["Access-Control-Allow-Headers"] = headers;
      if (credentials) {
        ctx.set.headers["Access-Control-Allow-Credentials"] = "true";
      }
      if (maxAge !== undefined) {
        ctx.set.headers["Access-Control-Max-Age"] = String(maxAge);
      }

      if (ctx.request.method === "OPTIONS") {
        const h = new Headers();
        for (const [k, v] of Object.entries(ctx.set.headers)) {
          if (typeof v === "string") h.set(k, v);
        }
        return new Response(null, { status: 204, headers: h });
      }
    },
  };
}
