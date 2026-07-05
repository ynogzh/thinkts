import { describe, expect, it } from "bun:test";
import { createThink } from "./think";
import { loadConfig } from "./config";
import { BaseService } from "./service";
import { createTestContext } from "./test-utils";

const rootPath = `${import.meta.dir}/..`;

class ReportService extends BaseService {
  currentTenant() {
    return this.ctx?.tenantId;
  }
}

class InvoiceModelStub {
  private whereValue: Record<string, unknown> = {};

  where(where: Record<string, unknown>) {
    this.whereValue = where;
    return this;
  }

  async find() {
    return { id: this.whereValue.id ?? 1, status: "created" };
  }

  async update(data: Record<string, unknown>) {
    return { affectedRows: 1, where: this.whereValue, data };
  }
  acl() {
    return this;
  }
}

describe("think.service", () => {
  it("binds background context for class service calls", () => {
    const think = createThink(rootPath, loadConfig(rootPath, "test"));
    const ReportServiceClass = class extends BaseService {
      currentRole() { return this.ctx?.user?.role; }
    };
    think.services = {
      billing: { Report: ReportServiceClass },
    };

    // Without a request context, the resolver creates a background context with superadmin role
    const role = think.service("billing.report.currentRole");
    expect(role).toBe("superadmin");
  });
  it("binds a synthetic think context for background DSL hooks", async () => {
    const think = createThink(rootPath, loadConfig(rootPath, "test"));
    think.models = {
      billing_invoice: InvoiceModelStub,
    };
    think.dslServices = {
      billing_invoice: {
        name: "billing_invoice",
        path: "src/billing/invoice",
        hooks: {
          async loadCurrent(this: BaseService, opts: Record<string, unknown>) {
            return await this.findOne({ id: Number(opts.id) });
          },
        },
      } as never,
    };

    const result = await think.service("billing.invoice.loadCurrent", { id: 7 }) as Record<string, unknown>;

    expect(result).toEqual({ id: 7, status: "created" });
  });

  it("invokes exact-path function services for background jobs", async () => {
    const think = createThink(rootPath, loadConfig(rootPath, "test"));
    think.services = {
      "index/cron/heartbeat": async (opts: Record<string, unknown>, runtimeThink: ReturnType<typeof createThink>) => ({
        ok: true,
        stale_after_minutes: opts.stale_after_minutes,
        app_path: runtimeThink.APP_PATH,
      }),
    };

    const result = await think.service("index/cron/heartbeat", { stale_after_minutes: 15 }) as Record<string, unknown>;

    expect(result).toEqual({
      ok: true,
      stale_after_minutes: 15,
      app_path: `${rootPath}/src`,
    });
  });


  it("binds BaseService helpers for DSL service hooks", async () => {
    const think = createThink(rootPath, loadConfig(rootPath, "test"));
    think.models = {
      billing_invoice: InvoiceModelStub,
    };
    think.dslServices = {
      billing_invoice: {
        name: "billing_invoice",
        path: "src/billing/invoice",
        hooks: {
          async patchCurrent(this: BaseService, opts: Record<string, unknown>) {
            await this.update({ id: Number(opts.id) }, { status: String(opts.status) });
            return await this.findOne({ id: Number(opts.id) });
          },
        },
      } as never,
    };

    const result = await think.service("billing.invoice.patchCurrent", { id: 9, status: "paid" }) as Record<string, unknown>;

    expect(result).toEqual({ id: 9, status: "created" });
  });
});
