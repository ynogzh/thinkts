import type { ThinkContext } from "./types";

export interface AclRule {
  /** 可读字段；null 表示全部可读 */
  readable?: string[] | null;
  /** 可写字段；null 表示全部可写；[] 表示禁止写入 */
  writable?: string[] | null;
  /** 行级过滤：对象静态注入，函数动态注入 */
  scope?: Record<string, unknown> | ((ctx: ThinkContext) => Record<string, unknown>);
  /** 显式允许的操作 */
  allow?: Array<"select" | "find" | "add" | "update" | "delete">;
  /** 显式禁止的操作；优先级高于 allow */
  deny?: Array<"select" | "find" | "add" | "update" | "delete">;
}

/** 键优先级：modelName:role > role > * */
export type AclConfig = Record<string, AclRule>;

/** 当未传入角色时的默认 admin 规则（全权限） */
export const defaultAdminRule: AclRule = {
  readable: null,
  writable: null,
  allow: ["select", "find", "add", "update", "delete"],
};

export function defaultUserRule(role: string, ctx?: ThinkContext): AclRule {
  const user = ctx?.user as Record<string, unknown> | undefined;
  const tenantId = user?.tenant_id;
  const userId = user?.id;
  return {
    readable: null,
    writable: [],
    allow: ["select", "find"],
    deny: ["add", "update", "delete"],
    scope: tenantId !== undefined ? { tenant_id: tenantId } : userId !== undefined ? { user_id: userId } : {},
  };
}
