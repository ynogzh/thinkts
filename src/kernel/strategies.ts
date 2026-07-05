import { matchRoute, type RouteTable, type RouteMatch } from "../router/table";
import { safeValidate } from "../validate";
import { toThinkError, NotFoundError, ForbiddenError } from "../error";
import type { AclConfig, AclRule } from "../acl";
import { buildRequestOpts } from "./utils";
import { toResponse } from "./response";
import type {
  KernelContext, RouterStrategy, ValidatorStrategy, AuthorizerStrategy,
  ActionExecutorStrategy, ResponderStrategy, ErrorFormatterStrategy,
} from "./types";

/**
 * Default router strategy using the precompiled route table.
 */
export class DefaultRouterStrategy implements RouterStrategy {
  constructor(private routeTable: RouteTable) {}

  async match(ctx: KernelContext): Promise<RouteMatch | undefined> {
    return matchRoute(this.routeTable, ctx.url.pathname);
  }
}

/**
 * Default validator strategy.
 *
 * Reads the schema from the precompiled route entry (if any) and validates
 * the merged request opts. If no schema is attached, opts are returned as-is.
 */
export class DefaultValidatorStrategy implements ValidatorStrategy {
  async validate(ctx: KernelContext): Promise<import("../validate").ValidationResult<unknown>> {
    const schema = ctx.route?.entry.schema;
    const opts = buildRequestOpts(ctx);
    if (!schema) return { success: true, data: opts };

    const result = safeValidate(schema, opts);
    if (!result.success) return result;

    return { success: true, data: { ...opts, ...(result.data ?? {}) } };
  }
}

function actionToAclOperation(action: string): "select" | "find" | "add" | "update" | "delete" {
  switch (action) {
    case "list": case "page": case "search": return "select";
    case "create": return "add";
    case "get": return "find";
    case "update": return "update";
    case "delete": return "delete";
    default: return "select";
  }
}

function resolveAclRule(acl: AclConfig, modelName: string, role: string): AclRule | undefined {
  return acl[`${modelName}:${role}`] ?? acl[role] ?? acl["*"];
}

/**
 * Default authorizer strategy.
 *
 * Performs a gateway-level ACL check using the static Model.acl config.
 * Field-level and row-level filtering remain the responsibility of the
 * model layer (Model.acl(role, ctx)).
 */
export class DefaultAuthorizerStrategy implements AuthorizerStrategy {
  async authorize(ctx: KernelContext): Promise<boolean> {
    const acl = (ctx.think.Model.acl as AclConfig | undefined) ?? {};
    if (Object.keys(acl).length === 0) return true;
    const role = (ctx.user?.role as string) ?? "guest";
    const modelName = ctx.route?.entry.resource ?? ctx.controller ?? "*";
    const action = ctx.action ?? "*";
    const operation = actionToAclOperation(action);

    const rule = resolveAclRule(acl, modelName, role);
    if (!rule) return true;

    if (rule.deny?.includes(operation)) {
      throw new ForbiddenError(`ACL denied: ${operation} on ${modelName}`);
    }
    if (rule.allow && !rule.allow.includes(operation)) {
      throw new ForbiddenError(`ACL denied: ${operation} on ${modelName}`);
    }
    return true;
  }
}

/**
 * Default action executor strategy.
 *
 * Delegates to the precompiled route handler.
 */
export class DefaultActionExecutorStrategy implements ActionExecutorStrategy {
  async execute(ctx: KernelContext): Promise<unknown> {
    if (!ctx.route?.entry.handler) {
      throw new NotFoundError("No handler for route");
    }
    return ctx.route.entry.handler(ctx);
  }
}

/**
 * Default responder strategy.
 */
export class DefaultResponderStrategy implements ResponderStrategy {
  success(ctx: KernelContext): Response {
    return toResponse(ctx, ctx.result);
  }

  notFound(ctx: KernelContext): Response {
    return toResponse(ctx, { errno: 404, errmsg: `Not found: ${ctx.url.pathname}` });
  }

  validationError(ctx: KernelContext, result: import("../validate").ValidationResult<unknown>): Response {
    const errors = result.errors?.join("; ") ?? "Validation failed";
    return toResponse(ctx, { errno: 400, errmsg: errors });
  }

  forbidden(ctx: KernelContext): Response {
    return toResponse(ctx, { errno: 403, errmsg: "Forbidden" });
  }

  error(ctx: KernelContext, error: Error): Response {
    const thinkError = toThinkError(error, ctx.traceId);
    ctx.set.status = thinkError.status;
    return toResponse(ctx, { errno: thinkError.errno, errmsg: thinkError.message, traceId: thinkError.traceId });
  }
}

/**
 * Default error formatter strategy.
 */
export class DefaultErrorFormatterStrategy implements ErrorFormatterStrategy {
  private env: string;

  constructor(env?: string) {
    this.env = env ?? process.env.NODE_ENV ?? "development";
  }

  format(ctx: KernelContext, error: Error): { errno: number; errmsg: string; data?: unknown } {
    const thinkErr = toThinkError(error, ctx.traceId);
    const payload: Record<string, unknown> = {
      errno: thinkErr.errno,
      errmsg: thinkErr.message,
      traceId: thinkErr.traceId,
    };
    if (this.env === "development") {
      payload.stack = thinkErr.stack;
      if (thinkErr.cause) payload.cause = thinkErr.cause.message;
      payload.controller = ctx.controller;
      payload.action = ctx.action;
    }
    return payload as { errno: number; errmsg: string; data?: unknown };
  }
}
