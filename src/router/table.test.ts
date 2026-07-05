import { describe, expect, it } from "bun:test";
import { buildRouteTable } from "./table";
import { createTestContext } from "../test-utils";

class PingService {
  constructor(public ctx?: unknown) {}

  index() {
    return { ok: true, ctxBound: this.ctx !== undefined };
  }

  status() {
    return { status: "ok" };
  }
}

describe("buildRouteTable", () => {
  it("registers service routes against the real service map", async () => {
    const routeTable = buildRouteTable(
      { defaultAction: "index" } as never,
      {},
      { PingService },
      {},
      []
    );

    const indexEntry = routeTable.exact.get("/ping");
    const statusEntry = routeTable.exact.get("/ping/status");

    expect(indexEntry).toBeDefined();
    expect(statusEntry).toBeDefined();

    const indexResult = await indexEntry!.handler(createTestContext({
      request: new Request("http://localhost/ping"),
      url: new URL("http://localhost/ping"),
    }));
    const statusResult = await statusEntry!.handler(createTestContext({
      request: new Request("http://localhost/ping/status"),
      url: new URL("http://localhost/ping/status"),
    }));

    expect(indexResult).toEqual({ ok: true, ctxBound: true });
    expect(statusResult).toEqual({ status: "ok" });
  });
});
