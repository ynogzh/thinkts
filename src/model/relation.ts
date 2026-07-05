export const HAS_ONE = 1;
export interface ModelQuery {
  where(where: Record<string, unknown> | string): ModelQuery;
  field(field: string | string[] | Record<string, string> | undefined): ModelQuery;
  order(order: string | string[] | Record<string, string> | undefined): ModelQuery;
  limit(offset: number | number[], length?: number): ModelQuery;
  page(page: number | number[], listRows?: number): ModelQuery;
  find(): Promise<Record<string, unknown>>;
  select(): Promise<Record<string, unknown>[]>;
}
export const HAS_MANY = 2;
export const BELONG_TO = 3;
export const MANY_TO_MANY = 4;

export interface RelationConfig {
  type: number;
  model: string;
  key?: string;
  fKey?: string;
  rModel?: string;
  rfKey?: string;
  where?: Record<string, unknown>;
  field?: string | string[];
  order?: string | string[] | Record<string, string>;
  limit?: number | number[];
  page?: number | number[];
}

export class Relation {
  private model: Record<string, unknown>;
  private relations: Map<string, RelationConfig> = new Map();

  constructor(model: Record<string, unknown>) {
    this.model = model;
  }

  setRelation(name: string, value: RelationConfig | null): void {
    if (value === null) {
      this.relations.delete(name);
      return;
    }
    this.relations.set(name, value);
  }

  getRelation(name: string): RelationConfig | undefined {
    return this.relations.get(name);
  }

  async afterFind(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!data || Object.keys(data).length === 0) return data;
    for (const [name, rel] of this.relations) {
      data[name] = await this.getRelationData(rel, data, true);
    }
    return data;
  }

  async afterSelect(data: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    if (!data.length) return data;
    const modelFn = (name: string) => (this.model as { model(name: string): ModelQuery }).model(name);

    for (const [name, rel] of this.relations) {
      const { key, fKey } = this.resolveKeys(rel);
      const keys = [...new Set(data.map((item) => item[key]).filter((v) => v !== undefined && v !== null))];
      if (!keys.length) continue;

      const relModel = modelFn(rel.model);
      switch (rel.type) {
        case BELONG_TO: {
          const rows = (await relModel.where({ [fKey]: { IN: keys } }).field(rel.field).select()) as Record<string, unknown>[];
          const map = new Map(rows.map((r) => [String(r[fKey]), r]));
          for (const item of data) item[name] = map.get(String(item[key])) ?? null;
          break;
        }
        case HAS_ONE: {
          const rows = (await relModel.where({ [fKey]: { IN: keys } }).field(rel.field).select()) as Record<string, unknown>[];
          const map = new Map<string, Record<string, unknown>>();
          for (const r of rows) {
            const fk = String(r[fKey]);
            if (!map.has(fk)) map.set(fk, r);
          }
          for (const item of data) item[name] = map.get(String(item[key])) ?? null;
          break;
        }
        case HAS_MANY: {
          let query = relModel.where({ [fKey]: { IN: keys } }).field(rel.field).order(rel.order);
          if (rel.limit) {
            if (Array.isArray(rel.limit)) query = query.limit(rel.limit[0], rel.limit[1]);
            else query = query.limit(rel.limit);
          }
          if (rel.page) {
            if (Array.isArray(rel.page)) query = query.page(rel.page[0], rel.page[1]);
            else query = query.page(rel.page);
          }
          const rows = (await query.select()) as Record<string, unknown>[];
          const groups = new Map<string, Record<string, unknown>[]>();
          for (const r of rows) {
            const fk = String(r[fKey]);
            if (!groups.has(fk)) groups.set(fk, []);
            groups.get(fk)!.push(r);
          }
          for (const item of data) item[name] = groups.get(String(item[key])) ?? [];
          break;
        }
        default:
          for (const item of data) {
            item[name] = await this.getRelationData(rel, item, false);
          }
      }
    }
    return data;
  }

  async afterAdd(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return data;
  }

  async afterUpdate(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return data;
  }

  async afterDelete(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return data;
  }

  private resolveKeys(rel: RelationConfig): { key: string; fKey: string } {
    const modelName = String((this.model as Record<string, unknown>).modelName ?? "");
    switch (rel.type) {
      case HAS_ONE:
      case HAS_MANY:
        return {
          key: rel.key ?? "id",
          fKey: rel.fKey ?? `${modelName}_id`,
        };
      case BELONG_TO:
        return {
          key: rel.key ?? `${rel.model}_id`,
          fKey: rel.fKey ?? "id",
        };
      default:
        return { key: rel.key ?? "id", fKey: rel.fKey ?? "id" };
    }
  }

  private async getRelationData(rel: RelationConfig, data: Record<string, unknown>, isSingle: boolean): Promise<unknown> {
    const modelFn = (name: string) => (this.model as { model(name: string): ModelQuery }).model(name);
    const relModel = modelFn(rel.model);
    const { key, fKey } = this.resolveKeys(rel);
    switch (rel.type) {
      case HAS_ONE: {
        return relModel.where({ [fKey]: data[key] }).field(rel.field).find();
      }
      case HAS_MANY: {
        let query = relModel.where({ [fKey]: data[key] }).field(rel.field).order(rel.order);
        if (rel.limit) {
          if (Array.isArray(rel.limit)) query = query.limit(rel.limit[0], rel.limit[1]);
          else query = query.limit(rel.limit);
        }
        if (rel.page) {
          if (Array.isArray(rel.page)) query = query.page(rel.page[0], rel.page[1]);
          else query = query.page(rel.page);
        }
        return query.select();
      }
      case BELONG_TO: {
        return relModel.where({ [fKey]: data[key] }).field(rel.field).find();
      }
      case MANY_TO_MANY: {
        return [];
      }
      default:
        return undefined;
    }
  }
}
