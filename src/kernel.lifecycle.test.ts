import { describe, expect, it } from "bun:test";
import {
  DefaultActionExecutorStrategy,
  DefaultAuthorizerStrategy,
  DefaultErrorFormatterStrategy,
  DefaultResponderStrategy,
  DefaultRouterStrategy,
  DefaultValidatorStrategy,
  ThinkKernel,
} from "./kernel";
import { createThink } from "./think";
import { loadConfig } from "./config";
import { createTestContext } from "./test-utils";

const rootPath = `${import.meta.dir}/..`;

describe("ThinkKernel route metadata", () => {
  it("exposes route controller and action before beforeAction hooks run", async () => {
    const think = createThink(rootPath, loadConfig(rootPath, "test"));
    const routeTable = {
      exact: new Map([
        [
          "/reports/list",
          {
            match: "/reports/list",
            module: "reports",
            controller: "reports/list",
            action: "list",
            handler: async () => ({ errno: 0 }),
          },
        ],
      ]),
      patterns: [],
    };
    const kernel = new ThinkKernel({
      router: new DefaultRouterStrategy(routeTable),
      validator: new DefaultValidatorStrategy(),
      authorizer: new DefaultAuthorizerStrategy(),
      executor: new DefaultActionExecutorStrategy(),
      responder: new DefaultResponderStrategy(),
      errorFormatter: new DefaultErrorFormatterStrategy("test"),
    });

    let seen: { module?: string; controller?: string; action?: string } | undefined;
    kernel.beforeAction(async (ctx) => {
      seen = { module: ctx.module, controller: ctx.controller, action: ctx.action };
    });

    const response = await kernel.execute(createTestContext({
      think,
      request: new Request("http://localhost/reports/list"),
      url: new URL("http://localhost/reports/list"),
    }));

    expect(response.status).toBe(200);
    expect(seen).toEqual({ module: "reports", controller: "reports/list", action: "list" });
  });
});
