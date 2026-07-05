import type { ThinkContext } from "../types";
import type { ModelConfig } from "../model";

export interface ColumnDSL {
  name: string;
  type: string;
  label?: string;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  nullable?: boolean;
  default?: unknown | (() => unknown);
  unique?: boolean;
  index?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  comment?: string;
  hidden?: boolean;
  options?: Array<string | { label: string; value: unknown }>;
  validations?: Array<{ method: string; args?: unknown[]; message?: string }>;
}

export interface RelationDSL {
  type: "hasOne" | "hasMany" | "belongsTo" | "manyToMany";
  model: string;
  /** Local key (own column) used for the relation. */
  key?: string;
  /** Alias for `key`. */
  localKey?: string;
  /** Foreign key on the related model. */
  foreign?: string;
  /** Alias for `foreign`. */
  foreignKey?: string;
  /** Pivot/junction model for manyToMany. */
  through?: string;
  /** Optional fields to select from related model. */
  field?: string | string[];
  /** Optional order for hasMany relations. */
  order?: string | string[] | Record<string, string>;
  /** Optional limit for hasMany relations. */
  limit?: number | number[];
  /** Optional page for hasMany relations. */
  page?: number | number[];
  /** Optional extra where for related queries. */
  where?: Record<string, unknown>;
}

export interface DataResourceMeta {
  /** Resource code, defaults to model name. */
  resourceCode?: string;
  /** Tenant field name, defaults to "tenant_id". */
  tenantField?: string;
  /** Owner/user field for "self" scope. */
  ownerField?: string;
  /** Department field for "dept" scope. */
  deptField?: string;
  /** Agent field for "agent_tree" scope. */
  agentField?: string;
  /** Region field for custom regional scope. */
  regionField?: string;
}

export interface ModelDSL {
  name: string;
  table: string;
  comment?: string;
  primaryKey?: string;
  columns: ColumnDSL[];
  relations?: Record<string, RelationDSL>;
  indexes?: IndexDSL[];
  option?: {
    timestamps?: boolean;
    softDeletes?: boolean;
  };
  dataResource?: DataResourceMeta;
}

export interface IndexDSL {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface AclRuleDSL {
  allow?: Array<"select" | "find" | "add" | "update" | "delete">;
  deny?: Array<"select" | "find" | "add" | "update" | "delete">;
  readable?: string[] | null;
  writable?: string[] | null;
  scope?: Record<string, unknown>;
}

export interface AclDSL {
  roles?: string[];
  rules: Record<string, Record<string, AclRuleDSL> | ((ctx: ThinkContext) => AclRuleDSL)>;
}

export type ServiceHookName =
  | "beforeCreate" | "afterCreate"
  | "beforeUpdate" | "afterUpdate"
  | "beforeDelete" | "afterDelete"
  | "beforeFind" | "afterFind" | "afterGet"
  | "beforeList" | "afterList";

export interface ServiceHooks {
  [key: string]: unknown;
  beforeCreate?: (ctx: ThinkContext, data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  afterCreate?: (ctx: ThinkContext, record: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeUpdate?: (ctx: ThinkContext, id: unknown, data: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  afterUpdate?: (ctx: ThinkContext, record: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeDelete?: (ctx: ThinkContext, id: unknown) => Promise<void> | void;
  afterDelete?: (ctx: ThinkContext, result: unknown) => Promise<unknown> | unknown;
  beforeFind?: (ctx: ThinkContext, id: unknown) => Promise<unknown> | unknown;
  afterFind?: (ctx: ThinkContext, record: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeList?: (ctx: ThinkContext, query: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>[];
  afterList?: (ctx: ThinkContext, list: Record<string, unknown>[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];
}

export interface ApiRouteDSL {
  path: string;
  method: string;
  handler: string;
  guard?: string;
}

export interface ApiDSL {
  routes: ApiRouteDSL[];
}

export interface TableColumnDSL {
  field: string;
  title: string;
  width?: number;
  render?: string | ((ctx: ThinkContext, row: Record<string, unknown>) => unknown);
  renderProps?: Record<string, unknown>;
  format?: string;
  sortable?: boolean;
  hidden?: boolean;
}

export interface TableActionDSL {
  type?: string;
  title: string;
  icon?: string;
  confirm?: string;
  handler?: string;
}

export interface TableSearchFieldDSL {
  field: string;
  title: string;
  type?: string;
  operator?: string;
  options?: Array<{ label: string; value: unknown }>;
}

export interface TableFormFieldDSL {
  field: string;
  title: string;
  type?: string;
  required?: boolean;
  options?: Array<{ label: string; value: unknown }>;
  rules?: string[];
}

export interface TableFormGroupDSL {
  title: string;
  columns?: number;
  fields: TableFormFieldDSL[];
}

export interface TableFormModeDSL {
  fields: string[];
  readonly?: string[];
  hidden?: string[];
}

export interface TableDSL {
  title: string;
  model: string;
  list?: {
    columns?: TableColumnDSL[];
    orderBy?: { field: string; direction?: "asc" | "desc" };
    pageSize?: number;
    rowActions?: TableActionDSL[];
    headerActions?: TableActionDSL[];
    batchActions?: TableActionDSL[];
    beforeQuery?: (ctx: ThinkContext, query: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  };
  search?: {
    fields?: TableSearchFieldDSL[];
    showCount?: number;
    collapsed?: boolean;
  };
  form?: {
    groups?: TableFormGroupDSL[];
    modes?: {
      create?: TableFormModeDSL;
      edit?: TableFormModeDSL;
      view?: TableFormModeDSL;
    };
  };
}

export interface DslModelEntry {
  name: string;
  path: string;
  dsl: ModelDSL;
  modelConfig: ModelConfig & ModelDSL;
}

export interface DslServiceEntry {
  name: string;
  path: string;
  hooks: ServiceHooks;
}

export interface DslApiEntry {
  name: string;
  path: string;
  routes: ApiRouteDSL[];
}

export interface DslTableEntry {
  name: string;
  path: string;
  table: TableDSL;
}

export interface DslAclEntry {
  name: string;
  path: string;
  acl: AclDSL | ((ctx: ThinkContext) => AclRuleDSL);
}

export interface DslAppData {
  models: Record<string, DslModelEntry>;
  services: Record<string, DslServiceEntry>;
  apis: Record<string, DslApiEntry>;
  tables: Record<string, DslTableEntry>;
  acls: Record<string, DslAclEntry>;
  dataResources: Record<string, DataResourceMeta & { modelName: string }>;
}
