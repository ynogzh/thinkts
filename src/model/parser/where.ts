import { getComparison } from "../comparison";

export abstract class WhereParser {
  abstract parseKey(key: string): string;
  abstract parseValue(value: unknown, params?: unknown[]): unknown;
  abstract getLogic(logic?: string | Record<string, unknown>, _default?: string): string;

  parseWhere(where?: Record<string, unknown> | string, params?: unknown[]): string {
    if (!where || (typeof where === "object" && Object.keys(where).length === 0)) return "";
    if (typeof where === "string") return ` WHERE ${where}`;

    const logic = this.getLogic(where);
    const keySafeRegExp = /^[\w|&\-.]+$/;
    const multi = (where as Record<string, unknown>)._multi;
    delete (where as Record<string, unknown>)._multi;

    const result: string[] = [];

    for (const key of Object.keys(where)) {
      const val = where[key];
      let str = "( ";

      if (["_string", "_complex", "_query"].includes(key)) {
        str += this.parseThinkWhere(key, val as string | Record<string, unknown>);
      } else if (!keySafeRegExp.test(key)) {
        throw new Error("INVALID_WHERE_CONDITION_KEY");
      } else if (key.indexOf("|") > -1) {
        const keys = key.split("|");
        const values = val as unknown[];
        const logicInner = this.getLogic((values as unknown[])[0] as string | Record<string, unknown>, "OR");
        const conds = keys.map((k, i) => this.parseWhereItem(this.parseKey(k), (values as unknown[])[i + 1], params));
        str += conds.join(` ${logicInner} `);
      } else if (key.indexOf("&") > -1) {
        const keys = key.split("&");
        const values = val as unknown[];
        const logicInner = this.getLogic((values as unknown[])[0] as string | Record<string, unknown>, "AND");
        const conds = keys.map((k, i) => this.parseWhereItem(this.parseKey(k), (values as unknown[])[i + 1], params));
        str += conds.join(` ${logicInner} `);
      } else {
        str += this.parseWhereItem(this.parseKey(key), val, params);
      }
      str += " )";
      result.push(str);
    }
    const joined = result.join(` ${logic} `);
    return joined ? ` WHERE ${joined}` : "";
  }

  parseThinkWhere(key: string, val: string | Record<string, unknown>): string {
    if (key === "_string") {
      console.warn(
        "[DEPRECATED] _string where mode allows raw SQL and may cause SQL injection. " +
          "Use parameterized queries or expression builders instead."
      );
      return val as string;
    }
    if (key === "_complex") {
      const where = this.parseWhere(val as Record<string, unknown>);
      return where ? where.replace(" WHERE ", "") : "";
    }
    if (key === "_query") {
      if (typeof val === "string") return val;
      return "";
    }
    return "";
  }

  parseWhereItem(key: string, val: unknown, params?: unknown[]): string {
    if (val === null) return `${key} IS NULL`;
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const result: string[] = [];
      for (const [opr, v] of Object.entries(val)) {
        if (opr === "EXP") {
          result.push(`${key} ${v}`);
          continue;
        }
        const nop = getComparison(opr);
        if (!nop) continue;
        const parsedValue = this.parseValue((val as Record<string, unknown>)[opr], params);
        if (Array.isArray(parsedValue)) {
          result.push(`${key} ${nop} (${(parsedValue as string[]).join(", ")})`);
        } else if (parsedValue === "null") {
          if (nop === "!=") {
            result.push(`${key} IS NOT NULL`);
          } else {
            result.push(`${key} IS NULL`);
          }
        } else {
          result.push(`${key} ${nop} ${parsedValue}`);
        }
      }
      return result.join(" AND ");
    }
    if (Array.isArray(val)) {
      if (typeof val[0] === "string") {
        const val0 = (val[0] as string).toUpperCase();
        if (/^(NOT\s+IN|IN)$/.test(val0)) {
          if (Array.isArray(val[1])) {
            if (params) {
              const placeholders = (val[1] as unknown[]).map(() => "?").join(", ");
              params.push(...(val[1] as unknown[]));
              return `${key} ${val0} (${placeholders})`;
            }
            return `${key} ${val0} (${(val[1] as unknown[]).map((v) => this.parseValue(v)).join(", ")})`;
          }
          return `${key} ${val0} (${this.parseValue(val[1])})`;
        }
        if (/^(NOT\s+LIKE|LIKE|NOT\s+ILIKE|ILIKE)$/.test(val0)) {
          if (Array.isArray(val[1])) {
            const likeLogic = this.getLogic(val[2] as string | Record<string, unknown>, "OR");
            if (params) {
              const like = (val[1] as unknown[]).map(() => `${key} ${val0} ?`).join(` ${likeLogic} `);
              params.push(...(val[1] as unknown[]));
              return `(${like})`;
            }
            const like = (val[1] as unknown[]).map((item) => `${key} ${val0} ${this.parseValue(item)}`).join(` ${likeLogic} `);
            return `(${like})`;
          }
          return `${key} ${val0} ${this.parseValue(val[1], params)}`;
        }
        if (/^(NOT\s+BETWEEN|BETWEEN)$/.test(val0)) {
          if (params) {
            params.push((val[1] as unknown[])[0], (val[1] as unknown[])[1]);
            return `${key} ${val0} ? AND ?`;
          }
          return `${key} ${val0} ${this.parseValue((val[1] as unknown[])[0])} AND ${this.parseValue((val[1] as unknown[])[1])}`;
        }
        if (val0 === "EXP") {
          return `${key} ${val[1]}`;
        }
      }
      if (params) {
        const placeholders = val.map(() => "?").join(", ");
        params.push(...val);
        return `${key} IN (${placeholders})`;
      }
      return `${key} IN (${val.map((v) => this.parseValue(v)).join(", ")})`;
    }
    return `${key} = ${this.parseValue(val, params)}`;
  }
}
