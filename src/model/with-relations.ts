import { QueryBuilder } from "./query-builder";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = QueryBuilder> = new (...args: any[]) => T;

export interface RelationConfig {
  model: string;
  foreignKey: string;
  type: "hasMany" | "belongsTo";
}

/** Mixin: adds relation definitions and eager-loading to a QueryBuilder. */
export function withRelations<TBase extends Constructor>(Base: TBase) {
  return class RelationsModel extends Base {
    _relations: Record<string, RelationConfig> = {};
    _eagerLoad: string[] = [];

    relation(name: string, config: RelationConfig): this { this._relations[name] = config; return this; }
    with(relation: string): this { this._eagerLoad.push(relation); return this; }
    get relations(): Record<string, RelationConfig> { return { ...this._relations }; }
    get eagerRelations(): string[] { return [...this._eagerLoad]; }
  };
}
