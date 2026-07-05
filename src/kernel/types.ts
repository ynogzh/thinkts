import type { ThinkContext } from "../types";
import type { ValidationResult } from "../validate";
import type { RouteMatch } from "../router/table";

/**
 * Extended context used during kernel execution.
 *
 * The kernel owns the request lifecycle, so it may attach transient
 * state such as the matched route, the handler result, or an error.
 */
export interface KernelContext extends ThinkContext {
  route?: RouteMatch;
  result?: unknown;
  error?: Error;
  response?: Response;
  opts?: Record<string, unknown>;
}

export interface RouterStrategy {
  match(ctx: KernelContext): Promise<RouteMatch | undefined>;
}

export interface ValidatorStrategy {
  validate(ctx: KernelContext): Promise<ValidationResult<unknown>>;
}

export interface AuthorizerStrategy {
  authorize(ctx: KernelContext): Promise<boolean>;
}

export interface ActionExecutorStrategy {
  execute(ctx: KernelContext): Promise<unknown>;
}

export interface ResponderStrategy {
  success(ctx: KernelContext): Response;
  notFound(ctx: KernelContext): Response;
  validationError(ctx: KernelContext, result: ValidationResult<unknown>): Response;
  forbidden(ctx: KernelContext): Response;
  error(ctx: KernelContext, error: Error): Response;
}

export interface ErrorFormatterStrategy {
  format(ctx: KernelContext, error: Error): { errno: number; errmsg: string; data?: unknown };
}

export interface ThinkStrategies {
  router: RouterStrategy;
  validator: ValidatorStrategy;
  authorizer: AuthorizerStrategy;
  executor: ActionExecutorStrategy;
  responder: ResponderStrategy;
  errorFormatter: ErrorFormatterStrategy;
}

export type BeforeActionHook = (ctx: KernelContext) => Promise<void>;
export type AfterActionHook = (ctx: KernelContext) => Promise<void>;
export type RequestHook = (ctx: KernelContext) => Promise<Response | undefined>;
export type ErrorHook = (ctx: KernelContext) => Promise<Response | undefined>;

export interface HookEntry<T> {
  hook: T;
  priority: number;
  source?: string;
}
