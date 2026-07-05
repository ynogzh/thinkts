import type { AbstractQuery } from "./query";
import type { AbstractSchema } from "./schema";
import { LruCache } from "../lru";
import { ClauseParser } from "./parser/clauses";
import type { ParseOptions } from "./parser/types";
export type { ParseOptions, JoinItem, UnionItem } from "./parser/types";
export abstract class AbstractParser extends ClauseParser {
  config: Record<string, unknown>;
  query!: AbstractQuery;
  schema!: AbstractSchema;
  private sqlCache = new LruCache<string>(512);

  constructor(config: Record<string, unknown> = {}) {
    super();
    this.config = config;
  }

  private buildCacheKey(prefix: string, options: ParseOptions, data?: Record<string, unknown>): string {
    const hasParams = options.params !== undefined;
    const opts = { ...options };
    delete opts.params;
    if (hasParams) {
      delete (opts as Record<string, unknown>).values;
    }
    return `${prefix}:${JSON.stringify(opts)}${data ? ":" + JSON.stringify(data) : ""}`;
  }

  private getCachedSql(key: string, builder: () => string): string {
    const cached = this.sqlCache.get(key);
    if (cached !== undefined) return cached;
    const sql = builder();
    this.sqlCache.set(key, sql);
    return sql;
  }

  parseExplain(explain?: boolean): string {
    return explain ? "EXPLAIN " : "";
  }

  parseSet(data: Record<string, unknown> = {}, params?: unknown[]): string {
    const set: string[] = [];
    for (const key of Object.keys(data)) {
      const value = this.parseValue(data[key], params);
      if (typeof value === "string" || typeof value === "number" || value === "?") {
        set.push(`${this.parseKey(key)}=${value}`);
      }
    }
    return set.length ? ` SET ${set.join(",")}` : "";
  }

  parseField(fields?: string | string[] | Record<string, string>, options: ParseOptions = {}): string {
    const alias = options.alias;
    if (typeof fields === "string") {
      if (fields.indexOf("(") > -1 && fields.indexOf(")") > -1) return fields;
      if (fields.indexOf(",") > -1) fields = fields.split(/\s*,\s*/);
      else {
        const f = this.parseKey(fields);
        if (alias && f.indexOf(".") === -1) return `${this.parseKey(alias)}.${f}`;
        return f;
      }
    }
    if (Array.isArray(fields) && fields.length > 0) {
      return fields.map((item) => {
        const parsed = this.parseKey(item);
        if (alias && parsed.indexOf(".") === -1) return `${this.parseKey(alias)}.${parsed}`;
        return parsed;
      }).join(",");
    } else if (typeof fields === "object" && fields !== null && !Array.isArray(fields) && Object.keys(fields).length > 0) {
      const data: string[] = [];
      for (const key of Object.keys(fields)) {
        data.push(`${this.parseKey(key)} AS ${this.parseKey((fields as Record<string, string>)[key])}`);
      }
      return data.join(",");
    }
    return "*";
  }

  parseTable(table?: string | string[] | Record<string, string>, options: ParseOptions = {}): string {
    if (typeof table === "string") {
      if (options.alias) {
        return `${this.parseKey(table)} AS ${this.parseKey(options.alias)}`;
      }
      table = table.split(/\s*,\s*/);
    }
    if (Array.isArray(table)) {
      return table.map((item) => this.parseKey(item)).join(",");
    } else if (typeof table === "object" && table !== null) {
      const data: string[] = [];
      for (const key of Object.keys(table)) {
        data.push(`${this.parseKey(key)} AS ${this.parseKey((table as Record<string, string>)[key])}`);
      }
      return data.join(",");
    }
    return "";
  }

  getLogic(logic?: string | Record<string, unknown>, _default = "AND"): string {
    const list = ["AND", "OR", "XOR"];
    if (logic && typeof logic === "object") {
      const _logic = (logic as Record<string, unknown>)._logic;
      delete (logic as Record<string, unknown>)._logic;
      logic = _logic as string;
    }
    if (!logic || typeof logic !== "string") return _default;
    logic = logic.toUpperCase();
    if (list.includes(logic)) return logic;
    return _default;
  }

  parseKey(key: string): string {
    return key;
  }

  parseValue(value: unknown, params?: unknown[]): unknown {
    if (value === null) {
      if (params) {
        params.push(null);
        return "?";
      }
      return "null";
    }
    if (typeof value === "string") {
      if (params) {
        params.push(value);
        return "?";
      }
      return `'${this.escapeString(value)}'`;
    }
    if (Array.isArray(value)) {
      if (/^exp$/i.test(value[0] as string)) {
        return value[1];
      }
      return value.map((item) => this.parseValue(item, params));
    }
    if (typeof value === "boolean") {
      if (params) {
        params.push(value ? 1 : 0);
        return "?";
      }
      return value ? "1" : "0";
    }
    if (value instanceof Buffer) {
      if (params) {
        params.push(value);
        return "?";
      }
      return `X'${value.toString("hex")}'`;
    }
    if (params) {
      params.push(value);
      return "?";
    }
    return value;
  }

  escapeString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/'/g, "''");
  }

  parseSql(sql: string, options: ParseOptions): string {
    const replacements: Record<string, () => string> = {
      "%EXPLAIN%": () => this.parseExplain(options.explain),
      "%DISTINCT%": () => this.parseDistinct(options.distinct),
      "%FIELD%": () => this.parseField(options.field, options),
      "%TABLE%": () => this.parseTable(options.table, options),
      "%JOIN%": () => this.parseJoin(options.join),
      "%WHERE%": () => this.parseWhere(options.where, options.params),
      "%GROUP%": () => this.parseGroup(options.group),
      "%HAVING%": () => this.parseHaving(options.having),
      "%ORDER%": () => this.parseOrder(options.order),
      "%LIMIT%": () => this.parseLimit(options.limit),
      "%UNION%": () => this.parseUnion(options.union, options.params),
      "%LOCK%": () => this.parseLock(options.lock),
      "%COMMENT%": () => this.parseComment(options.comment),
    };

    for (const [key, fn] of Object.entries(replacements)) {
      sql = sql.replace(key, fn());
    }
    return sql;
  }

  buildSelectSql(options: ParseOptions): string {
    const builder = () => {
      const sql = "%EXPLAIN%SELECT%DISTINCT% %FIELD% FROM %TABLE%%JOIN%%WHERE%%GROUP%%HAVING%%ORDER%%LIMIT%%UNION%%LOCK%%COMMENT%";
      return this.parseSql(sql, options);
    };
    if (options.params) return builder();
    return this.getCachedSql(this.buildCacheKey("S", options), builder);
  }

  buildInsertSql(options: ParseOptions): string {
    const builder = () => {
      const table = this.parseTable(options.table);
      let sql = options.replace ? "REPLACE" : "INSERT";
      if (sql === "INSERT" && options.ignore) {
        sql += " IGNORE";
      }
      const fieldStr = options.field ? `(${options.field})` : "";
      const insertSql = `${sql} INTO ${table}${fieldStr}`;
      if (options.params && options.params.length > 0 && !options.values) {
        const placeholders = options.params.map(() => "?").join(",");
        const lock = this.parseLock(options.lock);
        const comment = this.parseComment(options.comment);
        return `${insertSql} VALUES (${placeholders})${lock}${comment}`;
      }
      if (typeof options.values === "string") {
        let values = options.values;
        if (values[0] !== "(") values = `(${values})`;
        const lock = this.parseLock(options.lock);
        const comment = this.parseComment(options.comment);
        return `${insertSql} VALUES ${values}${lock}${comment}`;
      }
      return `${insertSql} ${this.buildSelectSql(options.values as Record<string, unknown>)}`;
    };
    if (options.params) return builder();
    return this.getCachedSql(this.buildCacheKey("I", options), builder);
  }

  buildDeleteSql(options: ParseOptions): string {
    const builder = () => {
      const sql = "DELETE FROM %TABLE%%WHERE%%ORDER%%LIMIT%%LOCK%%COMMENT%";
      return this.parseSql(sql, options);
    };
    if (options.params) return builder();
    return this.getCachedSql(this.buildCacheKey("D", options), builder);
  }

  buildUpdateSql(data: Record<string, unknown>, options: ParseOptions): string {
    const builder = () => {
      const set = this.parseSet(data, options.params);
      const sql = `UPDATE %TABLE%${set}%WHERE%%ORDER%%LIMIT%%LOCK%%COMMENT%`;
      return this.parseSql(sql, options);
    };
    if (options.params) return builder();
    return this.getCachedSql(this.buildCacheKey("U", options, data), builder);
  }
}
