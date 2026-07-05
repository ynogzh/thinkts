import { describe, it, expect } from "bun:test";
import { parseModelRoute } from "./dsl";

describe("parseModelRoute", () => {
  it("splits single underscore into nested module and resource", () => {
    const result = parseModelRoute("user_account");
    expect(result.module).toBe("user");
    expect(result.resource).toBe("account");
    expect(result.path).toBe("/user/account");
  });

  it("splits all underscores into nested directories", () => {
    const result = parseModelRoute("payment_channel_qufu_xx");
    expect(result.module).toBe("payment");
    expect(result.resource).toBe("channel/qufu/xx");
    expect(result.path).toBe("/payment/channel/qufu/xx");
  });

  it("splits all underscores for permission_user_role", () => {
    const result = parseModelRoute("permission_user_role");
    expect(result.module).toBe("permission");
    expect(result.resource).toBe("user/role");
    expect(result.path).toBe("/permission/user/role");
  });

  it("falls back to home module when no underscore", () => {
    const result = parseModelRoute("profile");
    expect(result.module).toBe("home");
    expect(result.resource).toBe("profile");
    expect(result.path).toBe("/profile");
  });

  it("treats leading underscore as home module", () => {
    const result = parseModelRoute("_account");
    expect(result.module).toBe("home");
    expect(result.resource).toBe("account");
    expect(result.path).toBe("/home/account");
  });
});
