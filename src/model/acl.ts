import type { ParseOptions } from "./parser";
import type { ThinkContext } from "../types";
import type { AclConfig, AclRule } from "../acl";
import type { DataResourceMeta } from "../dsl-model/types";
import { AclError } from "../error";
import { ModelCore } from "./core";

export type DataScopeType = "all" | "self" | "dept" | "custom" | "agent_tree" | "default";

export interface ResolvedDataScope {
  scopeType: DataScopeType;
  ownerField?: string;
  deptField?: string;
  agentField?: string;
  scopeValue?: Record<string, unknown>;
}

export class ModelWithAcl extends ModelCore {
  protected _aclRole?: string;
  protected _aclCtx?: ThinkContext;

  acl(role: string, ctx?: ThinkContext): this {
    this._aclRole = role;
    this._aclCtx = ctx;
    return this;
  }

  model(name: string): this {
    const instance = super.model(name) as this;
    instance._aclRole = this._aclRole;
    instance._aclCtx = this._aclCtx;
    return instance;
  }

  protected _resolveAclRule(): AclRule | undefined {
    const config = this._getAclConfig();
    if (!config || !this._aclRole) return undefined;
    const rule =
      config[`${this.modelName}:${this._aclRole}`] ??
      config[this._aclRole] ??
      config["*"];
    if (!rule) return undefined;
    return this._mergeTenantScope(rule);
  }

  /** Get the static ACL configuration from the model class. */
  protected _getAclConfig(): AclConfig | undefined {
    return (this.constructor as typeof ModelWithAcl).acl as AclConfig | undefined;
  }

  private _mergeTenantScope(rule: AclRule): AclRule {
    const tenantId = this._resolveTenantId();
    if (tenantId === undefined || tenantId === null) return rule;
    const tenantField = this._resolveTenantField();
    if (!tenantField) return rule;
    const scopeWhere = typeof rule.scope === "function" ? rule.scope(this._aclCtx!) : rule.scope;
    return {
      ...rule,
      scope: { [tenantField]: tenantId, ...scopeWhere },
    };
  }

  private _resolveTenantId(): unknown {
    if (!this._aclCtx) return undefined;
    const user = this._aclCtx.user as Record<string, unknown> | undefined;
    return this._aclCtx.tenantId ?? user?.tenant_id;
  }

  private _resolveTenantField(): string | undefined {
    return this._getDataResource()?.tenantField;
  }

  private _getDataResource(): (DataResourceMeta & { modelName: string }) | undefined {
    return this._aclCtx?.think?.dataResources?.[this.modelName];
  }

  protected async _defaultAclRule(): Promise<AclRule> {
    if (this._aclRole === "superadmin") {
      return { readable: null, writable: null, allow: ["select", "find", "add", "update", "delete"] };
    }

    const resource = this._getDataResource();
    const tenantId = this._resolveTenantId();
    const user = this._aclCtx?.user as Record<string, unknown> | undefined;
    const userId = user?.id;
    const tenantField = resource?.tenantField;
    const scope: Record<string, unknown> = {};
    if (tenantId !== undefined && tenantField) scope[tenantField] = tenantId;

    if (this._aclRole === "admin") {
      return { readable: null, writable: null, allow: ["select", "find", "add", "update", "delete"], scope };
    }

    // Resolve explicit data scope from permission_data_scope (or fallback) for business roles.
    // By default every permitted role can read/write within its own scope.
    const dataScope = await this._resolveDataScope();
    switch (dataScope.scopeType) {
      case "all":
        return { readable: null, writable: null, allow: ["select", "find", "add", "update", "delete"], scope };
      case "self": {
        const ownerField = dataScope.ownerField ?? resource?.ownerField ?? "user_id";
        if (userId !== undefined) scope[ownerField] = userId;
        break;
      }
      case "dept": {
        const deptField = dataScope.deptField ?? resource?.deptField ?? "dept_id";
        const deptId = user?.main_dept_id ?? user?.dept_id;
        if (deptId !== undefined) scope[deptField] = deptId;
        break;
      }
      case "custom": {
        const custom = dataScope.scopeValue ?? {};
        for (const [k, v] of Object.entries(custom)) {
          if (v !== undefined) scope[k] = v;
        }
        break;
      }
      case "agent_tree": {
        const agentField = dataScope.agentField ?? resource?.agentField ?? "agent_id";
        const agentIds = dataScope.scopeValue?.agentIds as unknown[] | undefined;
        if (agentIds?.length) scope[agentField] = agentIds;
        break;
      }
      default: {
        const ownerField = resource?.ownerField ?? "user_id";
        if (ownerField && userId !== undefined) scope[ownerField] = userId;
      }
    }

    return { readable: null, writable: null, allow: ["select", "find", "add", "update", "delete"], scope };
  }
  private async _resolveDataScope(): Promise<ResolvedDataScope> {
    const role = this._aclRole ?? "guest";
    const resource = this._getDataResource();
    const resourceCode = resource?.resourceCode ?? this.modelName;
    const cache = this._aclCtx?.think?._dataScopeCache as Map<string, ResolvedDataScope> | undefined;
    const cacheKey = `${resourceCode}:${role}:${String(this._aclCtx?.tenantId ?? "")}:${String(this._aclCtx?.user?.id ?? "")}`;
    if (cache?.has(cacheKey)) return cache.get(cacheKey)!;

    // Load from permission_data_scope table when the model exists.
    let scopeType: DataScopeType = "self";
    let scopeValue: Record<string, unknown> | undefined;
    let ownerField = resource?.ownerField;
    let deptField = resource?.deptField;
    let agentField = resource?.agentField;

    try {
      const scopeModel = this._aclCtx?.think?.model("permission_data_scope");
      if (scopeModel) {
        scopeModel.acl("superadmin", this._aclCtx);
        const rows = await scopeModel
          .where({
            tenant_id: this._aclCtx?.tenantId,
            role_id: (this._aclCtx?.user as Record<string, unknown> | undefined)?.role_id ?? 0,
          })
          .select();
        const row = (rows as Record<string, unknown>[] | undefined)?.find((item) => item.resource_code === resourceCode)
          ?? (rows as Record<string, unknown>[] | undefined)?.find((item) => item.resource_code === "*");
        if (row) {
          scopeType = (row.scope_type as DataScopeType) ?? "self";
          if (row.scope_value_json) {
            scopeValue = typeof row.scope_value_json === "string"
              ? JSON.parse(row.scope_value_json)
              : (row.scope_value_json as Record<string, unknown>);
          }
        }
      }
    } catch {
      // permission_data_scope model may not exist yet; fall back to defaults.
    }

    if (role === "superadmin") scopeType = "all";

    const result: ResolvedDataScope = { scopeType };
    if (ownerField) result.ownerField = ownerField;
    if (deptField) result.deptField = deptField;
    if (agentField) result.agentField = agentField;
    if (scopeValue) result.scopeValue = scopeValue;

    if (cache) cache.set(cacheKey, result);
    return result;
  }
  protected async _applyAclRead(options: ParseOptions, operation: "select" | "find"): Promise<ParseOptions> {
    const rule = (await this._resolveAclRule()) ?? (await this._defaultAclRule());
    if (rule.deny?.includes(operation) || (rule.allow && !rule.allow.includes(operation))) {
      throw new AclError(`ACL denied: ${operation} on ${this.modelName}`, { traceId: this._aclCtx?.traceId });
    }
    if (rule.scope) {
      const scopeWhere = typeof rule.scope === "function" ? rule.scope(this._aclCtx!) : rule.scope;
      options.where = { ...(options.where as Record<string, unknown> | undefined), ...scopeWhere };
    }
    if (rule.readable !== null && rule.readable !== undefined) {
      if (options.field) {
        const existing = Array.isArray(options.field)
          ? options.field
          : String(options.field).split(/\s*,\s*/);
        options.field = existing.filter((f) => rule.readable!.includes(f));
      } else {
        options.field = rule.readable;
      }
    }
    return options;
  }

  protected async _applyAclWrite(data: Record<string, unknown>, operation: "add" | "update"): Promise<Record<string, unknown>> {
    const rule = (await this._resolveAclRule()) ?? (await this._defaultAclRule());
    if (rule.deny?.includes(operation) || (rule.allow && !rule.allow.includes(operation))) {
      throw new AclError(`ACL denied: ${operation} on ${this.modelName}`, { traceId: this._aclCtx?.traceId });
    }
    if (rule.writable !== null && rule.writable !== undefined) {
      const writable = new Set(rule.writable);
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (writable.has(key)) result[key] = value;
      }
      return result;
    }
    return data;
  }

  protected async _applyAclDelete(options: ParseOptions): Promise<ParseOptions> {
    const rule = (await this._resolveAclRule()) ?? (await this._defaultAclRule());
    if (rule.deny?.includes("delete") || (rule.allow && !rule.allow.includes("delete"))) {
      throw new AclError(`ACL denied: delete on ${this.modelName}`, { traceId: this._aclCtx?.traceId });
    }
    if (rule.scope) {
      const scopeWhere = typeof rule.scope === "function" ? rule.scope(this._aclCtx!) : rule.scope;
      options.where = { ...(options.where as Record<string, unknown> | undefined), ...scopeWhere };
    }
    return options;
  }
}
