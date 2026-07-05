import type { ThinkContext } from "../types";
import { BaseService, bindServiceContext } from "../service";
import type { DslModelEntry, DslServiceEntry, ServiceHookName, DslAclEntry } from "./types";
import type { AclConfig, AclRule } from "../acl";

/**
 * DSL helpers: hooks, CRUD utilities, timestamp defaults, and ACL config builder.
 */

const BUILT_IN_HOOKS: Partial<Record<ServiceHookName, (data: Record<string, unknown>) => Record<string, unknown>>> = {
  beforeCreate(data) { if ("created_at" in data) data.created_at = new Date(); return data; },
  beforeUpdate(data) { if ("updated_at" in data) data.updated_at = new Date(); return data; },
};

export async function callDslHook<T>(
  ctx: ThinkContext,
  modelEntry: DslModelEntry,
  serviceEntry: DslServiceEntry | undefined,
  name: ServiceHookName,
  payload: T,
  ...extras: unknown[]
): Promise<T> {
  const hook = serviceEntry?.hooks[name] as
    | ((ctx: ThinkContext, ...args: unknown[]) => T | Promise<T> | undefined | void)
    | undefined;
  if (hook) {
    const serviceContext = bindServiceContext(new BaseService(), ctx, {
      servicePath: modelEntry.path,
      serviceModelName: modelEntry.name,
    });
    const result = await hook.call(serviceContext, ctx, ...extras, payload);
    return result === undefined ? payload : (result as T);
  }
  const builtIn = BUILT_IN_HOOKS[name];
  if (builtIn && payload && typeof payload === "object" && !Array.isArray(payload)) {
    builtIn(payload as Record<string, unknown>);
  }
  return payload;
}

export function normalizeListResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { count: 0, totalPages: 0, pageSize: 20, currentPage: 1, data: [] };
  }
  const r = result as Record<string, unknown>;
  return {
    count: Number(r.count ?? 0),
    totalPages: Number(r.totalPages ?? r.totalPage ?? 0),
    pageSize: Number(r.pageSize ?? r.page_size ?? r.limit ?? 20),
    currentPage: Number(r.currentPage ?? r.current_page ?? r.page ?? 1),
    data: Array.isArray(r.data) ? r.data : [],
  };
}

export function pickWritable(
  columns: DslModelEntry["dsl"]["columns"],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const writable = new Set(columns.map((c) => c.name));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (writable.has(key)) result[key] = value;
  }
  return result;
}

export function applyDefaults(
  columns: DslModelEntry["dsl"]["columns"],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...data };
  for (const col of columns) {
    if (result[col.name] === undefined && col.default !== undefined) {
      result[col.name] = typeof col.default === "function" ? col.default() : col.default;
    }
  }
  return result;
}

export function buildAclConfig(
  entry: DslModelEntry,
  aclEntry?: DslAclEntry,
): AclConfig {
  const config: AclConfig = {};
  if (!aclEntry) return config;
  for (const [role, rules] of Object.entries(aclEntry)) {
    const rule: AclRule = {};
    if (rules.allow) rule.allow = rules.allow;
    if (rules.deny) rule.deny = rules.deny;
    if (rules.readable) rule.readable = rules.readable;
    if (rules.writable) rule.writable = rules.writable;
    config[`${entry.name}:${role}`] = rule;
  }
  return config;
}
