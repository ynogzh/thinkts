import type { AbstractQuery } from "./query";
import type { AbstractParser } from "./parser";
export interface FieldSchema {
  type?: string;
  tinyType?: string;
  default?: unknown | (() => unknown);
  readonly?: boolean;
  update?: boolean;
  validate?: Record<string, unknown>;
  /** field comment from database */
  comment?: string;
  /** whether this field is the primary key */
  isPk?: boolean;
}

export abstract class AbstractSchema {
  config: Record<string, unknown>;
  schema: Record<string, FieldSchema>;
  table: string;
  query!: AbstractQuery;
  parser!: AbstractParser;
  constructor(config: Record<string, unknown>, schema: Record<string, FieldSchema> = {}, table: string) {
    this.config = config;
    this.schema = schema;
    this.table = table;
  }

  async getReverseFields(fields: string | string[]): Promise<string[]> {
    if (typeof fields === "string") fields = fields.trim().split(/\s*,\s*/);
    const schema = await this.getSchema();
    const result = Object.keys(schema).filter((field) => !fields.includes(field));
    for (const item of fields) {
      if (item.indexOf(".") > -1) result.push(item);
    }
    return result;
  }

  validateData(data: Record<string, unknown>, _schema: Record<string, FieldSchema>): Record<string, unknown> {
    return data;
  }

  async parseData(
    data: Record<string, unknown>,
    isUpdate = false,
    table?: string,
    strict = false
  ): Promise<Record<string, unknown>> {
    const schema = await this.getSchema(table);
    const result: Record<string, unknown> = {};
    const unknownKeys: string[] = [];
    // 1. iterate over data to detect unknown fields and copy known ones
    for (const key of Object.keys(data)) {
      if (!(key in schema)) {
        if (strict) unknownKeys.push(key);
        else result[key] = data[key];
        continue;
      }
      if (isUpdate && schema[key].readonly) continue;
      if (data[key] === undefined) {
        const flag = !isUpdate || (isUpdate && schema[key].update);
        const def = schema[key].default;
        if (flag && def !== "" && !(typeof def === "string" && /current_timestamp|now\(\)/i.test(def))) {
          let defaultValue = def;
          if (typeof defaultValue === "function") {
            defaultValue = (defaultValue as () => unknown)();
          }
          result[key] = defaultValue;
        }
        continue;
      }
      const isJSON = schema[key].tinyType === "json" && !(Array.isArray(data[key]) && /^exp$/i.test((data[key] as string[])[0]));
      if (typeof data[key] === "number" || typeof data[key] === "string" || typeof data[key] === "boolean" || isJSON) {
        result[key] = this.parseType(schema[key].tinyType, data[key]);
      } else {
        result[key] = data[key];
      }
    }
    // 2. iterate over schema to fill defaults for missing fields
    for (const key of Object.keys(schema)) {
      if (key in result) continue;
      if (isUpdate && schema[key].readonly) continue;
      const flag = !isUpdate || (isUpdate && schema[key].update);
      const def = schema[key].default;
      if (flag && def !== "" && !(typeof def === "string" && /current_timestamp|now\(\)/i.test(def))) {
        let defaultValue = def;
        if (typeof defaultValue === "function") {
          defaultValue = (defaultValue as () => unknown)();
        }
        result[key] = defaultValue;
      }
    }
    if (strict && unknownKeys.length > 0) {
      throw new Error(`Unknown fields in ${isUpdate ? "update" : "add"} data: ${unknownKeys.join(", ")}`);
    }
    return this.validateData(result, schema);
  }

  abstract getSchema(table?: string): Promise<Record<string, FieldSchema>>;
  abstract parseType(tinyType: string | undefined, value: unknown): unknown;
  abstract getTableComment(table?: string): Promise<string | undefined>;
}
