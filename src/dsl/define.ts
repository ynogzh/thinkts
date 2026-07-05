import type { ColumnDefinition } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cols = Record<string, ColumnDefinition<any>>;

/** Extract the TypeScript row type from column definitions. */
export type RowOf<T extends Cols> = {
  [K in keyof T]: T[K] extends ColumnDefinition<infer V> ? V : never;
};

export interface ModelAcl {
  read?: string[];
  write?: string[];
  delete?: string[];
}

export type BeforeHook<T extends Cols> = (
  data: Partial<RowOf<T>>, ctx: unknown,
) => Partial<RowOf<T>> | Promise<Partial<RowOf<T>>>;

export type AfterHook<T extends Cols> = (
  record: RowOf<T>, ctx: unknown,
) => RowOf<T> | Promise<RowOf<T>>;

export interface ModelHooks<T extends Cols> {
  beforeCreate?: BeforeHook<T>;
  afterCreate?: AfterHook<T>;
  beforeUpdate?: BeforeHook<T>;
  afterUpdate?: AfterHook<T>;
  beforeDelete?: (record: RowOf<T>, ctx: unknown) => void | Promise<void>;
}

export interface ModelDefinition<T extends Cols = Cols> {
  readonly tableName: string;
  readonly columns: T;
  readonly primaryKey: string;
  readonly acl?: ModelAcl;
  readonly hooks?: ModelHooks<T>;
}

/**
 * Define a database model with full TypeScript type inference.
 *
 * ```ts
 * const Device = defineModel("iotbiz_device", {
 *   columns: { id: t.bigint(), name: t.string(128) },
 *   hooks: {
 *     beforeCreate(data, ctx) { return data; }, // data is typed
 *   },
 * });
 * type DeviceRow = RowOf<typeof Device.columns>;
 * ```
 */
export function defineModel<T extends Cols>(
  tableName: string,
  def: { columns: T; primaryKey?: string; acl?: ModelAcl; hooks?: ModelHooks<T> },
): ModelDefinition<T> {
  const primaryKey = def.primaryKey
    ?? Object.entries(def.columns).find(([, c]) => c.primary)?.[0]
    ?? "id";
  return { tableName, columns: def.columns, primaryKey, acl: def.acl, hooks: def.hooks };
}

/** Convert ModelDefinition to model.json compatible object for the DSL loader. */
export function toDslConfig<T extends Cols>(model: ModelDefinition<T>): Record<string, unknown> {
  const columns = Object.entries(model.columns).map(([name, col]) => {
    const entry: Record<string, unknown> = {
      name: col.columnName ?? name, type: col._sqlType, label: name,
    };
    if (col.primary) entry.primary = true;
    if (col.required) entry.required = true;
    if (col.nullable) entry.nullable = true;
    if (col.unique) entry.unique = true;
    if (col.autoIncrement) entry.autoIncrement = true;
    if (col.index) entry.index = true;
    if (col.length !== undefined) entry.length = col.length;
    if (col.precision !== undefined) entry.precision = col.precision;
    if (col.scale !== undefined) entry.scale = col.scale;
    if (col.enumValues) entry.enum = col.enumValues;
    if (col.defaultValue !== undefined) entry.default = col.defaultValue;
    if (col.comment) entry.comment = col.comment;
    return entry;
  });
  return {
    name: model.tableName, table: model.tableName, primaryKey: model.primaryKey,
    columns, option: { timestamps: true, softDeletes: false },
  };
}
