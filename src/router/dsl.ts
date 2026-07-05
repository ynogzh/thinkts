import type { ThinkContext } from "../types";
import type { DslAppData, DslModelEntry, DslServiceEntry } from "../dsl-model/types";
import { createAdminHandlers } from "../dsl-model/admin";
import { BaseService, bindServiceContext } from "../service";
import type { RouteTable } from "./table";
import { executeDslAction } from "../dsl-model/executor";

export function parseModelRoute(name: string): { module: string; resource: string; path: string } {
  const parts = name.split("_");
  if (parts.length === 1) {
    return { module: "home", resource: name, path: `/${name}` };
  }
  const module = parts[0] || "home";
  const resource = parts.slice(1).join("/");
  return { module, resource, path: `/${module}/${resource}` };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ACTION_METHODS: Record<string, string> = {
  list: "GET", create: "POST", get: "GET", update: "POST",
  delete: "POST", page: "GET", search: "GET",
};

const ACTION_METHOD_MAP: Record<string, string> = {
  page: "pageAction", search: "searchAction",
};

function createDslActionHandler(
  action: string,
  entry: DslModelEntry,
  service?: DslServiceEntry,
): (ctx: ThinkContext) => Promise<unknown> {
  return async (ctx: ThinkContext) => {
    const { module, resource } = parseModelRoute(entry.name);
    ctx.module = module;
    ctx.controller = resource;
    ctx.action = action;

    const expected = ACTION_METHODS[action];
    if (expected && ctx.request.method !== expected) {
      ctx.set.status = 405;
      return { errno: 405, errmsg: "Method not allowed" };
    }

    let opts: Record<string, unknown>;
    if (action === "list" || action === "page" || action === "search") {
      opts = {};
      for (const [k, v] of ctx.url.searchParams) opts[k] = v;
      if (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) {
        Object.assign(opts, ctx.body as Record<string, unknown>);
      }
      for (const key of ["where", "order", "field"]) {
        const val = opts[key];
        if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
          try { opts[key] = JSON.parse(val); } catch { /* leave as string */ }
        }
      }
    } else {
      opts = { ...(ctx.body as Record<string, unknown> ?? {}), ...(ctx.params ?? {}) };
    }

    return executeDslAction({ ctx, modelEntry: entry, serviceEntry: service, action, opts });
  };
}

export function registerDslModelRoutes(table: RouteTable, dslData: DslAppData): void {
  for (const [name, entry] of Object.entries(dslData.models)) {
    const service = dslData.services[name];
    const { path } = parseModelRoute(name);
    const tableEntry = dslData.tables[name];

    const listHandler = createDslActionHandler("list", entry, service);
    const createHandler = createDslActionHandler("create", entry, service);
    const getHandler = createDslActionHandler("get", entry, service);
    const updateHandler = createDslActionHandler("update", entry, service);
    const deleteHandler = createDslActionHandler("delete", entry, service);
    const pageHandler = createDslActionHandler("page", entry, service);
    const searchHandler = createDslActionHandler("search", entry, service);

    const routeMeta = parseModelRoute(name);

    // Static routes — also inserted into radix tree for O(k) matching
    const staticEntry = (action: string, handler: ReturnType<typeof createDslActionHandler>) => ({
      match: `${path}/${action}`,
      type: "dsl-resource" as const,
      module: routeMeta.module,
      controller: routeMeta.resource,
      action,
      resource: name,
      handler,
    });

    const listEntry = staticEntry("list", listHandler);
    const createEntry = staticEntry("create", createHandler);
    const pageEntry = staticEntry("page", pageHandler);
    const searchEntry = staticEntry("search", searchHandler);

    table.exact.set(`${path}/list`, listEntry);
    table.exact.set(`${path}/create`, createEntry);
    table.exact.set(`${path}/page`, pageEntry);
    table.exact.set(`${path}/search`, searchEntry);

    if (tableEntry) {
      const tableRouteEntry = {
        match: `${path}/table`,
        type: "dsl-resource" as const,
        module: routeMeta.module,
        controller: routeMeta.resource,
        action: "table",
        resource: name,
        handler: async (ctx: ThinkContext) => {
          if (ctx.request.method !== "GET") {
            ctx.set.status = 405;
            return { errno: 405, errmsg: "Method not allowed" };
          }
          return { errno: 0, data: tableEntry.table };
        },
      };
      table.exact.set(`${path}/table`, tableRouteEntry);
      table.radix.insert(`${path}/table`, tableRouteEntry);
    }

    // Radix tree entries for parameterized routes (O(k) matching)
    const getRadixEntry = { ...staticEntry("get", getHandler), match: `${path}/get/:id` };
    const updateRadixEntry = { ...staticEntry("update", updateHandler), match: `${path}/update/:id` };
    const deleteRadixEntry = { ...staticEntry("delete", deleteHandler), match: `${path}/delete/:id` };
    table.radix.insert(`${path}/get/:id`, getRadixEntry);
    table.radix.insert(`${path}/update/:id`, updateRadixEntry);
    table.radix.insert(`${path}/delete/:id`, deleteRadixEntry);

    // Regex patterns for backward compat
    const baseRegex = escapeRegExp(path);
    table.patterns.push({
      match: new RegExp(`^${baseRegex}/get/(?<id>[^/]+)$`),
      type: "dsl-resource", module: routeMeta.module, controller: routeMeta.resource,
      action: "get", resource: name, handler: getHandler,
    });
    table.patterns.push({
      match: new RegExp(`^${baseRegex}/update/(?<id>[^/]+)$`),
      type: "dsl-resource", module: routeMeta.module, controller: routeMeta.resource,
      action: "update", resource: name, handler: updateHandler,
    });
    table.patterns.push({
      match: new RegExp(`^${baseRegex}/delete/(?<id>[^/]+)$`),
      type: "dsl-resource", module: routeMeta.module, controller: routeMeta.resource,
      action: "delete", resource: name, handler: deleteHandler,
    });
  }
}

function bindServiceMethod(ctx: ThinkContext, services: Record<string, unknown>, handler: string): unknown {
  const [source, ...rest] = handler.split(".");
  const service = services[source];
  if (!service || typeof service !== "object") return undefined;
  const fn = (service as Record<string, unknown>)[rest.join(".")] ?? (service as Record<string, unknown>)[rest[0] ?? ""];
  if (typeof fn !== "function") return undefined;
  return fn(ctx, ctx.body);
}

function dslApiPathToRegex(path: string): RegExp {
  const pattern = path.replace(/:([^/]+)/g, "(?<$1>[^/]+)").replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`);
}

export function registerDslApiRoutes(
  table: RouteTable, dslData: DslAppData, services: Record<string, unknown>,
): void {
  for (const entry of Object.values(dslData.apis)) {
    for (const route of entry.routes) {
      const segments = entry.name.split("_");
      const base = segments.map((p) => p.replace(/_/g, "-")).join("/");
      const fullPath = `/api/${base}${route.path.startsWith("/") ? route.path : `/${route.path}`}`;
      const handler = async (ctx: ThinkContext) => {
        if (ctx.request.method !== route.method.toUpperCase()) {
          ctx.set.status = 405;
          return { errno: 405, errmsg: "Method not allowed" };
        }
        if (route.handler.startsWith("service.")) {
          const method = route.handler.slice("service.".length);
          const svc = dslData.services[entry.name]?.hooks;
          const fn = svc?.[method] as ((opts: Record<string, unknown>, think: unknown) => unknown) | undefined;
          if (!fn) { ctx.set.status = 404; return { errno: 404, errmsg: `Service method ${method} not found` }; }
          const opts: Record<string, unknown> = { ...(ctx.params ?? {}), ...(ctx.body as Record<string, unknown> ?? {}) };
          const serviceContext = bindServiceContext(new BaseService(), ctx, {
            servicePath: entry.path, serviceModelName: entry.name,
          });
          const result = await fn.call(serviceContext, opts, ctx.think);
          return result && typeof result === "object" && "errno" in result ? result : { errno: 0, data: result };
        }
        return bindServiceMethod(ctx, services, route.handler);
      };
      const routeMeta = parseModelRoute(entry.name);
      if (route.path.includes(":") || route.path.includes("*")) {
        table.patterns.push({
          match: dslApiPathToRegex(fullPath), type: "dsl-api",
          module: routeMeta.module, controller: routeMeta.resource,
          action: route.method.toLowerCase(), resource: entry.name, handler,
        });
      } else {
        table.exact.set(fullPath, {
          match: fullPath, type: "dsl-api",
          module: routeMeta.module, controller: routeMeta.resource,
          action: route.method.toLowerCase(), resource: entry.name, handler,
        });
      }
    }
  }
}

export function registerDslAdminRoutes(table: RouteTable, dslData: DslAppData): void {
  const admin = createAdminHandlers(dslData);
  table.exact.set("/admin/api/tables", {
    match: "/admin/api/tables", type: "dsl-admin",
    module: "admin", controller: "api/tables", action: "list",
    handler: async () => admin.tablesAction(),
  });
}

export function hasDslModels(dslData?: DslAppData): boolean {
  return !!dslData && Object.keys(dslData.models).length > 0;
}
