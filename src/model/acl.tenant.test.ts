import { describe, it, expect } from "bun:test";
import type { ThinkContext } from "../types";
import { ModelWithAcl } from "./acl";

class TestModel extends ModelWithAcl {}

class ScopeModelStub {
  constructor(private readonly rows: Record<string, unknown>[]) {}

  acl(): this {
    return this;
  }

  where(): this {
    return this;
  }

  async select(): Promise<Record<string, unknown>[]> {
    return this.rows;
  }
}

function createModel(
  ctx?: Partial<ThinkContext>,
  scopeRows: Record<string, unknown>[] = [],
  resource: {
    resourceCode: string;
    modelName: string;
    tenantField: string;
    ownerField?: string;
    deptField?: string;
    agentField?: string;
  } = {
    resourceCode: "test_entity",
    modelName: "test_entity",
    tenantField: "tenant_id",
  }
): ModelWithAcl {
  const think = {
    dataResources: {
      test_entity: resource,
    },
    _dataScopeCache: new Map(),
    model(name: string) {
      if (name === "permission_data_scope") {
        return new ScopeModelStub(scopeRows);
      }
      return undefined;
    },
  } as unknown as ThinkContext["think"];
  const model = new TestModel("test_entity", {
    handle: class {
      parser = {} as never;
      query = {} as never;
      schema = {} as never;
    },
  });
  model.acl("user", { think, ...ctx } as ThinkContext);
  return model;
}

describe("ModelWithAcl tenant scope", () => {
  it("injects tenant_id from ctx.tenantId", () => {
    TestModel.acl = { "test_entity:user": {} };
    const model = createModel({ tenantId: 42 });
    const rule = (model as unknown as { _resolveAclRule(): { scope?: Record<string, unknown> } })._resolveAclRule();
    expect(rule?.scope).toEqual({ tenant_id: 42 });
    TestModel.acl = undefined;
  });

  it("falls back to user.tenant_id when ctx.tenantId is absent", () => {
    TestModel.acl = { "test_entity:user": {} };
    const model = createModel({ user: { tenant_id: 7 } });
    const rule = (model as unknown as { _resolveAclRule(): { scope?: Record<string, unknown> } })._resolveAclRule();
    expect(rule?.scope).toEqual({ tenant_id: 7 });
    TestModel.acl = undefined;
  });

  it("prefers ctx.tenantId over user.tenant_id", () => {
    TestModel.acl = { "test_entity:user": {} };
    const model = createModel({ tenantId: 1, user: { tenant_id: 2 } });
    const rule = (model as unknown as { _resolveAclRule(): { scope?: Record<string, unknown> } })._resolveAclRule();
    expect(rule?.scope).toEqual({ tenant_id: 1 });
    TestModel.acl = undefined;
  });

  it("merges tenant scope with configured scope", () => {
    TestModel.acl = {
      "test_entity:user": {
        scope: { status: "enabled" },
      },
    };
    const model = createModel({ tenantId: 5 });
    const rule = (model as unknown as { _resolveAclRule(): { scope?: Record<string, unknown> } })._resolveAclRule();
    expect(rule?.scope).toEqual({ tenant_id: 5, status: "enabled" });
    TestModel.acl = undefined;
  });

  it("default user rule includes tenant scope", async () => {
    const model = createModel({ tenantId: 9 });
    const rule = await (model as unknown as { _defaultAclRule(): Promise<{ scope?: Record<string, unknown> }> })._defaultAclRule();
    expect(rule.scope).toEqual({ tenant_id: 9 });
  });

  it("default user rule falls back to user_id when tenant is absent", async () => {
    const model = createModel({ user: { id: 11 } });
    const rule = await (model as unknown as { _defaultAclRule(): Promise<{ scope?: Record<string, unknown> }> })._defaultAclRule();
    expect(rule.scope).toEqual({ user_id: 11 });
  });

  it("applies wildcard permission_data_scope rows using role_id", async () => {
    const model = createModel(
      { tenantId: 12, user: { id: 33, role_id: 8 } },
      [{ tenant_id: 12, role_id: 8, resource_code: "*", scope_type: "self" }],
      {
        resourceCode: "identity_user",
        modelName: "test_entity",
        tenantField: "tenant_id",
        ownerField: "id",
      }
    );
    const rule = await (model as unknown as { _defaultAclRule(): Promise<{ scope?: Record<string, unknown> }> })._defaultAclRule();
    expect(rule.scope).toEqual({ tenant_id: 12, id: 33 });
  });

  it("prefers resource-specific permission_data_scope over wildcard rows", async () => {
    const model = createModel(
      { tenantId: 4, user: { id: 21, role_id: 5, main_dept_id: 99 } },
      [
        { tenant_id: 4, role_id: 5, resource_code: "*", scope_type: "self" },
        { tenant_id: 4, role_id: 5, resource_code: "test_entity", scope_type: "dept" },
      ],
      {
        resourceCode: "test_entity",
        modelName: "test_entity",
        tenantField: "tenant_id",
        ownerField: "user_id",
        deptField: "dept_id",
      }
    );
    const rule = await (model as unknown as { _defaultAclRule(): Promise<{ scope?: Record<string, unknown> }> })._defaultAclRule();
    expect(rule.scope).toEqual({ tenant_id: 4, dept_id: 99 });
  });
});
