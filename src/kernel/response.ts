import type { ThinkContext } from "../types";

/**
 * Convert a handler result into a Bun Response, mirroring the legacy
 * Application.toResponse behavior.
 */
export function toResponse(ctx: ThinkContext, result: unknown): Response {
  const status = ctx.set.status || 200;
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("X-Trace-Id", ctx.traceId);

  for (const [key, value] of Object.entries(ctx.set.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  if (result instanceof Response) return result;
  if (result === undefined || result === null) {
    return new Response(null, { status, headers });
  }
  if (typeof result === "string" || result instanceof Blob || result instanceof ReadableStream) {
    return new Response(result, { status, headers });
  }
  return new Response(JSON.stringify(result), { status, headers });
}
