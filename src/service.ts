import type { ThinkContext } from "./types";
import type { Model } from "./model";
import { thinkCache, thinkCacheJSON } from "./cache";

export interface ServiceBindingMeta {
  servicePath?: string;
  serviceModelName?: string;
}

export class BaseService {
  ctx?: ThinkContext;
  servicePath?: string;
  serviceModelName?: string;

  constructor(ctx?: ThinkContext) {
    this.ctx = ctx;
  }

  private requireThink() {
    const think = this.ctx?.think;
    if (!think) {
      throw new Error("Service context is not bound to think");
    }
    return think;
  }

  private resolveModelName(name?: string): string {
    if (name) return name;
    if (this.serviceModelName) return this.serviceModelName;
    throw new Error("Current service is not bound to a model");
  }

  model(name?: string, config?: Record<string, unknown>): Model {
    const think = this.requireThink();
    const modelConfig = think.config("model", {}) as Record<string, unknown>;
    return think.model(this.resolveModelName(name), { ...modelConfig, ...config, _aclCtx: this.ctx });
  }

  transModel(name?: string, config?: Record<string, unknown>): Model {
    const think = this.requireThink();
    const modelConfig = think.config("model", {}) as Record<string, unknown>;
    return think.transModel(this.resolveModelName(name), { ...modelConfig, ...config, _aclCtx: this.ctx });
  }

  currentModel(config?: Record<string, unknown>): Model {
    return this.model(undefined, config);
  }

  currentTransModel(config?: Record<string, unknown>): Model {
    return this.transModel(undefined, config);
  }

  service<T = unknown>(name: string, opts?: Record<string, unknown>, ...args: unknown[]): T {
    return this.requireThink().service(name, opts, ...args) as T;
  }

  async findOne(where: Record<string, unknown>, config?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await this.currentModel(config).where(where).find() as Record<string, unknown>;
  }

  async list(where: Record<string, unknown> = {}, config?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    return await this.currentModel(config).where(where).select() as Record<string, unknown>[];
  }

  async create(data: Record<string, unknown>, config?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await this.currentModel(config).create(data) as Record<string, unknown>;
  }

  async update(where: Record<string, unknown>, data: Record<string, unknown>, config?: Record<string, unknown>): Promise<unknown> {
    return await this.currentModel(config).where(where).update(data);
  }

  async remove(where: Record<string, unknown>, config?: Record<string, unknown>): Promise<unknown> {
    return await this.currentModel(config).where(where).delete();
  }

  async count(where: Record<string, unknown> = {}, config?: Record<string, unknown>): Promise<number> {
    return await this.currentModel(config).where(where).count();
  }

  cache(name: string, value?: unknown, config?: Record<string, unknown>): Promise<unknown> {
    const think = this.requireThink();
    const cacheConfig = think.config("cache", {}) as Record<string, unknown>;
    return thinkCache(name, value, { ...cacheConfig, ...config });
  }

  cacheJSON<T = unknown>(name: string, value?: T, config?: Record<string, unknown>): Promise<T | undefined> {
    const think = this.requireThink();
    const cacheConfig = think.config("cache", {}) as Record<string, unknown>;
    return thinkCacheJSON(name, value, { ...cacheConfig, ...config });
  }
}

export function bindServiceContext<T>(instance: T, ctx?: ThinkContext, meta?: ServiceBindingMeta): T {
  if (instance instanceof BaseService) {
    instance.ctx = ctx;
    instance.servicePath = meta?.servicePath;
    instance.serviceModelName = meta?.serviceModelName;
  }
  return instance;
}
