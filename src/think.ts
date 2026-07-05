import type { AppConfig, ThinkContext } from "./types";
import { toPascalCase } from "./utils";
import { getConfig } from "./config";
import { Logger } from "./logger";
import { BaseController } from "./controller";
import { BaseLogic } from "./logic";
import { BaseService } from "./service";
import { Model } from "./model";
import { thinkFetch } from "./fetch";
import type { FetchOptions, FetchResponse } from "./fetch";
import { createSessionStore, generateSid } from "./session";
import type { SessionConfig } from "./session";
import type { DataResourceMeta, DslServiceEntry } from "./dsl-model/types";
import type { ThinkKernel, KernelContext } from "./kernel";
import { ServiceResolver } from "./service-resolver";

export interface ThinkGlobal {
  env: string;
  ROOT_PATH: string;
  APP_PATH: string;
  config: <T = unknown>(name: string, defaultValue?: T) => T;
  envVar: (key: string, defaultValue?: string) => string | undefined;
  envInt: (key: string, defaultValue?: number) => number | undefined;
  envBool: (key: string, defaultValue?: boolean) => boolean | undefined;
  logger: Logger;
  Controller: typeof BaseController;
  Logic: typeof BaseLogic;
  Service: typeof BaseService;
  Model: typeof Model;
  fetch: (url: string, options?: Record<string, unknown>) => Promise<FetchResponse<unknown>>;
  session: (name: string, value?: unknown, config?: Record<string, unknown>) => Promise<unknown>;
  service: (name: string, opts?: Record<string, unknown>, ...args: unknown[]) => unknown;
  controller: (name: string) => BaseController;
  model: (name: string, config?: Record<string, unknown>) => Model;
  transModel: (name: string, config?: Record<string, unknown>) => Model;
  serviceModel: (name: string, config?: Record<string, unknown>) => Model;
  beforeStartServer: (fn?: () => Promise<unknown>) => Promise<unknown>;
  kernel?: ThinkKernel;
  beforeAction: (hook: (ctx: KernelContext) => Promise<void>, priority?: number, source?: string) => void;
  afterAction: (hook: (ctx: KernelContext) => Promise<void>, priority?: number, source?: string) => void;
  onRequest: (hook: (ctx: KernelContext) => Promise<Response | undefined>, priority?: number, source?: string) => void;
  onError: (hook: (ctx: KernelContext) => Promise<Response | undefined>, priority?: number, source?: string) => void;
  dslServices: Record<string, DslServiceEntry>;
  models: Record<string, unknown>;
  _dataScopeCache?: Map<string, { scopeType: string; ownerField?: string; deptField?: string; agentField?: string; scopeValue?: Record<string, unknown> }>;
  dataResources: Record<string, DataResourceMeta & { modelName: string }>;
  [key: string]: unknown;
}

const beforeStartPromises: Promise<unknown>[] = [];

export function createThink(rootPath: string, appConfig: AppConfig): ThinkGlobal {
  const think: ThinkGlobal = {
    env: process.env.NODE_ENV ?? "development",
    ROOT_PATH: rootPath,
    APP_PATH: `${rootPath}/src`,
    config: <T = unknown>(name: string, defaultValue?: T): T => getConfig(name, defaultValue, appConfig),
    envVar: (key: string, defaultValue?: string) => process.env[key] ?? defaultValue,
    envInt: (key: string, defaultValue?: number) => {
      const val = process.env[key];
      if (val === undefined) return defaultValue;
      const n = parseInt(val, 10);
      return Number.isNaN(n) ? defaultValue : n;
    },
    envBool: (key: string, defaultValue?: boolean) => {
      const val = process.env[key];
      if (val === undefined) return defaultValue;
      return val === "true" || val === "1" || val === "yes";
    },
    logger: new Logger(appConfig.logger as Record<string, unknown> ?? {}),
    Controller: BaseController,
    Logic: BaseLogic,
    Service: BaseService,
    Model: Model,
    fetch: (url: string, options?: Record<string, unknown>) => thinkFetch(url, options as FetchOptions),
    session: async (name: string, value?: unknown, config?: Record<string, unknown>) => {
      const cfg = config ?? think.config("session", {}) as Record<string, unknown>;
      const store = createSessionStore(cfg as SessionConfig);
      const sid = generateSid();
      const data: Record<string, unknown> = { [name]: value };
      await store.set(sid, data, (cfg.maxAge as number) ?? 86400);
      return sid;
    },
    service: (name: string, opts?: Record<string, unknown>, ...args: unknown[]) => {
      const resolver = new ServiceResolver(think);
      return resolver.resolve(name, opts, ...args);
    },
    controller: (name: string) => {
      const controllers = think.controllers as Record<string, unknown>;
      const ControllerClass = controllers[name];
      if (ControllerClass && typeof ControllerClass === "function") {
        return new (ControllerClass as new (ctx: ThinkContext) => BaseController)({} as ThinkContext);
      }
      const pathKey = name.replace(/_/g, "/");
      const pathControllers = (controllers[pathKey] as Record<string, unknown>) ?? {};
      const PathClass = pathControllers[name];
      if (PathClass && typeof PathClass === "function") {
        return new (PathClass as new (ctx: ThinkContext) => BaseController)({} as ThinkContext);
      }
      throw new Error(`can not find controller: ${name}`);
    },
    model: (name: string, config?: Record<string, unknown>) => {
      const models = think.models;
      let ModelClass = models[name] as new (name: string, config: Record<string, unknown>) => Model;
      if (!ModelClass) {
        const pathKey = name.replace(/_/g, "/");
        const pathModels = models[pathKey];
        if (typeof pathModels === "function") {
          ModelClass = pathModels as typeof ModelClass;
        } else if (pathModels && typeof pathModels === "object") {
          ModelClass = (pathModels as Record<string, unknown>)[toPascalCase(name)] as typeof ModelClass
            ?? (pathModels as Record<string, unknown>)[name] as typeof ModelClass;
        }
      }
      const modelConfig = think.config("model", {}) as Record<string, unknown>;
      const instance = ModelClass
        ? new ModelClass(name, { ...modelConfig, ...config })
        : new Model(name, { ...modelConfig, ...config });
      instance.models = models as Record<string, typeof Model>;

      // Bind ACL from explicit context (caller must pass _aclCtx in config)
      const aclCtx = (config as { _aclCtx?: ThinkContext } | undefined)?._aclCtx;
      if (aclCtx) {
        const role = (aclCtx.user?.role as string | undefined) ?? "guest";
        instance.acl(role, aclCtx);
      }
      return instance;
    },
    transModel: (name: string, config?: Record<string, unknown>) => {
      return think.model(name, { ...config, reuseDB: true });
    },
    serviceModel: (name: string, config?: Record<string, unknown>) => {
      return think.model(name, config);
    },
    beforeStartServer: (fn?: () => Promise<unknown>) => {
      if (fn) beforeStartPromises.push(fn());
      return Promise.all(beforeStartPromises).then(() => undefined);
    },
    beforeAction: () => {},
    afterAction: () => {},
    onRequest: () => {},
    onError: () => {},
    dataResources: {},
    controllers: {},
    logics: {},
    services: {},
    dslServices: {},
    models: {},
  };

  return think;
}
