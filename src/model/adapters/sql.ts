import { SQL } from "bun";
import { LruCache } from "../../lru";
import { AbstractParser } from "../parser";
import { AbstractQuery, type SocketInterface } from "../query";
import { AbstractSchema, type FieldSchema } from "../schema";
import type { Model } from "../../model";
import { BunSQLSocket, sqlRaw } from "./sql/socket";

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

export interface BunSQLAdapterConfig {
  adapter: "sqlite" | "mysql" | "postgresql";
  connection?: string | Record<string, unknown>;
  prefix?: string;
  pagesize?: number;
  // Connection pool options (passed to bun:sql)
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
  [key: string]: unknown;
}

// ------------------------------------------------------------------
// Parser
// ------------------------------------------------------------------

class SQLitePgParser extends AbstractParser {
  parseKey(key: string): string {
    if (key.indexOf(".") > -1 || key.indexOf("(") > -1 || key === "*") return key;
    return `"${key}"`;
  }

  escapeString(str: string): string {
    return str.replace(/'/g, "''");
  }

  parseLimit(limit?: number[]): string {
    if (!limit || limit.length === 0) return "";
    if (limit.length === 1) return ` LIMIT ${limit[0]}`;
    // SQLite uses LIMIT offset,count
    return ` LIMIT ${limit[1]} OFFSET ${limit[0]}`;
  }
}

class MySQLParser extends AbstractParser {
  parseKey(key: string): string {
    if (key.indexOf(".") > -1 || key.indexOf("(") > -1 || key === "*") return key;
    return `\`${key}\``;
  }

  escapeString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
}

class PgParser extends SQLitePgParser {
  parseLimit(limit?: number[]): string {
    if (!limit || limit.length === 0) return "";
    if (limit.length === 1) return ` LIMIT ${limit[0]}`;
    // PostgreSQL uses LIMIT count OFFSET offset
    return ` LIMIT ${limit[1]} OFFSET ${limit[0]}`;
  }
}

// ------------------------------------------------------------------
// Query
// ------------------------------------------------------------------

class BunSQLQuery extends AbstractQuery {
  config: BunSQLAdapterConfig;

  constructor(config: BunSQLAdapterConfig) {
    super(config);
    this.config = config;
  }

  socket(_sql?: string | Record<string, unknown>): SocketInterface {
    return BunSQLSocket.getInstance(this.config);
  }

  async execute(sqlOptions: string | { sql: string }, connection?: unknown): Promise<{ affectedRows: number; insertId?: number }> {
    const result = await super.execute(sqlOptions, connection);
    if (result.insertId) {
      this.lastInsertId = result.insertId;
    }
    return result;
  }
}

// ------------------------------------------------------------------
// Schema
// ------------------------------------------------------------------

const SCHEMA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const schemaCache = new LruCache<{ schema: Record<string, FieldSchema>; expires: number }>(128);

export function invalidateSchemaCache(table?: string): void {
  if (table) {
    schemaCache.delete(table);
  } else {
    schemaCache.clear();
  }
}

class BunSQLSchema extends AbstractSchema {
  private adapter: string;
  private sql: SQL;

  constructor(config: BunSQLAdapterConfig, schema: Record<string, FieldSchema> = {}, table: string) {
    super(config, schema, table);
    this.adapter = config.adapter;
    this.sql = BunSQLSocket.getInstance(config).instance;
  }

  /** Validate and quote a table identifier */
  private quoteIdentifier(name: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new Error(`Invalid table name: ${name}`);
    }
    return this.adapter === "mysql" ? `\`${name}\`` : `"${name}"`;
  }

  /** Escape a string literal */
  private escapeString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  async getSchema(table?: string): Promise<Record<string, FieldSchema>> {
    const t = table ?? this.table;
    const cached = schemaCache.get(t);
    if (cached) {
      if (Date.now() < cached.expires) return cached.schema;
      schemaCache.delete(t);
    }
    let schema: Record<string, FieldSchema> = {};
    if (this.adapter === "sqlite") {
      const rows = (await sqlRaw(this.sql, `PRAGMA table_info(${this.quoteIdentifier(t)})`)) as Array<{ name: string; type: string; dflt_value: unknown | null; notnull: number; pk: number }>;
      for (const row of rows) {
        schema[row.name] = {
          type: row.type,
          tinyType: this._extractTinyType(row.type),
          default: row.dflt_value ?? "",
          readonly: row.pk === 1,
          isPk: row.pk === 1,
        };
      }
    } else if (this.adapter === "mysql") {
      const rows = (await sqlRaw(
        this.sql,
        `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT, COLUMN_KEY, COLUMN_COMMENT, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${this.escapeString(t)}`
      )) as Array<{ COLUMN_NAME: string; DATA_TYPE: string; COLUMN_DEFAULT: unknown | null; COLUMN_KEY: string; COLUMN_COMMENT: string; EXTRA: string }>;
      for (const row of rows) {
        schema[row.COLUMN_NAME] = {
          type: row.DATA_TYPE,
          tinyType: this._extractTinyType(row.DATA_TYPE),
          default: row.COLUMN_DEFAULT ?? "",
          readonly: row.COLUMN_KEY === "PRI" || row.EXTRA === "auto_increment",
          isPk: row.COLUMN_KEY === "PRI",
          comment: row.COLUMN_COMMENT,
        };
      }
    } else if (this.adapter === "postgresql") {
      const rows = (await sqlRaw(
        this.sql,
        `SELECT c.column_name, c.data_type, c.column_default, c.ordinal_position, pgd.description FROM information_schema.columns c LEFT JOIN pg_catalog.pg_statio_all_tables AS st ON st.schemaname = c.table_schema AND st.relname = c.table_name LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position WHERE c.table_name = ${this.escapeString(t)}`
      )) as Array<{ column_name: string; data_type: string; column_default: unknown | null; ordinal_position: number; description: string | null }>;
      const pkRows = (await sqlRaw(
        this.sql,
        `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = ${this.escapeString(t)}`
      )) as Array<{ column_name: string }>;
      const pkSet = new Set(pkRows.map((r) => r.column_name));
      for (const row of rows) {
        schema[row.column_name] = {
          type: row.data_type,
          tinyType: this._extractTinyType(row.data_type),
          default: row.column_default ?? "",
          readonly: pkSet.has(row.column_name),
          isPk: pkSet.has(row.column_name),
          comment: row.description ?? undefined,
        };
      }
    }
    schemaCache.set(t, { schema, expires: Date.now() + SCHEMA_CACHE_TTL });
    return schema;
  }

  async getTableComment(table?: string): Promise<string | undefined> {
    const t = table ?? this.table;
    if (this.adapter === "mysql") {
      const rows = (await sqlRaw(
        this.sql,
        `SELECT TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${this.escapeString(t)}`
      )) as Array<{ TABLE_COMMENT: string }>;
      return rows[0]?.TABLE_COMMENT;
    }
    if (this.adapter === "postgresql") {
      const rows = (await sqlRaw(
        this.sql,
        `SELECT obj_description(${this.escapeString(t)}::regclass, 'pg_class') AS comment`
      )) as Array<{ comment: string | null }>;
      return rows[0]?.comment ?? undefined;
    }
    return undefined;
  }

  parseType(tinyType: string | undefined, value: unknown): unknown {
    if (!tinyType) return value;
    if (tinyType === "enum" || tinyType === "set" || tinyType === "bigint") return value;
    if (tinyType.indexOf("int") > -1) return parseInt(String(value), 10);
    if (["double", "float", "decimal", "real", "numeric"].includes(tinyType)) return parseFloat(String(value));
    if (tinyType === "bool" || tinyType === "boolean") return value ? 1 : 0;
    return value;
  }

  private _extractTinyType(type: string): string {
    const pos = type.indexOf("(");
    return (pos === -1 ? type : type.slice(0, pos)).toLowerCase().trim();
  }
}

// ------------------------------------------------------------------
// Adapter Class (matching thinkjs Abstract pattern)
// ------------------------------------------------------------------

export function createSQLAdapter(config: BunSQLAdapterConfig): new (model: Model, options?: Record<string, unknown>) => BunSQLAdapterInstance {
  const ParserClass = config.adapter === "mysql" ? MySQLParser : config.adapter === "postgresql" ? PgParser : SQLitePgParser;
  class BunSQLAdapter {
    parser: AbstractParser;
    query: AbstractQuery;
    schema: AbstractSchema;
    lastSql = "";
    constructor(_model: Model, options: Record<string, unknown> = {}) {
      const cfg = { ...config, ...options };
      this.parser = options.parser ? (options.parser as AbstractParser) : new ParserClass(cfg);
      const queryInstance = new (class extends BunSQLQuery {
        constructor(c: Record<string, unknown>) {
          super(c as BunSQLAdapterConfig);
        }
      })(cfg);
      this.query = options.query ? (options.query as AbstractQuery) : queryInstance;
      const schemaInstance = new (class extends BunSQLSchema {
        constructor(c: Record<string, unknown>, s: Record<string, FieldSchema>, t: string) {
          super(c as BunSQLAdapterConfig, s, t);
        }
      })(cfg, {}, _model.tableName);
      this.schema = options.schema ? (options.schema as AbstractSchema) : schemaInstance;
      this.query.parser = this.parser;
      this.query.schema = this.schema;
      this.parser.query = this.query;
      this.parser.schema = this.schema;
      this.schema.query = this.query;
      this.schema.parser = this.parser;
    }
  }
  return BunSQLAdapter as unknown as new (model: Model, options?: Record<string, unknown>) => BunSQLAdapterInstance;
}

export interface BunSQLAdapterInstance {
  parser: AbstractParser;
  query: AbstractQuery;
  schema: AbstractSchema;
}
