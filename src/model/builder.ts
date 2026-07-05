import { ModelWithAcl } from "./acl";

export class ModelWithBuilder extends ModelWithAcl {
  cache(key: string | Record<string, unknown>, config?: Record<string, unknown> | number): this {
    if (key === undefined) return this;
    if (typeof key !== "string") {
      config = key;
      key = "";
    }
    if (typeof config === "number") {
      config = { timeout: config };
    }
    const cfg = config as Record<string, unknown>;
    if (cfg?.timeout) {
      cfg._keyTimeout = cfg.timeout;
      delete cfg.timeout;
    }
    const cacheConfig = this._cacheConfig;
    let finalConfig: Record<string, unknown>;
    if (cacheConfig) {
      finalConfig = { ...cacheConfig, ...this.config.cache, ...cfg };
    } else {
      finalConfig = { ...this.config.cache, ...cfg };
    }
    if (!finalConfig.key) {
      finalConfig.key = key;
    }
    if (typeof finalConfig.handle !== "function") {
      throw new Error("cache.handle must be a function");
    }
    this.options.cache = finalConfig;
    return this;
  }

  limit(offset?: number | number[], length?: number): this {
    if (offset === undefined) return this;
    if (Array.isArray(offset)) {
      length = offset[1] ?? length;
      offset = offset[0];
    }
    offset = Math.max(parseInt(String(offset)) || 0, 0);
    if (length) {
      length = Math.max(parseInt(String(length)) || 0, 0);
    }
    this.options.limit = length ? [offset, length] : [offset];
    return this;
  }

  page(page?: number | number[], listRows = this.config.pagesize ?? 10): this {
    if (Array.isArray(page)) {
      listRows = (page[1] as number) ?? listRows;
      page = page[0];
    }
    page = Math.max(parseInt(String(page)) || 1, 1);
    listRows = Math.max(parseInt(String(listRows)) || 10, 1);
    this.options.limit = [listRows * (page - 1), listRows];
    return this;
  }

  where(where?: Record<string, unknown> | string): this {
    if (!where) return this;
    if (typeof where === "string") {
      where = { _string: where };
    }
    if (this.options.where && typeof this.options.where === "string") {
      this.options.where = { _string: this.options.where };
    }
    this.options.where = { ...(this.options.where as Record<string, unknown> | undefined), ...where };
    return this;
  }
  field(field?: string | string[] | Record<string, string>, reverse = false): this {
    if (!field) return this;
    this.options.field = field;
    this.options.fieldReverse = reverse;
    return this;
  }

  fieldReverse(field: string | string[] | Record<string, string>): this {
    return this.field(field, true);
  }

  table(table?: string, hasPrefix = false): this {
    if (!table) return this;
    table = table.trim();
    if (!hasPrefix && table.indexOf(" ") === -1) {
      table = this.tablePrefix + table;
    }
    this.options.table = table;
    return this;
  }

  union(union?: string | Record<string, unknown>, all = false): this {
    if (!union) return this;
    if (!this.options.union) this.options.union = [];
    (this.options.union as { union: unknown; all?: boolean }[]).push({ union, all });
    return this;
  }

  join(join?: string | string[] | Record<string, unknown>): this {
    if (!join) return this;
    if (!this.options.join) this.options.join = [];
    if (Array.isArray(join)) {
      (this.options.join as unknown[]).push(...join);
    } else {
      (this.options.join as unknown[]).push(join);
    }
    return this;
  }

  leftJoin(join?: string | string[] | Record<string, unknown>): this {
    return this.join(join);
  }
  rightJoin(join?: string | string[] | Record<string, unknown>): this {
    return this.join(join);
  }
  innerJoin(join?: string | string[] | Record<string, unknown>): this {
    return this.join(join);
  }
  fullJoin(join?: string | string[] | Record<string, unknown>): this {
    return this.join(join);
  }

  order(value?: string | string[] | Record<string, string>): this {
    this.options.order = value;
    return this;
  }

  alias(value?: string): this {
    this.options.alias = value;
    return this;
  }

  having(value?: string): this {
    this.options.having = value;
    return this;
  }

  group(value?: string | string[]): this {
    this.options.group = value;
    return this;
  }

  lock(value?: boolean | string): this {
    this.options.lock = value;
    return this;
  }

  auto(value?: string): this {
    this.options.auto = value;
    return this;
  }

  distinct(data?: boolean | string): this {
    this.options.distinct = data;
    if (typeof data === "string") this.options.field = data;
    return this;
  }

  explain(explain?: boolean): this {
    this.options.explain = explain;
    return this;
  }
}
