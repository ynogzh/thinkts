/**
 * Parser types extracted from parser.ts to avoid circular dependencies.
 */

export interface ParseOptions {
  explain?: boolean;
  field?: string | string[] | Record<string, string>;
  fieldReverse?: boolean;
  table?: string;
  tablePrefix?: string;
  alias?: string;
  join?: JoinItem[];
  where?: Record<string, unknown> | string;
  order?: string | string[] | Record<string, string>;
  group?: string | string[];
  having?: string;
  limit?: number[];
  union?: UnionItem[];
  distinct?: boolean | string;
  lock?: boolean | string;
  comment?: string;
  auto?: string;
  pk?: string;
  sql?: string;
  values?: string | Record<string, unknown>;
  replace?: boolean;
  ignore?: boolean;
  update?: boolean | string[] | Record<string, unknown>;
  /** Mutable array for parameterized query values. When provided, parser methods
   *  will push values here and return `?` placeholders instead of inline values. */
  params?: unknown[];
  [key: string]: unknown;
}

export interface JoinItem {
  table: string;
  join?: string;
  as?: string;
  on?: Record<string, unknown> | string | string[];
}

export interface UnionItem {
  union: string | Record<string, unknown>;
  all?: boolean;
}
