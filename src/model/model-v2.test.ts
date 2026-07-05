import { describe, expect, it } from "bun:test";
import { QueryBuilder } from "./query-builder";
import { withAcl } from "./with-acl";
import { ModelV2 } from "./model-v2";

/** Minimal adapter stub for testing mixin composition. */
function stub() {
  const queries: string[] = [];
  return {
    adapter: {
      query: {
        execute: async (sql: string): Promise<unknown[]> => { queries.push(sql); return []; },
        get lastSql() { return queries[queries.length - 1] ?? ""; },
      },
    },
    queries,
  };
}

describe("QueryBuilder", () => {
  it("builds SELECT with where, order, limit", () => {
    const q = new QueryBuilder("t", () => stub().adapter as never);
    q.where({ status: "enabled" }).order("id desc").limit(10);
    const sql = q._buildSelect();
    expect(sql).toContain("FROM t");
    expect(sql).toContain("WHERE");
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("LIMIT 10");
  });

  it("count works", async () => {
    const q = new QueryBuilder("t", () => stub().adapter as never);
    expect(await q.count()).toBe(0);
  });
});

describe("withAcl mixin", () => {
  it("injects tenant_id filter", () => {
    const Model = withAcl(QueryBuilder);
    const m = new Model("t", () => stub().adapter as never);
    m.acl("admin", { user: { tenant_id: 42 } } as never);
    expect(m._buildSelect()).toContain("tenant_id");
  });
});

describe("ModelV2", () => {
  it("has all composed methods", () => {
    const m = new ModelV2("t", () => stub().adapter as never);
    expect(typeof m.where).toBe("function");
    expect(typeof m.acl).toBe("function");
    expect(typeof m.relation).toBe("function");
    expect(typeof m.select).toBe("function");
    expect(typeof m.count).toBe("function");
  });
});
