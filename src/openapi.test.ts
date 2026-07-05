import { describe, it, expect } from "bun:test";
import * as v from "valibot";
import { valibotToJSONSchema } from "./openapi";

describe("valibotToJSONSchema", () => {
  it("converts string", () => {
    expect(valibotToJSONSchema(v.string())).toEqual({ type: "string" });
  });

  it("converts number", () => {
    expect(valibotToJSONSchema(v.number())).toEqual({ type: "number" });
  });

  it("converts integer", () => {
    expect(valibotToJSONSchema(v.pipe(v.number(), v.integer()))).toEqual({ type: "integer" });
  });

  it("converts boolean", () => {
    expect(valibotToJSONSchema(v.boolean())).toEqual({ type: "boolean" });
  });

  it("converts date", () => {
    expect(valibotToJSONSchema(v.date())).toEqual({ type: "string", format: "date-time" });
  });

  it("converts email", () => {
    expect(valibotToJSONSchema(v.pipe(v.string(), v.email()))).toEqual({ type: "string", format: "email" });
  });

  it("converts url", () => {
    expect(valibotToJSONSchema(v.pipe(v.string(), v.url()))).toEqual({ type: "string", format: "uri" });
  });

  it("converts uuid", () => {
    expect(valibotToJSONSchema(v.pipe(v.string(), v.uuid()))).toEqual({ type: "string", format: "uuid" });
  });

  it("converts string with min/max length", () => {
    expect(valibotToJSONSchema(v.pipe(v.string(), v.minLength(1), v.maxLength(100)))).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 100,
    });
  });

  it("converts number with min/max value", () => {
    expect(valibotToJSONSchema(v.pipe(v.number(), v.minValue(0), v.maxValue(100)))).toEqual({
      type: "number",
      minimum: 0,
      maximum: 100,
    });
  });

  it("converts array", () => {
    expect(valibotToJSONSchema(v.array(v.string()))).toEqual({ type: "array", items: { type: "string" } });
  });

  it("converts object", () => {
    expect(
      valibotToJSONSchema(
        v.object({
          name: v.string(),
          age: v.number(),
        })
      )
    ).toEqual({
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name", "age"],
    });
  });

  it("converts optional fields", () => {
    expect(
      valibotToJSONSchema(
        v.object({
          name: v.string(),
          bio: v.optional(v.string()),
        })
      )
    ).toEqual({
      type: "object",
      properties: { name: { type: "string" }, bio: { type: "string" } },
      required: ["name"],
    });
  });

  it("converts union", () => {
    expect(valibotToJSONSchema(v.union([v.string(), v.number()]))).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("converts piped number inside object", () => {
    expect(
      valibotToJSONSchema(
        v.object({
          age: v.pipe(v.unknown(), v.transform((x) => Number(x)), v.number()),
        })
      )
    ).toEqual({
      type: "object",
      properties: { age: { type: "number" } },
      required: ["age"],
    });
  });

  it("returns empty object for unknown", () => {
    expect(valibotToJSONSchema(v.unknown())).toEqual({});
  });
});
