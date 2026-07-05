import { describe, it, expect } from "bun:test";
import { createTestContext } from "./test-utils";
import { extractTenantId, resolveTenantContext } from "./kernel";

describe("extractTenantId", () => {
  it("extracts from x-tenant-id header", () => {
    const ctx = createTestContext({
      request: new Request("http://localhost/", { headers: { "x-tenant-id": "42" } }),
    });
    expect(extractTenantId(ctx)).toBe(42);
  });

  it("keeps string tenant id when header is not numeric", () => {
    const ctx = createTestContext({
      request: new Request("http://localhost/", { headers: { "x-tenant-id": "acme" } }),
    });
    expect(extractTenantId(ctx)).toBe("acme");
  });

  it("falls back to jwt tenant_id", () => {
    const ctx = createTestContext({
      jwt: { tenant_id: 7 },
    });
    expect(extractTenantId(ctx)).toBe(7);
  });

  it("falls back to user tenant_id", () => {
    const ctx = createTestContext({
      user: { tenant_id: 9 },
    });
    expect(extractTenantId(ctx)).toBe(9);
  });

  it("returns undefined when no tenant source exists", () => {
    const ctx = createTestContext();
    expect(extractTenantId(ctx)).toBeUndefined();
  });

  it("prefers header over jwt and user", () => {
    const ctx = createTestContext({
      request: new Request("http://localhost/", { headers: { "x-tenant-id": "3" } }),
      jwt: { tenant_id: 4 },
      user: { tenant_id: 5 },
    });
    expect(extractTenantId(ctx)).toBe(3);
  });
});

describe("resolveTenantContext", () => {
  it("attaches tenantId to context", async () => {
    const ctx = createTestContext({
      request: new Request("http://localhost/", { headers: { "x-tenant-id": "99" } }),
    });
    await resolveTenantContext(ctx);
    expect(ctx.tenantId).toBe(99);
  });

  it("leaves tenantId undefined when no source exists", async () => {
    const ctx = createTestContext();
    await resolveTenantContext(ctx);
    expect(ctx.tenantId).toBeUndefined();
  });
});
