import type { ThinkContext } from "../types";

/**
 * Extract tenant id from request headers, jwt payload, user object, or request params.
 *
 * Priority:
 * 1. `x-tenant-id` header
 * 2. `tenant_id` in jwt payload
 * 3. `tenantId` in user object (if already resolved by auth middleware)
 * 4. `tenant_id` query/body param for GET/POST convenience (last resort)
 */
export function extractTenantId(ctx: ThinkContext): string | number | undefined {
  const header = ctx.request.headers.get("x-tenant-id");
  if (header) {
    const num = Number(header);
    return Number.isNaN(num) ? header : num;
  }
  const jwtTenant = ctx.jwt?.tenant_id;
  if (jwtTenant !== undefined && jwtTenant !== null) return jwtTenant as string | number;
  const userTenant = ctx.user?.tenant_id;
  if (userTenant !== undefined && userTenant !== null) return userTenant as string | number;
  const param = ctx.params?.tenant_id ?? ctx.url.searchParams.get("tenant_id");
  if (param !== undefined && param !== null && param !== "") {
    const num = Number(param);
    return Number.isNaN(num) ? param : num;
  }
  if (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) {
    const bodyTenant = (ctx.body as Record<string, unknown>).tenant_id;
    if (bodyTenant !== undefined && bodyTenant !== null && bodyTenant !== "") {
      const num = Number(bodyTenant);
      return Number.isNaN(num) ? (bodyTenant as string) : num;
    }
  }
  return undefined;
}

/**
 * Resolve tenant context from request and attach it to ctx.
 */
export async function resolveTenantContext(ctx: ThinkContext): Promise<void> {
  const tenantId = extractTenantId(ctx);
  if (tenantId !== undefined) {
    ctx.tenantId = tenantId;
  }
}

/**
 * Build opts from query + body + route params.
 */
export function buildRequestOpts(ctx: ThinkContext): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (ctx.params) Object.assign(opts, ctx.params);
  for (const [k, v] of ctx.url.searchParams) opts[k] = v;
  if (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) {
    Object.assign(opts, ctx.body as Record<string, unknown>);
  }
  return opts;
}
