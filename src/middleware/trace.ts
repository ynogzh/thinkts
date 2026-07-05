import type { ThinkContext } from "../types";
import { toThinkError } from "../error";

export function createTraceMiddleware(
  logger: Logger,
  isDev: boolean
): { onRequest: (ctx: ThinkContext) => void; onError: (ctx: ThinkContext, error: Error) => Response } {
  return {
    onRequest(ctx: ThinkContext): void {
      logger.info(`${ctx.request.method} ${ctx.request.url}`);
    },
    onError(ctx: ThinkContext, error: Error): Response {
      const thinkError = toThinkError(error, ctx.traceId);
      logger.error(`[ERROR] ${ctx.request.url}: ${thinkError.message}\n${thinkError.stack ?? ""}`);
      const body = isDev
        ? { errno: thinkError.errno, errmsg: thinkError.message, traceId: thinkError.traceId, stack: thinkError.stack }
        : { errno: thinkError.errno, errmsg: thinkError.message, traceId: thinkError.traceId };
      return new Response(JSON.stringify(body), {
        status: thinkError.status,
        headers: { "Content-Type": "application/json", "X-Trace-Id": thinkError.traceId },
      });
    },
  };
}
