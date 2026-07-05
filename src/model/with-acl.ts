import type { QueryBuilder } from "./query-builder";
import type { WhereClause } from "./query-builder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = QueryBuilder> = new (...args: any[]) => T;

export interface AclRule {
  allow?: Array<"select" | "find" | "add" | "update" | "delete">;
  deny?: Array<"select" | "find" | "add" | "update" | "delete">;
  readable?: string[] | null;
  writable?: string[] | null;
  scope?: WhereClause;
}

/**
 * Mixin: adds ACL-based row filtering and access control to a QueryBuilder.
 * Usage: `const Model = withAcl(QueryBuilder);`
 */
export function withAcl<TBase extends Constructor>(Base: TBase) {
  return class AclModel extends Base {
    _aclRole?: string;
    _aclRules: Record<string, AclRule> = {};

    acl(role: string, ctx?: Record<string, unknown>): this {
      this._aclRole = role;
      const tenantId = (ctx as Record<string, unknown> | undefined)?.["tenantId"] ?? (ctx?.["user"] as Record<string, unknown> | undefined)?.["tenant_id"];
      if (tenantId !== undefined && tenantId !== null) {
        (this as unknown as QueryBuilder).where({ tenant_id: tenantId as number });
      }
      const rule = this._aclRules[role];
      if (rule?.scope) {
        (this as unknown as QueryBuilder).where(rule.scope);
      }
      return this;
    }

    setAclRules(rules: Record<string, AclRule>): this { this._aclRules = rules; return this; }
    get aclRole(): string | undefined { return this._aclRole; }
  };
}
