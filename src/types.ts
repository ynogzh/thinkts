import type { Logger } from "./logger";
import type { ThinkGlobal } from "./think";

export interface ThinkServer {
  requestIP(request: Request): { address: string; family: string; port: number } | null;
  stop(): void;
}
export interface ThinkContext {
  request: Request;
  server: ThinkServer;
  set: { status: number; headers: Record<string, string | string[]> };
  body: unknown;
  cookie: Record<string, string>;
  session?: Record<string, unknown>;
  jwt?: Record<string, unknown>;
  user?: Record<string, unknown>;
  /** Uploaded files populated by ControllerBase.upload(). */
  uploadFiles?: Record<string, unknown>;
  /** Current tenant id extracted from request context. */
  tenantId?: string | number;
  /** Current tenant entity if resolved. */
  tenant?: Record<string, unknown>;
  think: ThinkGlobal;
  traceId: string;
  module?: string;
  controller?: string;
  action?: string;
  params?: Record<string, string>;
  url: URL;
  meta: {
    startTime: number;
    timing: Record<string, number>;
    tags: Record<string, string>;
  };
}
export interface RouteInfo {
}

export interface ControllerClass {
  new (ctx: ThinkContext): BaseController;
}

export interface LogicClass {
  new (ctx: ThinkContext): BaseLogic;
}

export interface ServiceClass {
  new (): BaseService;
}

export interface ModelClass {
  new (): BaseModel;
}

export interface ConfigValue {
  [key: string]: unknown;
}

export interface MiddlewareConfig {
  handle: string;
  enable?: boolean;
  options?: Record<string, unknown>;
}
export interface Middleware {
  onRequest?(ctx: ThinkContext): Promise<Response | void> | Response | void;
  onError?(ctx: ThinkContext, error: Error): Promise<Response | void> | Response | void;
  onResponse?(ctx: ThinkContext): Promise<void> | void;
}

export interface RouterRule {
  match: RegExp | string;
  target: string;
  type?: string;
}

export interface AppConfig {
  port?: number;
  host?: string;
  workers?: number;
  defaultModule?: string;
  defaultController?: string;
  defaultAction?: string;
  prefix?: string[];
  suffix?: string[];
  jsonpCallbackField?: string;
  jsonContentType?: string;
  jsonpContentType?: string;
  errnoField?: string;
  errmsgField?: string;
  defaultErrno?: number;
  staticDir?: string;
  staticPrefix?: RegExp | string;
  logger?: Record<string, unknown>;
  [key: string]: unknown;
}

// Forward declarations for circular types
export declare class BaseController {
  ctx: ThinkContext;
  constructor(ctx: ThinkContext);
}

export declare class BaseLogic {
  ctx: ThinkContext;
  constructor(ctx: ThinkContext);
}

export declare class BaseService {}

export declare class BaseModel {}
