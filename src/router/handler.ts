import type { ThinkContext } from "../types";
import type { Schema } from "../validate";
import { getValidateSchema } from "../decorator";
import { safeValidate } from "../validate";
import { ValidationError } from "../error";
import { toPascalCase } from "../utils";

export interface ParsedRoute {
  module: string;
  controller: string;
  action: string;
  extra: string[];
}

export interface RouteEntry {
  match: RegExp | string;
  type?: string;
  module?: string;
  controller?: string;
  action?: string;
  resource?: string;
  schema?: Schema;
  handler: (ctx: ThinkContext) => Promise<unknown>;
}

export function normalizePath(pathname: string): string {
  let normalized = pathname.replace(/\0/g, "").replace(/\\/g, "/");
  while (normalized.includes("//")) {
    normalized = normalized.replace(/\/+/g, "/");
  }
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error("INVALID_PATH_TRAVERSAL");
      }
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return "/" + segments.join("/");
}

/** Pre-compile a route handler: resolve Controller/Service/Logic class and method
 *  at startup so the runtime handler has zero lookups. */
export function createHandler(
  parsedRoute: ParsedRoute,
  controllers: Record<string, unknown>,
  services: Record<string, unknown>,
  logics: Record<string, unknown>
): (ctx: ThinkContext) => Promise<unknown> {
  // ── Startup-time resolution ─────────────────────────────────────
  const controllerPascal = toPascalCase(parsedRoute.controller);
  const ControllerClass = (controllers[controllerPascal] ?? controllers[parsedRoute.controller]) as
    | (new (...args: unknown[]) => Record<string, unknown>)
    | undefined;
  const ServiceClass = (services[controllerPascal] ?? services[parsedRoute.controller]) as
    | (new (...args: unknown[]) => Record<string, unknown>)
    | undefined;
  const LogicClass = (logics[controllerPascal] ?? logics[parsedRoute.controller]) as
    | (new (...args: unknown[]) => Record<string, unknown>)
    | undefined;

  if (!ControllerClass && !ServiceClass) {
    return async (ctx) => {
      ctx.module = parsedRoute.module;
      ctx.controller = parsedRoute.controller;
      ctx.action = parsedRoute.action;
      if (parsedRoute.extra.length > 0) {
        ctx.params = Object.fromEntries(parsedRoute.extra.map((v, i) => [String(i), v]));
      }
      ctx.set.status = 404;
      return { errno: 404, errmsg: `Not found: ${parsedRoute.controller}` };
    };
  }

  const controllerMethod = `${parsedRoute.action}Action`;
  const serviceMethod = parsedRoute.action;
  let TargetClass: (new (...args: unknown[]) => Record<string, unknown>) | undefined;
  let methodName = "";
  let isController = false;

  if (ControllerClass) {
    const proto = ControllerClass.prototype as Record<string, unknown>;
    if (proto && typeof proto[controllerMethod] === "function") {
      TargetClass = ControllerClass;
      methodName = controllerMethod;
      isController = true;
    } else if (ServiceClass) {
      const sProto = ServiceClass.prototype as Record<string, unknown>;
      if (sProto && typeof sProto[serviceMethod] === "function") {
        TargetClass = ServiceClass;
        methodName = serviceMethod;
      }
    }
  } else if (ServiceClass) {
    const sProto = ServiceClass.prototype as Record<string, unknown>;
    if (sProto && typeof sProto[serviceMethod] === "function") {
      TargetClass = ServiceClass;
      methodName = serviceMethod;
    }
  }

  if (!TargetClass) {
    return async (ctx) => {
      ctx.module = parsedRoute.module;
      ctx.controller = parsedRoute.controller;
      ctx.action = parsedRoute.action;
      if (parsedRoute.extra.length > 0) {
        ctx.params = Object.fromEntries(parsedRoute.extra.map((v, i) => [String(i), v]));
      }
      ctx.set.status = 404;
      return { errno: 404, errmsg: `Action not found: ${parsedRoute.action}` };
    };
  }

  // Pre-resolve validation schemas (metadata is on the prototype)
  const staticSchemas = (TargetClass as unknown as Record<string, unknown>).schemas as
    | Record<string, Schema>
    | undefined;
  const targetSchema = getValidateSchema(TargetClass.prototype, methodName) ?? staticSchemas?.[methodName];
  const staticLogicSchemas = LogicClass
    ? ((LogicClass as unknown as Record<string, unknown>).schemas as Record<string, Schema> | undefined)
    : undefined;
  const logicSchema = LogicClass
    ? getValidateSchema(LogicClass.prototype, methodName) ?? staticLogicSchemas?.[methodName]
    : undefined;

  // ── Runtime handler (zero lookups) ─────────────────────────────
  return async (ctx: ThinkContext): Promise<unknown> => {
    ctx.module = parsedRoute.module;
    ctx.controller = parsedRoute.controller;
    ctx.action = parsedRoute.action;
    if (parsedRoute.extra.length > 0) {
      ctx.params = Object.fromEntries(parsedRoute.extra.map((v, i) => [String(i), v]));
    }

    // Build opts (query + body + route params)
    const opts: Record<string, unknown> = {};
    if (ctx.params) Object.assign(opts, ctx.params);
    for (const [k, v] of ctx.url.searchParams) opts[k] = v;
    if (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) {
      Object.assign(opts, ctx.body as Record<string, unknown>);
    }

    // Validate
    let schema = targetSchema;
    if (!schema && isController && logicSchema) {
      schema = logicSchema;
    }
    if (schema) {
      const result = safeValidate(schema, opts);
      if (!result.success) {
        throw new ValidationError(`Validation failed: ${result.errors?.join("; ")}`);
      }
      if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
        Object.assign(opts, result.data);
      }
    }
    // Logic layer
    if (isController && LogicClass) {
      const logicInstance = new LogicClass(ctx);
      if (typeof logicInstance.__before === "function") {
        const r = await logicInstance.__before();
        if (r !== undefined) return r;
      }
      if (typeof (logicInstance as Record<string, unknown>)[methodName] === "function") {
        const r = await (
          (logicInstance as Record<string, unknown>)[methodName] as () => Promise<unknown> | unknown
        )();
        if (r !== undefined) return r;
      }
      if (typeof logicInstance.__after === "function") {
        const r = await logicInstance.__after();
        if (r !== undefined) return r;
      }
    }

    // Target action
    const instance = new TargetClass!(ctx);
    if (typeof instance.__before === "function") {
      const r = await instance.__before();
      if (r !== undefined) return r;
    }
    let actionResult: unknown;
    if (typeof (instance as Record<string, unknown>)[methodName] === "function") {
      actionResult = await (
        (instance as Record<string, unknown>)[methodName] as (
          opts?: Record<string, unknown>
        ) => Promise<unknown> | unknown
      )(opts);
    }
    if (typeof instance.__after === "function") {
      const r = await instance.__after();
      if (r !== undefined) return r;
    }
    return actionResult;
  };
}
