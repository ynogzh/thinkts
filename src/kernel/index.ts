import type { KernelContext, BeforeActionHook, AfterActionHook, RequestHook, ErrorHook, HookEntry, ThinkStrategies } from "./types";
import { resolveTenantContext } from "./utils";

function composeRequestHooks(
  hooks: RequestHook[]
): (ctx: KernelContext) => Promise<Response | undefined> {
  return async (ctx) => {
    for (const hook of hooks) {
      const response = await hook(ctx);
      if (response) return response;
    }
    return undefined;
  };
}

function composeActionHooks(hooks: BeforeActionHook[]): (ctx: KernelContext) => Promise<void> {
  return async (ctx) => {
    for (const hook of hooks) {
      await hook(ctx);
    }
  };
}

function composeErrorHooks(
  hooks: ErrorHook[]
): (ctx: KernelContext) => Promise<Response | undefined> {
  return async (ctx) => {
    for (const hook of hooks) {
      const response = await hook(ctx);
      if (response) return response;
    }
    return undefined;
  };
}

/**
 * Minimal request kernel.
 *
 * The kernel processes a single request through a fixed pipeline:
 *   request hooks → router → validator → authorizer → before-action hooks
 *   → executor → after-action hooks → responder.
 *
 * Each stage is backed by a Strategy interface so applications can override
 * any part of the pipeline without touching the kernel itself.
 */
export class ThinkKernel {
  strategies: ThinkStrategies;

  private beforeActionHooks: HookEntry<BeforeActionHook>[] = [];
  private afterActionHooks: HookEntry<AfterActionHook>[] = [];
  private requestHooks: HookEntry<RequestHook>[] = [];
  private errorHooks: HookEntry<ErrorHook>[] = [];

  private compiledRequest?: (ctx: KernelContext) => Promise<Response | undefined>;
  private compiledBeforeAction?: (ctx: KernelContext) => Promise<void>;
  private compiledAfterAction?: (ctx: KernelContext) => Promise<void>;
  private compiledError?: (ctx: KernelContext) => Promise<Response | undefined>;
  private dirty = true;

  constructor(strategies: ThinkStrategies) {
    this.strategies = strategies;
  }

  beforeAction(hook: BeforeActionHook, priority = 0, source?: string): void {
    this.beforeActionHooks.push({ hook, priority, source });
    this.dirty = true;
  }

  afterAction(hook: AfterActionHook, priority = 0, source?: string): void {
    this.afterActionHooks.push({ hook, priority, source });
    this.dirty = true;
  }

  onRequest(hook: RequestHook, priority = 0, source?: string): void {
    this.requestHooks.push({ hook, priority, source });
    this.dirty = true;
  }

  onError(hook: ErrorHook, priority = 0, source?: string): void {
    this.errorHooks.push({ hook, priority, source });
    this.dirty = true;
  }

  /**
   * Compile all registered hooks into flat call chains.
   */
  compile(): void {
    this.sortHooks();
    this.compiledRequest = composeRequestHooks(this.requestHooks.map((e) => e.hook));
    this.compiledBeforeAction = composeActionHooks(this.beforeActionHooks.map((e) => e.hook));
    this.compiledAfterAction = composeActionHooks(this.afterActionHooks.map((e) => e.hook));
    this.compiledError = composeErrorHooks(this.errorHooks.map((e) => e.hook));
    this.dirty = false;
  }

  /**
   * Execute the full request lifecycle and return a Response.
   */
  async execute(ctx: KernelContext): Promise<Response> {
    if (this.dirty) this.compile();
    ctx.think._dataScopeCache = new Map();
    await resolveTenantContext(ctx);

    try {
      const requestResponse = await this.compiledRequest!(ctx);
      if (requestResponse) {
        ctx.response = requestResponse;
        return requestResponse;
      }

      const match = await this.strategies.router.match(ctx);
      if (!match) {
        ctx.set.status = 404;
        return this.strategies.responder.notFound(ctx);
      }
      ctx.route = match;
      if (match.entry.module) ctx.module = match.entry.module;
      if (match.entry.controller) ctx.controller = match.entry.controller;
      if (match.entry.action) ctx.action = match.entry.action;
      if (match.params) {
        ctx.params = { ...ctx.params, ...match.params };
      }

      const validation = await this.strategies.validator.validate(ctx);
      if (!validation.success) {
        return this.strategies.responder.validationError(ctx, validation);
      }
      if (validation.data && typeof validation.data === "object" && !Array.isArray(validation.data)) {
        ctx.opts = validation.data as Record<string, unknown>;
      }

      const authorized = await this.strategies.authorizer.authorize(ctx);
      if (!authorized) {
        return this.strategies.responder.forbidden(ctx);
      }

      await this.compiledBeforeAction!(ctx);

      ctx.result = await this.strategies.executor.execute(ctx);

      await this.compiledAfterAction!(ctx);

      return this.strategies.responder.success(ctx);
    } catch (err) {
      ctx.error = err instanceof Error ? err : new Error(String(err));
      const errorResponse = await this.compiledError!(ctx);
      if (errorResponse) {
        ctx.response = errorResponse;
        return errorResponse;
      }
      return this.strategies.responder.error(ctx, ctx.error);
    }
  }

  private sortHooks(): void {
    this.beforeActionHooks.sort((a, b) => a.priority - b.priority);
    this.afterActionHooks.sort((a, b) => a.priority - b.priority);
    this.requestHooks.sort((a, b) => a.priority - b.priority);
    this.errorHooks.sort((a, b) => a.priority - b.priority);
  }
}

// Re-exports for backwards compatibility
export { DefaultRouterStrategy, DefaultValidatorStrategy, DefaultAuthorizerStrategy, DefaultActionExecutorStrategy, DefaultResponderStrategy, DefaultErrorFormatterStrategy } from "./strategies";
export { toResponse } from "./response";
export { extractTenantId, resolveTenantContext, buildRequestOpts } from "./utils";
export type { KernelContext, RouterStrategy, ValidatorStrategy, AuthorizerStrategy, ActionExecutorStrategy, ResponderStrategy, ErrorFormatterStrategy, ThinkStrategies, BeforeActionHook, AfterActionHook, RequestHook, ErrorHook } from "./types";
