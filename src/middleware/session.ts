import type { ThinkContext, Middleware } from "../types";
import type { SessionConfig } from "../session";
import { createSessionStore, generateSid, serializeCookie } from "../session";

interface SessionCtx extends ThinkContext {
  __sid?: string;
  __sidNew?: boolean;
  __sessionSnapshot?: string;
}

function snapshot(data: unknown): string {
  return JSON.stringify(data);
}

export function createSessionMiddleware(config?: SessionConfig): Middleware {
  const store = createSessionStore(config);
  const cookieName = config?.name ?? "thinkts.sid";
  const maxAge = config?.maxAge ?? 86400;

  return {
    async onRequest(ctx: ThinkContext): Promise<void> {
      const sctx = ctx as SessionCtx;
      const sid = ctx.cookie[cookieName] ?? generateSid();
      const data = (await store.get(sid)) ?? {};
      ctx.session = data;
      sctx.__sid = sid;
      sctx.__sidNew = !ctx.cookie[cookieName];
      sctx.__sessionSnapshot = snapshot(data);
    },

    async onResponse(ctx: ThinkContext): Promise<void> {
      const sctx = ctx as SessionCtx;
      const sid = sctx.__sid;
      const isNew = sctx.__sidNew;
      if (!sid) return;

      if (ctx.session && snapshot(ctx.session) !== sctx.__sessionSnapshot) {
        await store.set(sid, ctx.session, maxAge);
      }

      if (isNew || !ctx.cookie[cookieName]) {
        const cookieValue = serializeCookie(cookieName, sid, config);
        const existing = ctx.set.headers["Set-Cookie"];
        if (Array.isArray(existing)) {
          existing.push(cookieValue);
        } else if (typeof existing === "string") {
          ctx.set.headers["Set-Cookie"] = [existing, cookieValue];
        } else {
          ctx.set.headers["Set-Cookie"] = cookieValue;
        }
      }
    },
  };
}
