import type { ThinkGlobal } from "./think";
import type { ThinkContext } from "./types";

/**
 * Create a background ThinkContext for service resolution outside
 * an active HTTP request (e.g. cron jobs, bootstrap hooks).
 */
export function createBackgroundThinkContext(think: ThinkGlobal): ThinkContext {
  const internalUrl = new URL("http://127.0.0.1/__internal__/service");
  return {
    request: new Request(internalUrl),
    server: {
      requestIP: () => null,
      stop: () => undefined,
    },
    set: { status: 200, headers: {} },
    body: undefined,
    cookie: {},
    session: {},
    jwt: { role: "superadmin" },
    user: { role: "superadmin" },
    think,
    traceId: "internal-service",
    url: internalUrl,
    meta: {
      startTime: Date.now(),
      timing: {},
      tags: {},
    },
  } as ThinkContext;
}
