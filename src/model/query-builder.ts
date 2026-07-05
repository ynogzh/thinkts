import type { AdapterInstance } from "./core";

export type WhereValue = string | number | boolean | null | [string, ...unknown[]];
export type WhereClause = Record<string, WhereValue>;

/** Fluent query builder — v2 model core. Uses mixin-compatible public fields. */
export class QueryBuilder<T = Record<string, never>> {
  _where: WhereClause[] = [];
  _order: string[] = [];
  _limitVal?: number;
  _offsetVal?: number;
  _fields?: string[];

  constructor(
    readonly _modelName: string,
    readonly _adapter: () => AdapterInstance,
  ) {}

  where(clause: WhereClause): this { this._where.push(clause); return this; }
  order(by: string): this { this._order.push(by); return this; }
  limit(n: number): this { this._limitVal = n; return this; }
  offset(n: number): this { this._offsetVal = n; return this; }
  field(fields: string | string[]): this { this._fields = Array.isArray(fields) ? fields : [fields]; return this; }

  async select(): Promise<T[]> {
    const result = await this._adapter().query.execute(this._buildSelect());
    return result as unknown as T[];
  }

  async count(): Promise<number> {
    const where = this._mergeWhere();
    const wc = Object.keys(where).length > 0 ? `WHERE ${this._buildWhereClause(where)}` : "";
    const result = await this._adapter().query.execute(`SELECT COUNT(*) FROM ${this._modelName} ${wc}`);
    return Number((result as unknown as Array<{ count: number }>)[0]?.count ?? 0);
  }

  async first(): Promise<T | null> { const rows = await this.limit(1).select(); return rows[0] ?? null; }

  async add(data: Partial<T>): Promise<number> {
    const keys = Object.keys(data as Record<string, unknown>);
    const vals = Object.values(data as Record<string, unknown>);
    const sql = `INSERT INTO ${this._modelName} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
    const result = await this._adapter().query.execute(sql, vals) as { insertId?: number };
    return result.insertId ?? 0;
  }

  async update(data: Partial<T>): Promise<number> {
    const setClause = Object.keys(data as Record<string, unknown>).map(k => `${k} = ?`).join(", ");
    const vals = Object.values(data as Record<string, unknown>);
    const where = this._mergeWhere();
    const sql = `UPDATE ${this._modelName} SET ${setClause} WHERE ${this._buildWhereClause(where)}`;
    const result = await this._adapter().query.execute(sql, [...vals, ...Object.values(where)]) as { affectedRows?: number };
    return result.affectedRows ?? 0;
  }

  async delete(): Promise<number> {
    const where = this._mergeWhere();
    const sql = `DELETE FROM ${this._modelName} WHERE ${this._buildWhereClause(where)}`;
    const result = await this._adapter().query.execute(sql, Object.values(where)) as { affectedRows?: number };
    return result.affectedRows ?? 0;
  }

  /** @internal */
  _mergeWhere(): WhereClause { const m: WhereClause = {}; for (const c of this._where) Object.assign(m, c); return m; }
  /** @internal */
  _buildWhereClause(where: WhereClause): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(where)) {
      if (Array.isArray(v)) { const [op, ...vals] = v; parts.push(op === "IN" ? `${k} IN (${vals.map(() => "?").join(", ")})` : `${k} ${op} ?`); }
      else parts.push(`${k} = ?`);
    }
    return parts.join(" AND ") || "1=1";
  }
  /** @internal */
  _buildSelect(): string {
    const f = this._fields?.join(", ") ?? "*";
    const w = this._mergeWhere();
    const wc = Object.keys(w).length > 0 ? `WHERE ${this._buildWhereClause(w)}` : "";
    const o = this._order.length > 0 ? `ORDER BY ${this._order.join(", ")}` : "";
    const l = this._limitVal !== undefined ? `LIMIT ${this._limitVal}` : "";
    const of = this._offsetVal !== undefined ? `OFFSET ${this._offsetVal}` : "";
    return [`SELECT ${f} FROM ${this._modelName}`, wc, o, l, of].filter(Boolean).join(" ");
  }
}
