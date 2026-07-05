import type { AbstractParser } from "./parser";
import type { AbstractSchema } from "./schema";
import type { ParseOptions } from "./parser";
import { thinkCache } from "../cache";

export interface SocketInterface {
  query(sql: string | { sql: string; params?: unknown[] }, connection?: unknown): Promise<unknown[]>;
  execute(sql: string | { sql: string; params?: unknown[] }, connection?: unknown): Promise<{ affectedRows: number; insertId?: number }>;
  startTrans(connection?: unknown): Promise<unknown>;
  commit(connection?: unknown): Promise<void>;
  rollback(connection?: unknown): Promise<void>;
  transaction(fn: (connection: unknown) => Promise<unknown>, connection?: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export abstract class AbstractQuery {
  config: Record<string, unknown>;
  lastSql = "";
  lastInsertId = 0;
  parser!: AbstractParser;
  schema!: AbstractSchema;
  private connection?: unknown;

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
  }

  abstract socket(sql?: string | Record<string, unknown>): SocketInterface;

  query(sqlOptions: string | { sql: string; params?: unknown[] }, connection = this.connection): Promise<unknown[]> {
    const sql = typeof sqlOptions === "string" ? sqlOptions : sqlOptions.sql;
    this.lastSql = sql;
    return this.socket(sql).query(sqlOptions, connection);
  }

  execute(sqlOptions: string | { sql: string; params?: unknown[] }, connection = this.connection): Promise<{ affectedRows: number; insertId?: number }> {
    const sql = typeof sqlOptions === "string" ? sqlOptions : sqlOptions.sql;
    this.lastSql = sql;
    return this.socket(sql).execute(sqlOptions, connection);
  }

  add(data: Record<string, unknown>, options: ParseOptions = {}): Promise<number> {
    const parser = this.parser;
    const params: unknown[] = [];
    const fields: string[] = [];
    for (const key of Object.keys(data)) {
      params.push(data[key]);
      fields.push(parser.parseKey(key));
    }

    if (options.update === true) {
      options.update = fields;
    } else if (Array.isArray(options.update)) {
      options.update = options.update.filter((field) => fields.includes(field));
    } else if (options.update && typeof options.update === "object") {
      for (const key of Object.keys(options.update as Record<string, unknown>)) {
        if (fields.includes(key)) continue;
        delete (options.update as Record<string, unknown>)[key];
      }
    }

    options.field = fields.join(",");
    options.params = params;
    const sql = this.parser.buildInsertSql(options);
    return this.execute({ sql, params }).then(() => this.lastInsertId);
  }

  addMany(data: Record<string, unknown>[], options: ParseOptions = {}): Promise<number[]> {
    const parser = this.parser;
    let fields = Object.keys(data[0]);
    const params: unknown[] = [];
    const valueGroups: string[] = [];
    for (const item of data) {
      const group: string[] = [];
      for (const key of fields) {
        params.push(item[key]);
        group.push("?");
      }
      valueGroups.push(`(${group.join(",")})`);
    }

    fields = fields.map((field) => parser.parseKey(field));

    if (options.update === true) {
      options.update = fields;
    } else if (Array.isArray(options.update)) {
      options.update = options.update.filter((field) => fields.includes(field));
    } else if (options.update && typeof options.update === "object") {
      for (const key of Object.keys(options.update as Record<string, unknown>)) {
        if (fields.includes(key)) continue;
        delete (options.update as Record<string, unknown>)[key];
      }
    }

    options.field = fields.join(",");
    options.values = valueGroups.join(",");
    options.params = params;
    const sql = this.parser.buildInsertSql(options);
    return this.execute({ sql, params }).then(() => {
      const base = this.lastInsertId;
      if (!base) return data.map(() => 0);
      // Best-effort: assumes contiguous auto-increment PK.
      return data.map((_item, index) => base + index);
    });
  }

  selectAdd(fields: string[], table: string, options: ParseOptions): Promise<unknown> {
    const parser = this.parser;
    const parsedFields = fields.map((item) => parser.parseKey(item));
    const sql = this.parser.buildInsertSql({
      table,
      field: parsedFields.join(","),
      values: options,
      replace: options.replace,
      ignore: options.ignore,
    });
    return this.execute(sql);
  }

  delete(options: ParseOptions): Promise<unknown> {
    const params: unknown[] = [];
    options.params = params;
    const sql = this.parser.buildDeleteSql(options);
    return this.execute({ sql, params });
  }

  update(data: Record<string, unknown>, options: ParseOptions): Promise<unknown> {
    const params: unknown[] = [];
    options.params = params;
    const sql = this.parser.buildUpdateSql(data, options);
    return this.execute({ sql, params });
  }
  select(options: ParseOptions | string, cache?: Record<string, unknown>): Promise<unknown[]> {
    let sql: string;
    let params: unknown[] | undefined;
    if (typeof options === "object" && "sql" in options && options.sql) {
      sql = options.sql;
      cache = cache ?? (options.cache as Record<string, unknown> | undefined);
    } else if (typeof options === "string") {
      sql = options;
    } else {
      params = [];
      options.params = params;
      sql = this.parser.buildSelectSql(options);
      cache = cache ?? (options.cache as Record<string, unknown> | undefined);
    }
    if (!cache) return this.query(params ? { sql, params } : sql);
    const cacheKey = (cache.key as string) || sql;
    const timeout = (cache._keyTimeout as number) || (cache.timeout as number);
    return thinkCache(cacheKey, async () => this.query(params ? { sql, params } : sql), { timeout }) as Promise<unknown[]>;
  }

  startTrans(connection?: unknown): Promise<unknown> {
    return this.socket("START TRANSACTION").startTrans(connection).then((conn) => {
      this.connection = conn;
      return conn;
    });
  }

  commit(connection = this.connection): Promise<void> {
    return this.socket("COMMIT").commit(connection);
  }

  rollback(connection = this.connection): Promise<void> {
    return this.socket("ROLLBACK").rollback(connection);
  }

  transaction(fn: (connection: unknown) => Promise<unknown>, connection?: unknown): Promise<unknown> {
    return this.socket("START TRANSACTION").transaction((conn) => {
      this.connection = conn;
      return fn(conn);
    }, connection);
  }

  close(): Promise<void> {
    return this.socket().close();
  }
}
