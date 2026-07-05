import type { AbstractParser, ParseOptions } from "./parser";
import type { AbstractQuery } from "./query";
import type { AbstractSchema, FieldSchema } from "./schema";
import type { AclConfig } from "../acl";
import { Relation, type RelationConfig } from "./relation";
import { LruCache } from "../lru";

export const DB = Symbol("think-model-db");
export const RELATION = Symbol("think-model-relation");
export const MODELS = Symbol("think-models");
export const SCHEMA_CACHE = new LruCache<Record<string, FieldSchema>>(256);
export interface ModelConfig {
  handle?: new (model: ModelCore, options?: Record<string, unknown>) => AdapterInstance;
  prefix?: string;
  pagesize?: number;
  cache?: Record<string, unknown>;
  reuseDB?: boolean;
  [key: string]: unknown;
}

export interface AdapterInstance {
  parser: AbstractParser;
  query: AbstractQuery;
  schema: AbstractSchema;
}

export class ModelCore {
  static acl?: AclConfig;
  config: ModelConfig;
  modelName: string;
  options: ParseOptions;
  _pk = "id";
  protected _cacheConfig?: Record<string, unknown>;
  models: Record<string, new (name: string, config: ModelConfig) => ModelCore> = {};
  private [DB]?: AdapterInstance;
  private [RELATION]: Relation;
  protected _strict = false;
  private _schemaInfo?: Record<string, FieldSchema>;
  private _tableComment?: string;
  private _pkDetected?: string;

  constructor(modelName = "", config: ModelConfig = { handle: undefined as unknown as new () => AdapterInstance }) {
    if (typeof modelName === "object") {
      config = modelName as ModelConfig;
      modelName = "";
    }
    if (typeof config.handle !== "function") {
      throw new Error("config.handle must be a function");
    }
    this.config = config;
    this.modelName = modelName;
    this.options = {};
    this[RELATION] = new Relation(this as unknown as Record<string, unknown>);
  }

  db(): AdapterInstance;
  db(db: AdapterInstance): this;
  db(db?: AdapterInstance): AdapterInstance | this {
    if (db) {
      this[DB] = db;
      return this;
    }
    if (this[DB]) return this[DB];
    const Handle = this.config.handle!;
    const instance = new Handle(this);
    this[DB] = instance;
    return instance;
  }

  get tablePrefix(): string {
    return this.config.prefix ?? "";
  }

  get tableName(): string {
    return this.tablePrefix + this.modelName;
  }

  get pk(): string {
    return this._pk !== "id" ? this._pk : (this._pkDetected ?? "id");
  }
  get lastSql(): string {
    return this.db().query.lastSql;
  }
  /** Return an error augmented with the last executed SQL (development debugging). */
  createDbError(err: unknown, sql?: string): Error {
    const error = err instanceof Error ? err : new Error(String(err));
    const wrapped = new Error(`[DB] ${error.message}`) as Error & { sql?: string; cause?: Error };
    wrapped.sql = sql ?? this.lastSql;
    wrapped.cause = error;
    return wrapped;
  }
  strict(enable = true): this {
    this._strict = enable;
    return this;
  }

  /** Load schema info from database (cached globally by table name) */
  async getSchemaInfo(table?: string): Promise<Record<string, FieldSchema>> {
    const t = table ?? this.tableName;
    const cached = SCHEMA_CACHE.get(t);
    if (cached) return cached;
    const info = await this.db().schema.getSchema(t);
    SCHEMA_CACHE.set(t, info);
    return info;
  }

  /** Get field names from schema */
  async getSchemaFields(table?: string): Promise<string[]> {
    const info = await this.getSchemaInfo(table);
    return Object.keys(info);
  }

  /** Get table comment from database (cached) */
  async getTableComment(table?: string): Promise<string | undefined> {
    const t = table ?? this.tableName;
    if (this._tableComment === undefined) {
      this._tableComment = await this.db().schema.getTableComment(t);
    }
    return this._tableComment;
  }

  /** Get primary key from schema (falls back to _pk or "id") */
  async getPk(): Promise<string> {
    if (this._pk !== "id") return this._pk;
    if (this._pkDetected) return this._pkDetected;
    const info = await this.getSchemaInfo();
    for (const [name, field] of Object.entries(info)) {
      if (field.isPk) {
        this._pkDetected = name;
        return name;
      }
    }
    return "id";
  }

  /** Get full schema metadata summary */
  async getMeta(): Promise<{
    table: string;
    pk: string;
    fields: string[];
    comments: Record<string, string | undefined>;
    tableComment: string | undefined;
  }> {
    const [info, tComment] = await Promise.all([
      this.getSchemaInfo(),
      this.getTableComment(),
    ]);
    const pk = await this.getPk();
    const fields = Object.keys(info);
    const comments: Record<string, string | undefined> = {};
    for (const [name, field] of Object.entries(info)) {
      if (field.comment) comments[name] = field.comment;
    }
    return { table: this.tableName, pk, fields, comments, tableComment: tComment };
  }

  model(name: string): this {
    const ModelClass = this.models[name];
    const modelName = name;
    let instance: this;
    if (ModelClass) {
      instance = new (ModelClass as unknown as new (...args: unknown[]) => this)(modelName, this.config);
    } else {
      instance = new (this.constructor as new (...args: unknown[]) => this)(modelName, this.config);
    }
    instance.models = this.models;
    instance._cacheConfig = this._cacheConfig;
    instance._strict = this._strict;
    if (this.config.reuseDB) {
      instance.db(this.db());
    }
    return instance;
  }

  // ── Lifecycle hooks ──────────────────────────────────────────────
  beforeAdd(data: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
    return data;
  }

  afterAdd(data: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
    return this[RELATION].afterAdd(data);
  }

  beforeDelete(options: ParseOptions): ParseOptions | Promise<ParseOptions> {
    return options;
  }

  afterDelete(data: ParseOptions): ParseOptions | Promise<ParseOptions> {
    return this[RELATION].afterDelete(data);
  }

  beforeUpdate(data: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
    return data;
  }

  afterUpdate(data: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
    return this[RELATION].afterUpdate(data);
  }

  beforeFind(options: ParseOptions): ParseOptions | Promise<ParseOptions> {
    return options;
  }

  afterFind(data: Record<string, unknown>): Record<string, unknown> | Promise<Record<string, unknown>> {
    return this[RELATION].afterFind(data);
  }

  beforeSelect(options: ParseOptions): ParseOptions | Promise<ParseOptions> {
    return options;
  }

  async afterSelect(data: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    return this[RELATION].afterSelect(data);
  }

  async parseOptions(options?: ParseOptions | string | number): Promise<ParseOptions> {
    const pk = await this.getPk();
    if (typeof options === "number" || typeof options === "string") {
      options = String(options);
      const where: Record<string, unknown> = {
        [pk]: options.indexOf(",") > -1 ? { IN: options } : options,
      };
      options = { where };
    }
    options = { ...this.options, ...(options as ParseOptions) };
    this.options = {};
    options.table = options.table || this.tableName;
    options.tablePrefix = this.tablePrefix;
    options.pk = pk;
    if (options.field && options.fieldReverse) {
      const fieldVal = options.field;
      if (typeof fieldVal === "string" || Array.isArray(fieldVal)) {
        options.field = await this.db().schema.getReverseFields(fieldVal);
      }
      delete options.fieldReverse;
    }
    return options;
  }

  // ── Transaction ──────────────────────────────────────────────────
  startTrans(connection?: unknown): Promise<unknown> {
    return this.db().query.startTrans(connection);
  }

  commit(connection?: unknown): Promise<void> {
    return this.db().query.commit(connection);
  }

  rollback(connection?: unknown): Promise<void> {
    return this.db().query.rollback(connection);
  }

  transaction(fn: (connection: unknown) => Promise<unknown>, connection?: unknown): Promise<unknown> {
    return this.db().query.transaction(fn, connection);
  }

  setRelation(name: string, value: RelationConfig | null): this {
    this[RELATION].setRelation(name, value);
    return this;
  }

  async buildSelectSql(options?: ParseOptions, noParentheses = false): Promise<string> {
    options = await this.parseOptions(options);
    const sql = this.db().parser.buildSelectSql(options).trim();
    return noParentheses ? sql : `( ${sql} )`;
  }

  protected quoteField(field?: string): string {
    if (field) return this.db().parser.parseKey(field);
    return "*";
  }

  parseSql(sqlOptions: string | { sql: string }, ...args: unknown[]): { sql: string } {
    if (typeof sqlOptions === "string") {
      sqlOptions = { sql: sqlOptions };
    }
    if (args.length) {
      let i = 0;
      sqlOptions.sql = sqlOptions.sql.replace(/%s/g, () => String(args[i++]));
    }
    sqlOptions.sql = sqlOptions.sql.replace(
      /(?:^|\s)__([A-Z]+)__(?:$|\s)/g,
      (_a, b) => {
        if (b === "TABLE") {
          return ` ${this.quoteField(this.tableName)} `;
        }
        return ` ${this.quoteField(this.tablePrefix + b.toLowerCase())} `;
      }
    );
    return sqlOptions;
  }
}
