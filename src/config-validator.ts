/**
 * Config schema validation using Valibot.
 * Catches mis-typed config at boot time instead of runtime crashes.
 */
import * as v from "valibot";
import type { AppConfig } from "./types";

const optionalString = v.optional(v.string());
const optionalNumber = v.optional(v.number());
const optionalBoolean = v.optional(v.boolean());
const optionalRegexOrString = v.optional(v.union([v.instance(RegExp), v.string()]));
const optionalStringArray = v.optional(v.array(v.string()));

export const AppConfigSchema = v.object({
  port: optionalNumber,
  host: optionalString,
  workers: optionalNumber,
  defaultModule: optionalString,
  defaultController: optionalString,
  defaultAction: optionalString,
  prefix: optionalStringArray,
  suffix: optionalStringArray,
  jsonpCallbackField: optionalString,
  jsonContentType: optionalString,
  jsonpContentType: optionalString,
  errnoField: optionalString,
  errmsgField: optionalString,
  defaultErrno: optionalNumber,
  staticDir: optionalString,
  staticPrefix: optionalRegexOrString,
  logger: v.optional(v.record(v.string(), v.unknown())),
});

export function validateAppConfig(config: AppConfig): void {
  const result = v.safeParse(AppConfigSchema, config);
  if (!result.success) {
    const issues = result.issues.map((issue) => {
      const path = issue.path?.map((p) => (typeof p === "object" && p && "key" in p ? String(p.key) : String(p))).join(".") ?? "";
      return path ? `${path}: ${issue.message}` : issue.message;
    }).join("; ");
    throw new Error(`Config validation failed: ${issues}`);
  }
}
