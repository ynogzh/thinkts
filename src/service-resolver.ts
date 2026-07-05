import type { ThinkGlobal } from "./think";
import type { DslServiceEntry } from "./dsl-model/types";
import { toPascalCase } from "./utils";
import { BaseService, bindServiceContext } from "./service";
import { createBackgroundThinkContext } from "./think-context";

function isPlainServiceFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function" && !(value.prototype && value.prototype.constructor === value);
}

/**
 * ServiceResolver — resolves `think.service(name, opts)` calls through
 * a dispatch chain: DSL hooks → class-based → key lookup.
 */
export class ServiceResolver {
  constructor(private think: ThinkGlobal) {}

  resolve(name: string, opts?: Record<string, unknown>, ...args: unknown[]): unknown {
    const services = this.think.services as Record<string, unknown>;
    const dslServices = this.think.dslServices as Record<string, DslServiceEntry>;
    const serviceCtx = createBackgroundThinkContext(this.think);

    const parts = name.split(".");
    if (parts.length >= 2) {
      const result = this.tryDsl(dslServices, parts, opts, serviceCtx)
        ?? this.tryClass(services, parts, opts, serviceCtx);
      if (result !== undefined) return result;
    }

    return this.tryLookup(services, name, opts ?? {}, args, serviceCtx);
  }

  /** DSL service hooks: `model_name.method` mapped through dslServices registry. */
  private tryDsl(
    dsl: Record<string, DslServiceEntry>,
    parts: string[],
    opts: Record<string, unknown> | undefined,
    ctx: ReturnType<typeof createBackgroundThinkContext>,
  ): unknown | undefined {
    const copied = [...parts];
    const method = copied.pop()!;
    const modelName = copied.join("_");
    const entry = dsl[modelName];
    if (!entry) return undefined;
    const hooks = (entry.hooks ?? {}) as Record<string, unknown>;
    const fn = hooks[method] ?? (entry as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") return undefined;
    const serviceContext = bindServiceContext(new BaseService(), ctx, {
      servicePath: copied.join("/"),
      serviceModelName: modelName,
    });
    return (fn as (opts?: Record<string, unknown>, think?: ThinkGlobal) => unknown).call(
      serviceContext, opts ?? {}, this.think,
    );
  }

  /** Class-based services: `module.service.method` with nested service registry. */
  private tryClass(
    services: Record<string, unknown>,
    parts: string[],
    opts: Record<string, unknown> | undefined,
    ctx: ReturnType<typeof createBackgroundThinkContext>,
  ): unknown | undefined {
    const copied = [...parts];
    const method = copied.pop()!;
    const serviceName = toPascalCase(copied.pop()!);
    const modulePath = copied.join("/") || "";
    const modServices: Record<string, unknown> = modulePath
      ? ((services[modulePath] as Record<string, unknown>) ?? {})
      : services;
    const ServiceClass = modServices[serviceName] ?? modServices[serviceName + "Service"];
    if (!ServiceClass || typeof ServiceClass !== "function") return undefined;
    const instance = bindServiceContext(
      new (ServiceClass as new () => Record<string, unknown>)(),
      ctx, { servicePath: [...copied, method].join("/") },
    );
    if (typeof instance[method] === "function") {
      return (instance[method] as (opts?: Record<string, unknown>) => unknown)(opts ?? {});
    }
    return undefined;
  }

  /** Key-based lookup with normalization: exact → PascalCase → path-key. */
  private tryLookup(
    services: Record<string, unknown>,
    name: string,
    opts: Record<string, unknown>,
    args: unknown[],
    ctx: ReturnType<typeof createBackgroundThinkContext>,
  ): unknown | undefined {
    // 1. Exact key match
    const exact = this.resolveEntry(services, name, opts, args, ctx);
    if (exact !== undefined) return exact;

    // 2. PascalCase match
    const pascal = this.resolveEntry(services, toPascalCase(name), opts, args, ctx);
    if (pascal !== undefined) return pascal;

    // 3. Path-key match (underscore → slash conversion)
    const pathKey = name.replace(/_/g, "/");
    if (pathKey !== name) {
      const pathResult = this.resolveEntry(services, pathKey, opts, args, ctx);
      if (pathResult !== undefined) return pathResult;
    }

    return undefined;
  }

  private resolveEntry(
    services: Record<string, unknown>,
    key: string,
    opts: Record<string, unknown>,
    args: unknown[],
    ctx: ReturnType<typeof createBackgroundThinkContext>,
  ): unknown | undefined {
    const entry = services[key];
    if (!entry) return undefined;

    // Plain function service
    if (isPlainServiceFunction(entry)) {
      return entry(opts, this.think, ...args);
    }

    // Class-based service
    if (typeof entry === "function") {
      return bindServiceContext(
        new (entry as new (...a: unknown[]) => unknown)(...args),
        ctx, { servicePath: key },
      );
    }

    return undefined;
  }
}
