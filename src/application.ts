import "reflect-metadata";
import type { ThinkContext, AppConfig, Middleware, ThinkServer } from "./types";
import type { ThinkGlobal } from "./think";
import type { RouteTable } from "./router";
import type { Model } from "./model";
import { Logger } from "./logger";
import { loadConfig, watchConfig, getConfig } from "./config";
import { loadAppData, loadRouterConfig, loadBootstrap, type LoadedData } from "./loader";
import { parseRouterRules, buildRouteTable } from "./router";
import { createThink } from "./think";
import { generateTraceId } from "./error";
import { toError, parseCookies, parseBody } from "./app/context";
import { loadMiddlewares } from "./app/middleware-loader";
import { checkHealth } from "./app/health";
import { setupCronJobs } from "./app/cron";
import { buildAclConfig } from "./dsl-model/helpers";
import {
  ThinkKernel, DefaultRouterStrategy, DefaultValidatorStrategy, DefaultAuthorizerStrategy,
  DefaultActionExecutorStrategy, DefaultResponderStrategy, DefaultErrorFormatterStrategy,
  toResponse, type KernelContext,
} from "./kernel";

export interface ApplicationOptions {
  ROOT_PATH: string;
  env?: string;
  port?: number;
  host?: string;
  websocket?: Record<string, unknown>;
  compression?: boolean;
  maxBodySize?: number;
}

export class Application {
  private options: ApplicationOptions;
  private config: AppConfig;
  private think!: ThinkGlobal;
  private middlewares: Middleware[] = [];
  private middlewareReadies: Promise<void>[] = [];
  private routeTable!: RouteTable;
  private server: ThinkServer | undefined;
  private logger: Logger;
  private unwatchConfig?: () => void;
  private kernel!: ThinkKernel;

  constructor(options: ApplicationOptions) {
    this.options = options;
    this.logger = new Logger();
    this.config = loadConfig(options.ROOT_PATH, options.env);
  }

  private async buildContext(request: Request, server: ThinkServer): Promise<KernelContext> {
    const body = await parseBody(request, this.options.maxBodySize ?? 10 * 1024 * 1024);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const traceId = request.headers.get("x-trace-id") ?? generateTraceId();
    return {
      request, server, traceId, body,
      set: { status: 200, headers: {} },
      cookie: parseCookies(cookieHeader),
      think: this.think,
      url: new URL(request.url),
      meta: { startTime: performance.now(), timing: {}, tags: {} },
    };
  }
  private buildKernel(): void {
    this.kernel = new ThinkKernel({
      router: new DefaultRouterStrategy(this.routeTable),
      validator: new DefaultValidatorStrategy(),
      authorizer: new DefaultAuthorizerStrategy(),
      executor: new DefaultActionExecutorStrategy(),
      responder: new DefaultResponderStrategy(),
      errorFormatter: new DefaultErrorFormatterStrategy(this.options.env),
    });

    this.think.kernel = this.kernel;
    this.think.beforeAction = (hook, p?, s?) => this.kernel.beforeAction(hook as never, p, s);
    this.think.afterAction = (hook, p?, s?) => this.kernel.afterAction(hook as never, p, s);
    this.think.onRequest = (hook, p?, s?) => this.kernel.onRequest(hook as never, p, s);
    this.think.onError = (hook, p?, s?) => this.kernel.onError(hook as never, p, s);

    this.kernel.onRequest(async (ctx) => {
      const result = await this.runMiddlewares(ctx);
      if (result instanceof Response) return result;
      return undefined;
    }, 0);

    this.kernel.onRequest(async (ctx) => {
      const pathname = ctx.url.pathname;
      if (pathname === "/health" || pathname === "/healthz") {
        return toResponse(ctx, await checkHealth(this.think));
      }
      return undefined;
    }, 100);

    this.kernel.onError(async (ctx) => {
      const result = await this.composedError?.(ctx, ctx.error!);
      if (result instanceof Response) return result;
      return undefined;
    }, 0);
  }

  private composedRequest?: (ctx: ThinkContext) => Promise<Response | undefined>;
  private composedResponse?: (ctx: ThinkContext) => Promise<void>;
  private composedError?: (ctx: ThinkContext, error: Error) => Promise<Response | undefined>;

  private composeMiddlewares(): void {
    const reqH = this.middlewares.filter((mw) => mw.onRequest).map((mw) => mw.onRequest!);
    this.composedRequest = async (ctx) => {
      for (const h of reqH) { const r = await h(ctx); if (r instanceof Response) return r; }
      return undefined;
    };
    const resH = this.middlewares.filter((mw) => mw.onResponse).map((mw) => mw.onResponse!);
    this.composedResponse = async (ctx) => { for (const h of resH) await h(ctx); };
    const errH = this.middlewares.filter((mw) => mw.onError).map((mw) => mw.onError!);
    this.composedError = async (ctx, err) => {
      for (const h of errH) { const r = await h(ctx, err); if (r instanceof Response) return r; }
      return undefined;
    };
  }

  private async runMiddlewares(ctx: ThinkContext): Promise<Response | undefined> {
    return this.composedRequest?.(ctx);
  }

  private async afterRequest(ctx: ThinkContext): Promise<void> {
    return this.composedResponse?.(ctx);
  }

  private wireDslAcl(data: LoadedData): void {
    if (!data.dsl?.acls || Object.keys(data.dsl.acls).length === 0) return;
    const baseAcl = (this.think.Model.acl as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...baseAcl };
    for (const [name, entry] of Object.entries(data.dsl.models)) {
      Object.assign(merged, buildAclConfig(entry, data.dsl.acls[name]));
    }
    this.think.Model.acl = merged as typeof this.think.Model.acl;
  }

  private warmUpModels(): void {
    const entries = Object.entries(this.think.models ?? {});
    if (entries.length === 0) return;
    const modelConfig = this.think.config("model", {}) as Record<string, unknown>;
    Promise.all(
      entries.map(async ([name, ModelClass]) => {
        try {
          const instance = new (ModelClass as new (...args: unknown[]) => Model)(name, modelConfig);
          await instance.db().query.execute("SELECT 1");
        } catch (err) {
          this.logger.warn(`Model "${name}" warm-up failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    ).catch(() => {});
  }

  async run(): Promise<void> {
    const env = this.options.env ?? "development";
    process.env.NODE_ENV = env;
    const configPath = `${this.options.ROOT_PATH}/config`;
    const srcPath = `${this.options.ROOT_PATH}/src`;
    const think = createThink(this.options.ROOT_PATH, this.config);
    this.think = think;
    const data = loadAppData(srcPath);
    think.controllers = data.controllers;
    think.logics = data.logics;
    think.services = data.services;
    think.models = Object.fromEntries(
      Object.entries(data.models).map(([name, entry]) => [
        name,
        typeof entry === "function" && typeof (entry as { prototype?: { db?: unknown } }).prototype?.db === "function"
          ? entry : think.Model,
      ])
    );
    think.dslServices = data.dsl
      ? Object.fromEntries(Object.entries(data.dsl.services).map(([k, v]) => [k, v]))
      : {};
    this.wireDslAcl(data);
    think.dataResources = (data.dsl?.dataResources ?? {}) as typeof think.dataResources;
    const { middlewares, readies } = loadMiddlewares(configPath, this.options.ROOT_PATH, this.logger, env);
    this.middlewares = middlewares;
    this.middlewareReadies = readies;
    setupCronJobs(this.think, configPath, this.logger);
    this.unwatchConfig = watchConfig(this.options.ROOT_PATH, env, (newConfig) => {
      this.config = newConfig;
      this.think.config = <T = unknown>(name: string, d?: T): T => getConfig(name, d, newConfig);
      this.logger.info("[config] hot reloaded");
    });
    const routerConfig = loadRouterConfig(configPath);
    this.routeTable = buildRouteTable(
      this.config, data.controllers, data.services, data.logics,
      parseRouterRules(routerConfig), data.dsl,
    );

    if ((this.config as Record<string, unknown>).openapi) {
      const { generateOpenAPISpec, createDocsMiddleware } = await import("./openapi");
      const spec = generateOpenAPISpec(this.routeTable, this.config, data.controllers);
      this.middlewares.push(createDocsMiddleware(spec));
    }

    this.composeMiddlewares();
    this.buildKernel();
    loadBootstrap(srcPath, "worker", think);
    await think.beforeStartServer();
    if (this.middlewareReadies.length > 0) await Promise.all(this.middlewareReadies);
    this.warmUpModels();

    const port = this.options.port ?? this.config.port ?? 8360;
    const host = this.options.host ?? this.config.host ?? "0.0.0.0";

    this.server = Bun.serve({
      port, hostname: host,
      fetch: async (request: Request, server: ThinkServer): Promise<Response> => {
        const ctx = await this.buildContext(request, server);
        const response = await this.kernel.execute(ctx);
        await this.afterRequest(ctx);
        return response;
      },
      error: (error: unknown): Response => {
        this.logger.error(toError(error));
        return new Response(
          JSON.stringify({ errno: 500, errmsg: "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      },
      ...(this.options.websocket ?? {}),
      compression: this.options.compression ?? false,
    } as never);

    think.logger.info(`ThinkTS is running at http://${host}:${port}`);
  }

  get instance(): ThinkServer | undefined {
    return this.server;
  }

  stop(): void {
    this.unwatchConfig?.();
    this.server?.stop();
  }
}
