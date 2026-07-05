import { describe, it, expect } from "bun:test";
import { toPascalCase, toKebabCase } from "./utils";

describe("toPascalCase", () => {
  it("converts kebab-case", () => {
    expect(toPascalCase("user-controller")).toBe("UserController");
  });
  it("converts snake_case", () => {
    expect(toPascalCase("user_controller")).toBe("UserController");
  });
  it("leaves PascalCase intact", () => {
    expect(toPascalCase("UserController")).toBe("UserController");
  });
  it("handles single word", () => {
    expect(toPascalCase("user")).toBe("User");
  });
});

describe("toKebabCase", () => {
  it("converts PascalCase", () => {
    expect(toKebabCase("UserController")).toBe("user-controller");
  });
  it("converts camelCase", () => {
    expect(toKebabCase("userController")).toBe("user-controller");
  });
  it("leaves kebab-case intact", () => {
    expect(toKebabCase("user-controller")).toBe("user-controller");
  });
});
