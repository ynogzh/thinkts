import "reflect-metadata";
import * as v from "valibot";
import type { BaseSchema, BaseIssue } from "valibot";

export type ValidationSchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;

const VALIDATE_KEY = "thinkts:validate";

export function Validate(schema: ValidationSchema): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(VALIDATE_KEY, schema, target, propertyKey);
  };
}

export function getValidateSchema(target: object, propertyKey: string | symbol): ValidationSchema | undefined {
  return Reflect.getMetadata(VALIDATE_KEY, target, propertyKey) as ValidationSchema | undefined;
}

/* ── Simple shorthand format ─────────────────────────────────────────────── */

export type SimpleRule =
  | "string"
  | "number"
  | "int"
  | "boolean"
  | "email"
  | "url"
  | "uuid"
  | "date"
  | "array"
  | "object"
  | "?string" | "?number" | "?int" | "?boolean" | "?email" | "?url" | "?uuid" | "?date" | "?array" | "?object"
  | ["string", number?, number?]
  | ["number", number?, number?]
  | ["int", number?, number?]
  | ["boolean"]
  | ["email"]
  | ["url"]
  | ["uuid"]
  | ["date"]
  | ["array", SimpleRule?]
  | ["object", Record<string, SimpleRule>?]
  // Optional array forms
  | ["?" | "optional", "string", number?, number?]
  | ["?" | "optional", "number", number?, number?]
  | ["?" | "optional", "int", number?, number?]
  | ["?" | "optional", "boolean"]
  | ["?" | "optional", "email"]
  | ["?" | "optional", "url"]
  | ["?" | "optional", "uuid"]
  | ["?" | "optional", "date"]
  | ["?" | "optional", "array", SimpleRule?]
  | ["?" | "optional", "object", Record<string, SimpleRule>?];

export interface SimpleValidateOptions {
  [field: string]: SimpleRule;
}

function isOptional(rule: SimpleRule): boolean {
  if (typeof rule === "string") return rule.startsWith("?");
  if (Array.isArray(rule)) return rule[0] === "?" || rule[0] === "optional";
  return false;
}

function stripOptional(rule: SimpleRule): SimpleRule {
  if (typeof rule === "string" && rule.startsWith("?")) {
    return rule.slice(1) as SimpleRule;
  }
  if (Array.isArray(rule) && (rule[0] === "?" || rule[0] === "optional")) {
    return rule.slice(1) as SimpleRule;
  }
  return rule;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSchema(x: unknown): any {
  return x as unknown as BaseSchema<unknown, unknown, BaseIssue<unknown>>;
}

function coerceNumber(val: unknown): unknown {
  if (typeof val === "string") {
    const n = Number(val);
    return isNaN(n) ? val : n;
  }
  return val;
}
function coerceBoolean(val: unknown): unknown {
  if (typeof val === "string") {
    if (val === "true" || val === "1") return true;
    if (val === "false" || val === "0") return false;
  }
  return val;
}
function parseSimpleRule(rule: SimpleRule): ValidationSchema {
  if (typeof rule === "string") {
    switch (rule) {
      case "string": return v.string();
      case "number": return toSchema(v.pipe(v.unknown(), v.transform(coerceNumber), v.number()));
      case "int": return toSchema(v.pipe(v.unknown(), v.transform(coerceNumber), v.number(), v.integer()));
      case "boolean": return toSchema(v.pipe(v.unknown(), v.transform(coerceBoolean), v.boolean()));
      case "email": return toSchema(v.pipe(v.string(), v.email()));
      case "url": return toSchema(v.pipe(v.string(), v.url()));
      case "uuid": return toSchema(v.pipe(v.string(), v.uuid()));
      case "date": return v.date();
      case "array": return v.array(v.unknown());
      case "object": return v.object({});
      default: return v.string();
    }
  }
  const [type, ...args] = rule;
  switch (type) {
    case "string": {
      const pipes: unknown[] = [];
      if (args[0] !== undefined) pipes.push(v.minLength(args[0] as number));
      if (args[1] !== undefined) pipes.push(v.maxLength(args[1] as number));
      return pipes.length ? toSchema(v.pipe(v.string(), ...(pipes as never[]))) : v.string();
    }
    case "number": {
      const pipes: unknown[] = [v.number()];
      if (args[0] !== undefined) pipes.push(v.minValue(args[0] as number));
      if (args[1] !== undefined) pipes.push(v.maxValue(args[1] as number));
      return toSchema(v.pipe(v.unknown(), v.transform(coerceNumber), ...(pipes as never[])));
    }
    case "int": {
      const pipes: unknown[] = [v.number(), v.integer()];
      if (args[0] !== undefined) pipes.push(v.minValue(args[0] as number));
      if (args[1] !== undefined) pipes.push(v.maxValue(args[1] as number));
      return toSchema(v.pipe(v.unknown(), v.transform(coerceNumber), ...(pipes as never[])));
    }
    case "boolean": return toSchema(v.pipe(v.unknown(), v.transform(coerceBoolean), v.boolean()));
    case "email": return toSchema(v.pipe(v.string(), v.email()));
    case "url": return toSchema(v.pipe(v.string(), v.url()));
    case "uuid": return toSchema(v.pipe(v.string(), v.uuid()));
    case "date": return v.date();
    case "array": {
      const itemRule = args[0] as SimpleRule | undefined;
      const itemSchema = itemRule ? parseSimpleRule(itemRule) : v.unknown();
      return v.array(itemSchema);
    }
    case "object": {
      const fields = args[0] as Record<string, SimpleRule> | undefined;
      if (!fields) return v.object({});
      const entries: Record<string, ValidationSchema> = {};
      for (const [k, r] of Object.entries(fields)) {
        const opt = isOptional(r);
        const stripped = stripOptional(r);
        const inner = parseSimpleRule(stripped);
        entries[k] = opt ? toSchema(v.optional(inner)) : inner;
      }
      return v.object(entries);
    }
    default: return v.string();
  }
}

function parseSimpleOptions(options: SimpleValidateOptions): ValidationSchema {
  const entries: Record<string, ValidationSchema> = {};
  for (const [key, rule] of Object.entries(options)) {
    const opt = isOptional(rule);
    const stripped = stripOptional(rule);
    const schema = parseSimpleRule(stripped);
    entries[key] = opt ? toSchema(v.optional(schema)) : schema;
  }
  return v.object(entries);
}

/**
 * Shorthand validation using a compact rule object.
 *
 * Examples:
 *   @SimpleValidate({ name: "string", age: "int" })               // 必填
 *   @SimpleValidate({ name: "?string", age: ["?int", 18] })       // 可选
 *   @SimpleValidate({ email: "email", bio: ["?", "string", 0, 500] })
 *   @SimpleValidate({ user: ["object", { name: "string", age: ["?int", 0] }] })
 */
export function SimpleValidate(options: SimpleValidateOptions): MethodDecorator {
  return Validate(parseSimpleOptions(options));
}

export function simpleSchema(rule: SimpleRule | SimpleValidateOptions): ValidationSchema {
  if (typeof rule === "object" && !Array.isArray(rule) && !(rule instanceof Date)) {
    return parseSimpleOptions(rule as SimpleValidateOptions);
  }
  return parseSimpleRule(rule as SimpleRule);
}
