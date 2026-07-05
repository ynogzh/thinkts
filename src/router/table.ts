import type { ThinkContext, AppConfig, RouterRule } from "../types";
import type { DslAppData } from "../dsl-model/types";
import { toKebabCase, toPascalCase } from "../utils";
import { createHandler, normalizePath, type ParsedRoute, type RouteEntry } from "./handler";
import { createResourceHandler } from "./resource";
import { registerDslModelRoutes, registerDslApiRoutes, registerDslAdminRoutes } from "./dsl";
export interface RouteTable {
  exact: Map<string, RouteEntry>;
  patterns: RouteEntry[];
}

export function parseRouterRules(rules: unknown[]): RouterRule[] {
  return rules.map((rule) => {
    if (typeof rule === "string") {
      const parts = rule.split(/\s+/);
      if (parts[0] === "redirect") {
        return { type: "redirect", match: parts[1] ?? "/", target: parts[2] ?? "/" };
      }
      return { type: "custom", match: parts[0] ?? "/", target: parts[1] ?? "/" };
    }
    const r = rule as Record<string, unknown>;
    return {
      type: (r.type as string) || "custom",
      match: (r.match as string) || "/",
      target: (r.target as string) || "/",
    };
  });
}

export function buildRouteTable(
  config: AppConfig,
  controllers: Record<string, unknown>,
  services: Record<string, unknown>,
  logics: Record<string, unknown>,
  customRules?: RouterRule[],
  dslData?: DslAppData
): RouteTable {
  const table: RouteTable = { exact: new Map(), patterns: [] };
  const defaultAction = config.defaultAction ?? "index";

  if (dslData) {
    registerDslModelRoutes(table, dslData);
    registerDslApiRoutes(table, dslData, services);
    registerDslAdminRoutes(table, dslData);
  }
  // Register custom routes first
  if (customRules) {
    for (const rule of customRules) {
      if (rule.type === "redirect") {
        table.patterns.push({
          match: rule.match,
          type: "redirect",
          handler: async (ctx: ThinkContext): Promise<Response> => {
            ctx.set.status = 302;
            return new Response(null, { status: 302, headers: { Location: rule.target } });
          },
        });
        continue;
      }
      if (rule.type === "resource") {
        const handler = createResourceHandler(rule.target, controllers, services, logics);
        const entry: RouteEntry = { match: rule.match, type: "resource", resource: rule.target, handler };
        if (typeof rule.match === "string" && !rule.match.includes("*")) {
          table.exact.set(rule.match, entry);
        } else {
          table.patterns.push(entry);
        }
        continue;
      }

      const parts = rule.target.split("/").filter(Boolean);
      let parsed: ParsedRoute;
      if (parts.length === 1) {
        parsed = { module: "home", controller: parts[0], action: defaultAction, extra: [] };
      } else if (parts.length === 2) {
        parsed = { module: "home", controller: parts[0], action: parts[1], extra: [] };
      } else {
        parsed = { module: parts[0], controller: parts[1], action: parts[2], extra: parts.slice(3) };
      }

      const entry: RouteEntry = {
        match: rule.match,
        type: "custom",
        module: parsed.module,
        controller: parsed.controller,
        action: parsed.action,
        handler: createHandler(parsed, controllers, services, logics),
      };

      if (typeof rule.match === "string" && !rule.match.includes("*")) {
        table.exact.set(rule.match, entry);
      } else {
        table.patterns.push(entry);
      }
    }
  }

  // Register Service routes first
  for (const [servicePascal, ServiceClass] of Object.entries(services)) {
    if (typeof ServiceClass !== "function") continue;
    const hasSlash = servicePascal.includes("/");
    const servicePath = hasSlash ? servicePascal : toKebabCase(servicePascal).replace(/-service$/, "");
    const proto = (ServiceClass as new () => Record<string, unknown>).prototype;
    if (!proto) continue;
    const actionNames = new Set<string>();
    let cur: unknown = proto;
    while (cur && cur !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(cur as Record<string, unknown>)) {
        if (key === "constructor") continue;
        if (key.startsWith("_")) continue;
        if (["__before", "__after", "__call"].includes(key)) continue;
        actionNames.add(key);
      }
      cur = Object.getPrototypeOf(cur);
    }
    actionNames.add(defaultAction);
    for (const action of actionNames) {
      const parsed = { module: "home", controller: hasSlash ? servicePascal : servicePath, action, extra: [] };
      const path = `/${servicePath}/${action}`;
      const serviceBindings = {
        [parsed.controller]: ServiceClass,
        [toKebabCase(servicePascal).replace(/-service$/, "")]: ServiceClass,
        [toPascalCase(parsed.controller)]: ServiceClass,
        [servicePascal]: ServiceClass,
      };
      const handler = createHandler(parsed, {}, serviceBindings, {});
      const entry: RouteEntry = {
        match: path,
        module: parsed.module,
        controller: parsed.controller,
        action: parsed.action,
        handler,
      };
      table.exact.set(path, entry);
      if (action === defaultAction) {
        table.exact.set(`/${servicePath}`, { ...entry, match: `/${servicePath}` });
      }
      table.patterns.push({ ...entry, match: path + "/*" });
    }
  }
  // Register Controller routes (overrides Service)
  for (const [controllerPascal, ControllerClass] of Object.entries(controllers)) {
    if (typeof ControllerClass !== "function") continue;
    const hasSlash = controllerPascal.includes("/");
    const controllerPath = hasSlash ? controllerPascal : toKebabCase(controllerPascal).replace(/-controller$/, "");
    const proto = (ControllerClass as new () => Record<string, unknown>).prototype;
    if (!proto) continue;
    const actionNames = new Set<string>();
    let cur: unknown = proto;
    while (cur && cur !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(cur as Record<string, unknown>)) {
        if (key.endsWith("Action")) actionNames.add(key.slice(0, -6));
      }
      cur = Object.getPrototypeOf(cur);
    }
    actionNames.add(defaultAction);
    for (const action of actionNames) {
      const parsed = { module: "home", controller: hasSlash ? controllerPascal : controllerPath, action, extra: [] };
      const path = `/${controllerPath}/${action}`;
      const entry: RouteEntry = {
        match: path,
        module: parsed.module,
        controller: parsed.controller,
        action: parsed.action,
        handler: createHandler(parsed, controllers, services, logics),
      };
      table.exact.set(path, entry);
      if (action === defaultAction) {
        table.exact.set(`/${controllerPath}`, { ...entry, match: `/${controllerPath}` });
      }
      table.patterns.push({ ...entry, match: path + "/*" });
    }
  }

  const homeHandler = createHandler(
    { module: "home", controller: "index", action: defaultAction, extra: [] },
    controllers, services, logics
  );

  // Default home route
  const homeEntry: RouteEntry = {
    match: "/",
    module: "home",
    controller: "index",
    action: defaultAction,
    handler: homeHandler,
  };
  table.exact.set("/", homeEntry);
  return table;
}

export interface RouteMatch {
  entry: RouteEntry;
  params?: Record<string, string>;
}
export function matchRoute(table: RouteTable, pathname: string): RouteMatch | undefined {
  const normalized = normalizePath(pathname);
  const exact = table.exact.get(normalized);
  if (exact) return { entry: exact };
  for (const entry of table.patterns) {
    if (typeof entry.match === "string") {
      if (entry.match.endsWith("*")) {
        const prefix = entry.match.slice(0, -1);
        if (normalized.startsWith(prefix)) {
          const rest = normalized.slice(prefix.length).replace(/^\//, "");
          const params = rest ? Object.fromEntries(rest.split("/").map((v, i) => [String(i), v])) : undefined;
          return { entry, params };
        }
      }
      if (entry.match === normalized) return { entry };
    } else if (entry.match instanceof RegExp) {
      const m = entry.match.exec(normalized);
      if (m) {
        const params: Record<string, string> = {};
        if (m.groups) Object.assign(params, m.groups);
        // named groups from regex
        for (let i = 1; i < m.length; i++) {
          if (m[i] !== undefined) params[String(i - 1)] = m[i];
        }
        return { entry, params: Object.keys(params).length > 0 ? params : undefined };
      }
    }
  }
  return undefined;
}

export interface CustomRoute {
  match: RegExp | string;
  target: string;
  type?: string;
  handler: (ctx: ThinkContext) => Promise<unknown>;
}

export function registerCustomRoutes(
  rules: RouterRule[],
  config: AppConfig,
  controllers: Record<string, unknown>,
  services: Record<string, unknown>,
  logics: Record<string, unknown>
): CustomRoute[] {
  const routes: CustomRoute[] = [];
  const defaultAction = config.defaultAction ?? "index";
  for (const rule of rules) {
    if (rule.type === "redirect") {
      routes.push({
        match: rule.match,
        target: rule.target,
        type: rule.type,
        handler: async (ctx: ThinkContext): Promise<Response> => {
          ctx.set.status = 302;
          return new Response(null, { status: 302, headers: { Location: rule.target } });
        },
      });
      continue;
    }
    if (rule.type === "resource") {
      routes.push({
        match: rule.match,
        target: rule.target,
        type: rule.type,
        handler: createResourceHandler(rule.target, controllers, services, logics),
      });
      continue;
    }
    const parts = rule.target.split("/").filter(Boolean);
    let parsed: ParsedRoute;
    if (parts.length === 1) {
      parsed = { module: "home", controller: parts[0], action: defaultAction, extra: [] };
    } else if (parts.length === 2) {
      parsed = { module: "home", controller: parts[0], action: parts[1], extra: [] };
    } else {
      parsed = { module: parts[0], controller: parts[1], action: parts[2], extra: parts.slice(3) };
    }
    routes.push({
      match: rule.match,
      target: rule.target,
      type: rule.type,
      handler: createHandler(parsed, controllers, services, logics),
    });
  }
  return routes;
}
