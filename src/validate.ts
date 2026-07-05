import * as v from "valibot";

export type Schema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

export function validate<T>(schema: Schema, data: unknown): T {
  return v.parse(schema, data) as T;
}

export function safeValidate<T>(schema: Schema, data: unknown): ValidationResult<T> {
  const result = v.safeParse(schema, data);
  if (result.success) {
    return { success: true, data: result.output as T };
  }
  return {
    success: false,
    errors: result.issues.map((issue) => issue.message),
  };
}

export function formatValidationErrors(issues: readonly v.BaseIssue<unknown>[]): string {
  return issues.map((issue) => {
    const path = issue.path?.map((p) => (typeof p === "object" && p && "key" in p ? String(p.key) : String(p))).join(".") ?? "";
    return path ? `${path}: ${issue.message}` : issue.message;
  }).join("; ");
}

export { v };
