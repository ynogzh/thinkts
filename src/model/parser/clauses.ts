import { WhereParser } from "./where";
import type { ParseOptions, JoinItem, UnionItem } from "./types";

export abstract class ClauseParser extends WhereParser {
  abstract config: Record<string, unknown>;
  abstract parseTable(table?: string, options?: ParseOptions): string;
  abstract buildSelectSql(options: ParseOptions): string;

  parseJoin(join?: JoinItem[]): string {
    if (!join || join.length === 0) return "";
    const joins: Record<string, string> = {
      left: " LEFT JOIN ",
      right: " RIGHT JOIN ",
      inner: " INNER JOIN ",
    };
    const defaultJoin = " LEFT JOIN ";
    let joinStr = "";
    for (const item of join) {
      let joinType = defaultJoin;
      if (item.join) {
        joinType = joins[item.join.toLowerCase()] || ` ${item.join.toUpperCase()} JOIN `;
      }
      const table = this.parseTable(item.table);
      const asStr = item.as ? ` AS ${this.parseKey(item.as)}` : "";
      joinStr += `${joinType}${table}${asStr}`;
      if (item.on) {
        if (typeof item.on === "string") {
          joinStr += ` ON ${item.on}`;
        } else if (Array.isArray(item.on)) {
          joinStr += ` ON ${item.on.join(" AND ")}`;
        } else if (typeof item.on === "object") {
          const onConditions: string[] = [];
          for (const [k, v] of Object.entries(item.on)) {
            onConditions.push(`${this.parseKey(k)}=${this.parseKey(String(v))}`);
          }
          joinStr += ` ON ${onConditions.join(" AND ")}`;
        }
      }
    }
    return joinStr;
  }

  parseOrder(order?: string | string[] | Record<string, string>): string {
    if (!order || (Array.isArray(order) && order.length === 0)) return "";
    if (Array.isArray(order)) {
      order = order.map((item) => this.parseKey(item)).join(",");
    } else if (typeof order === "object") {
      const arr: string[] = [];
      for (const k of Object.keys(order)) {
        arr.push(`${this.parseKey(k)} ${(order as Record<string, string>)[k]}`);
      }
      order = arr.join(",");
    }
    return ` ORDER BY ${order}`;
  }

  parseGroup(group?: string | string[]): string {
    if (!group || (Array.isArray(group) && group.length === 0)) return "";
    if (typeof group === "string") {
      if (group.indexOf("(") !== -1) return ` GROUP BY ${group}`;
      group = group.split(/\s*,\s*/);
    }
    const result = (group as string[]).map((item) => {
      if (item.indexOf(".") === -1) return this.parseKey(item);
      const parts = item.split(".");
      return `${parts[0]}.${this.parseKey(parts[1])}`;
    });
    return ` GROUP BY ${result.join(",")}`;
  }

  parseHaving(having?: string): string {
    return having ? ` HAVING ${having}` : "";
  }

  parseComment(comment?: string): string {
    return comment ? ` /*${comment}*/` : "";
  }

  parseDistinct(distinct?: boolean | string): string {
    if (!distinct) return "";
    if (typeof distinct === "string") return ` DISTINCT ${this.parseKey(distinct)}`;
    return " DISTINCT";
  }
  parseLock(lock?: boolean | string): string {
    if (!lock) return "";
    if (typeof lock === "string") return ` ${lock}`;
    return " FOR UPDATE";
  }

  parseUnion(union?: UnionItem[], params?: unknown[]): string {
    if (!union || union.length === 0) return "";
    let sql = "";
    for (const item of union) {
      sql += item.all ? "UNION ALL " : "UNION ";
      sql += `(${typeof item.union === "object" && !(Array.isArray(item.union)) ? this.buildSelectSql({ ...(item.union as Record<string, unknown>), params }) : item.union})`;
    }
    return sql;
  }

  parseLimit(limit?: number[]): string {
    if (!limit || limit.length === 0) return "";
    if (limit.length === 1) return ` LIMIT ${limit[0]}`;
    return ` LIMIT ${limit[0]},${limit[1]}`;
  }
}
