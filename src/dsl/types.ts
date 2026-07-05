/**
 * DSL type helpers — `t.string()`, `t.bigint()`, etc.
 * Each function returns a `ColumnDefinition` that carries both
 * SQL-level metadata and TypeScript type information.
 */

export interface ColumnDefinition<T = unknown> {
  /** SQL column type name */
  readonly _sqlType: string;
  /** TypeScript type tag (phantom) */
  readonly _tsType?: T;
  /** Column name override (default: field name) */
  readonly columnName?: string;
  /** SQL type params (length, precision, scale) */
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  /** Constraints */
  readonly primary: boolean;
  readonly required: boolean;
  readonly unique: boolean;
  readonly autoIncrement: boolean;
  readonly index: boolean;
  readonly nullable: boolean;
  /** ENUM values */
  readonly enumValues?: readonly string[];
  /** Default value */
  readonly defaultValue?: unknown;
  /** Comment */
  readonly comment?: string;
}

type ColumnInit = Partial<Omit<ColumnDefinition, "_sqlType" | "_tsType">>;

function col<T>(sqlType: string, init?: ColumnInit): ColumnDefinition<T> {
  return {
    _sqlType: sqlType,
    primary: false, required: false, unique: false,
    autoIncrement: false, index: false, nullable: false,
    ...init,
  };
}

// ── Type helpers ──

export const t = {
  /** VARCHAR(n) — maps to TypeScript string */
  string: (length = 255, init?: ColumnInit) =>
    col<string>("varchar", { length, ...init }),

  /** TEXT — maps to TypeScript string */
  text: (init?: ColumnInit) =>
    col<string>("text", init),

  /** BIGINT — maps to TypeScript bigint/number */
  bigint: (columnName?: string) =>
    col<bigint>("bigint", { columnName }),

  /** INT — maps to TypeScript number */
  integer: (init?: ColumnInit) =>
    col<number>("int", init),

  /** BOOLEAN / TINYINT(1) — maps to TypeScript boolean */
  boolean: (init?: ColumnInit) =>
    col<boolean>("boolean", init),

  /** DECIMAL(precision, scale) — maps to TypeScript number */
  decimal: (precision = 10, scale = 2, init?: ColumnInit) =>
    col<number>("decimal", { precision, scale, ...init }),

  /** TIMESTAMP / DATETIME — maps to TypeScript Date */
  timestamp: (columnName?: string) =>
    col<Date>("timestamp", { columnName }),

  /** DATE — maps to TypeScript Date */
  date: (init?: ColumnInit) =>
    col<Date>("date", init),

  /** ENUM(values) — maps to TypeScript union */
  enum: <T extends readonly string[]>(values: T, init?: ColumnInit) =>
    col<T[number]>("enum", { enumValues: values, ...init }),

  /** JSON — maps to TypeScript Record/object */
  json: <T = Record<string, unknown>>(init?: ColumnInit) =>
    col<T>("json", init),
};

export function required<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, required: true, nullable: false };
}

/** Make a column nullable */
export function optional<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, nullable: true, required: false };
}

/** Mark as primary key */
export function primary<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, primary: true, required: true };
}

/** Auto-increment (for PK) */
export function autoIncrement<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, autoIncrement: true };
}

/** Add UNIQUE constraint */
export function unique<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, unique: true };
}

/** Add INDEX */
export function index<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, index: true };
}

/** Set default value */
export function defaultTo<T>(value: T): (col: ColumnDefinition<T>) => ColumnDefinition<T> {
  return (col) => ({ ...col, defaultValue: value });
}

/** Set default to CURRENT_TIMESTAMP */
export function defaultNow<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, defaultValue: "CURRENT_TIMESTAMP" };
}

/** Set ON UPDATE CURRENT_TIMESTAMP */
export function onUpdateNow<T>(col: ColumnDefinition<T>): ColumnDefinition<T> {
  return { ...col, comment: `${col.comment ?? ""} ON UPDATE CURRENT_TIMESTAMP`.trim() };
}

/** Add column comment */
export function comment<T>(text: string): (col: ColumnDefinition<T>) => ColumnDefinition<T> {
  return (col) => ({ ...col, comment: text });
}
