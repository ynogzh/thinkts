import { describe, it, expect } from "bun:test";
import { normalizePath } from "./handler";

describe("normalizePath", () => {
  it("removes duplicate slashes", () => {
    expect(normalizePath("//api//user")).toBe("/api/user");
  });

  it("resolves parent directory references", () => {
    expect(normalizePath("/api/../admin")).toBe("/admin");
  });

  it("resolves current directory references", () => {
    expect(normalizePath("/api/./user")).toBe("/api/user");
  });

  it("removes null bytes", () => {
    expect(normalizePath("/api\u0000/user")).toBe("/api/user");
  });

  it("normalizes backslashes", () => {
    expect(normalizePath("\\api\\user")).toBe("/api/user");
  });
  it("removes trailing slash", () => {
    expect(normalizePath("/api/user/")).toBe("/api/user");
  });

  it("handles root path", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("handles complex traversal", () => {
    expect(normalizePath("/a/b/../c/d/../../e")).toBe("/a/e");
  });
});
