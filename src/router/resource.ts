import type { ThinkContext, RouterRule } from "../types";
import { createHandler } from "./handler";

export type ResourceAction = "list" | "create" | "get" | "update" | "delete";

export interface ResourceOptions {
  only?: ResourceAction[];
  except?: ResourceAction[];
}

export function createResourceHandler(
  controller: string,
  controllers: Record<string, unknown>,
  services: Record<string, unknown>,
  logics: Record<string, unknown>
): (ctx: ThinkContext) => Promise<unknown> {
  // Pre-compile all action handlers at startup.
  const handlers: Record<string, (ctx: ThinkContext) => Promise<unknown>> = {
    list: createHandler({ module: "home", controller, action: "list", extra: [] }, controllers, services, logics),
    create: createHandler({ module: "home", controller, action: "create", extra: [] }, controllers, services, logics),
    get: createHandler({ module: "home", controller, action: "get", extra: [] }, controllers, services, logics),
    update: createHandler({ module: "home", controller, action: "update", extra: [] }, controllers, services, logics),
    delete: createHandler({ module: "home", controller, action: "delete", extra: [] }, controllers, services, logics),
  };

  return async (ctx: ThinkContext): Promise<unknown> => {
    // Normalize wildcard params so item routes expose an `id` key.
    if (ctx.params && ctx.params["0"] !== undefined && ctx.params.id === undefined) {
      ctx.params = { ...ctx.params, id: ctx.params["0"] };
    }
    const method = ctx.request.method;
    const hasId = ctx.params && Object.keys(ctx.params).length > 0;
    let action: string;
    switch (method) {
      case "GET":
        action = hasId ? "get" : "list";
        break;
      case "POST":
        action = "create";
        break;
      case "PUT":
      case "PATCH":
        action = "update";
        break;
      case "DELETE":
        action = "delete";
        break;
      default:
        ctx.set.status = 405;
        return { errno: 405, errmsg: "Method not allowed" };
    }
    return handlers[action](ctx);
  };
}

export function createResourceRules(
  path: string,
  controller: string,
  options?: ResourceOptions
): RouterRule[] {
  const actions: ResourceAction[] = ["list", "create", "get", "update", "delete"];
  const filtered = actions.filter((a) => {
    if (options?.only && !options.only.includes(a)) return false;
    if (options?.except?.includes(a)) return false;
    return true;
  });

  const hasCollection = filtered.includes("list") || filtered.includes("create");
  const hasItem = filtered.some((a) => ["get", "update", "delete"].includes(a));
  if (!hasCollection && !hasItem) return [];

  const rules: RouterRule[] = [];
  if (hasCollection) {
    rules.push({ type: "resource", match: path, target: controller });
  }
  if (hasItem) {
    rules.push({ type: "resource", match: `${path}/*`, target: controller });
  }
  return rules;
}
