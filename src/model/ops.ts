import type { ParseOptions } from "./parser";
import { ModelWithBuilder } from "./builder";

export class ModelWithOps extends ModelWithBuilder {
  async add(data: Record<string, unknown>, options?: ParseOptions, replace?: boolean): Promise<number> {
    options = await this.parseOptions(options);
    let parsedData = await this.db().schema.parseData(data, false, options.table, this._strict);
    parsedData = await this.beforeAdd(parsedData);
    if (this._aclRole) parsedData = await this._applyAclWrite(parsedData, "add");
    if (!parsedData || Object.keys(parsedData).length === 0) throw new Error("add data is empty");
    if (replace) options.replace = replace;
    const lastInsertId = await this.db().query.add(parsedData, options);
    const copyData = { ...data, ...parsedData, [this.pk]: lastInsertId };
    await this.afterAdd(copyData);
    return lastInsertId;
  }

  async thenAdd(data: Record<string, unknown>, where: Record<string, unknown>): Promise<Record<string, unknown>> {
    const findData = await this.where(where).find();
    if (findData && Object.keys(findData).length > 0) {
      return { [this.pk]: findData[this.pk], type: "exist" };
    }
    const insertId = await this.add(data);
    return { [this.pk]: insertId, type: "add" };
  }

  async thenUpdate(data: Record<string, unknown>, where: Record<string, unknown>): Promise<unknown> {
    const findData = await this.where(where).find();
    if (!findData || Object.keys(findData).length === 0) {
      return this.add(data);
    }
    await this.where(where).update(data);
    return findData[this.pk];
  }

  async addMany(data: Record<string, unknown>[], options?: ParseOptions, replace?: boolean): Promise<number[]> {
    if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
      throw new Error("data must be an object array");
    }
    options = await this.parseOptions(options);
    const promises = data.map(async (item) => {
      item = await this.db().schema.parseData(item, false, options.table, this._strict);
      return this.beforeAdd(item);
    });
    data = await Promise.all(promises);
    if (replace) options.replace = replace;
    const insertIds = await this.db().query.addMany(data, options);
    const afterPromises = data.map((item, i) => {
      item[this.pk] = insertIds[i];
      return this.afterAdd(item);
    });
    await Promise.all(afterPromises);
    return insertIds;
  }

  async delete(options?: ParseOptions): Promise<unknown> {
    options = await this.parseOptions(options);
    options = await this.beforeDelete(options);
    if (this._aclRole) options = await this._applyAclDelete(options);
    const rows = await this.db().query.delete(options);
    await this.afterDelete(options);
    return rows;
  }

  async update(data: Record<string, unknown>, options?: ParseOptions): Promise<unknown> {
    options = await this.parseOptions(options);
    let parsedData = await this.db().schema.parseData(data, true, options.table, this._strict);
    parsedData = await this.beforeUpdate(parsedData);
    if (this._aclRole) parsedData = await this._applyAclWrite(parsedData, "update");
    if (!parsedData || Object.keys(parsedData).length === 0) throw new Error("update data is empty");
    const rows = await this.db().query.update(parsedData, options);
    await this.afterUpdate(data);
    return rows;
  }

  updateMany(dataList: Record<string, unknown>[], options?: ParseOptions): Promise<unknown[]> {
    if (!Array.isArray(dataList)) {
      this.options = {};
      throw new Error("updateMany data must be an array");
    }
    if (!dataList.every((data) => this.pk in data)) {
      this.options = {};
      throw new Error("updateMany every data must contain primary key");
    }
    const promises = dataList.map((data) => this.update(data, options));
    return Promise.all(promises);
  }

  async find<T = Record<string, unknown>>(options?: ParseOptions | string | number): Promise<T> {
    options = await this.parseOptions(options);
    options.limit = [1];
    options = await this.beforeFind(options);
    if (this._aclRole) options = await this._applyAclRead(options, "find");
    const data = await this.db().query.select(options);
    const result = (data as Record<string, unknown>[])[0] ?? {};
    return this.afterFind(result) as T;
  }

  /** Create a record and return the newly inserted row. */
  async create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = await this.add(data);
    return this.find(id);
  }

  /** Return the first matching row or undefined if none. */
  async first<T = Record<string, unknown>>(): Promise<T | undefined> {
    const row = await this.find<T>();
    return row && Object.keys(row as unknown as Record<string, unknown>).length > 0 ? row : undefined;
  }

  async select<T = Record<string, unknown>>(options?: ParseOptions | string | number): Promise<T[]> {
    options = await this.parseOptions(options);
    options = await this.beforeSelect(options);
    if (this._aclRole) options = await this._applyAclRead(options, "select");
    const data = await this.db().query.select(options);
    const result = await this.afterSelect(data as Record<string, unknown>[]);
    return result as T[];
  }

  async selectAdd(options?: ParseOptions | unknown): Promise<unknown> {
    let promise: Promise<ParseOptions>;
    if (options && typeof options === "object" && "parseOptions" in options) {
      promise = (options as { parseOptions(): Promise<ParseOptions> }).parseOptions();
    } else {
      promise = Promise.resolve(options as ParseOptions);
    }
    const [selfOpts, otherOpts] = await Promise.all([this.parseOptions(), promise]);
    let fields = selfOpts.field;
    if (!fields) {
      const schema = await this.db().schema.getSchema();
      fields = Object.keys(schema);
    }
    const fieldArr = typeof fields === "string" ? fields.split(/\s*,\s*/) : (fields as string[]);
    return this.db().query.selectAdd(fieldArr, selfOpts.table ?? this.tableName, otherOpts);
  }

  async countSelect(options?: ParseOptions | boolean, pageFlag?: boolean): Promise<Record<string, unknown>> {
    let count: number | undefined;
    if (typeof options === "boolean") {
      pageFlag = options;
      options = {};
    } else if (typeof options === "number") {
      count = options;
      options = {};
    }
    options = await this.parseOptions(options as ParseOptions);
    const table = (options.alias as string) || this.tableName;
    delete options.table;
    const order = options.order;
    delete options.order;
    if (typeof count !== "number") {
      this.options = options;
      count = await this.count(`${this.quoteField(table)}.${this.pk}`);
    }
    options.limit = options.limit || [0, this.config.pagesize ?? 10];
    options.order = order;
    const pagesize = options.limit[1];
    const currentPage = parseInt(String((options.limit[0] / options.limit[1]) + 1));
    const totalPage = Math.ceil(count / pagesize);
    const result: Record<string, unknown> = {
      count,
      totalPages: totalPage,
      pageSize: pagesize,
      currentPage,
    };
    if (typeof pageFlag === "boolean" && currentPage > totalPage) {
      if (pageFlag) {
        result.currentPage = 1;
        options.limit = [0, pagesize];
      } else {
        result.currentPage = totalPage;
        options.limit = [(totalPage - 1) * pagesize, pagesize];
      }
    }
    if (options.cache && (options.cache as Record<string, unknown>).key) {
      (options.cache as Record<string, unknown>).key += "_count";
    }
    result.data = count ? await this.select(options) : [];
    return result;
  }

  async getField(field: string, one?: boolean | number): Promise<unknown> {
    let options = await this.parseOptions({ field });
    if (typeof one === "number") {
      options.limit = [one];
    } else if (one === true) {
      options.limit = [1];
    }
    if (this._aclRole) options = await this._applyAclRead(options, "select");
    const data = await this.db().query.select(options);
    const result: Record<string, unknown[]> = {};
    for (const item of data as Record<string, unknown>[]) {
      for (const f of Object.keys(item)) {
        if (Array.isArray(result[f])) {
          result[f].push(item[f] as unknown);
        } else {
          result[f] = one === true ? [item[f] as unknown] : [item[f] as unknown];
        }
      }
    }
    const fields = Object.keys(result);
    if (fields.length === 0) {
      const multi = field.indexOf(",") > -1 && field.indexOf("(") === -1;
      if (multi) {
        const out: Record<string, unknown> = {};
        field.split(/\s*,\s*/).forEach((item) => {
          out[item] = one === true ? undefined : [];
        });
        return out;
      }
      return one === true ? undefined : [];
    }
    if (fields.length === 1) {
      return one === true ? (result[fields[0]]?.[0] ?? undefined) : result[fields[0]];
    }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      out[f] = one === true ? (result[f]?.[0] ?? undefined) : result[f];
    }
    return out;
  }

  increment(field: string | string[] | Record<string, number>, step = 1): Promise<unknown> {
    step = parseFloat(String(step));
    let data: Record<string, unknown> = {};
    if (Array.isArray(field)) {
      field.forEach((item) => {
        data[item] = ["exp", `${this.quoteField(item)}+${step}`];
      });
    } else if (typeof field === "object") {
      for (const key of Object.keys(field)) {
        data[key] = ["exp", `${this.quoteField(key)}+${(field as Record<string, number>)[key]}`];
      }
    } else {
      data = { [field]: ["exp", `${this.quoteField(field)}+${step}`] };
    }
    return this.update(data);
  }

  decrement(field: string | string[] | Record<string, number>, step = 1): Promise<unknown> {
    step = parseFloat(String(step));
    let data: Record<string, unknown> = {};
    if (Array.isArray(field)) {
      field.forEach((item) => {
        data[item] = ["exp", `${this.quoteField(item)}-${step}`];
      });
    } else if (typeof field === "object") {
      for (const key of Object.keys(field)) {
        data[key] = ["exp", `${this.quoteField(key)}-${(field as Record<string, number>)[key]}`];
      }
    } else {
      data = { [field]: ["exp", `${this.quoteField(field)}-${step}`] };
    }
    return this.update(data);
  }

  count(field?: string): Promise<number> {
    field = this.quoteField(field);
    return this.getField(`COUNT(${field}) AS think_count`, true) as Promise<number>;
  }

  sum(field: string): Promise<number> {
    field = this.quoteField(field);
    return this.getField(`SUM(${field}) AS think_sum`, true) as Promise<number>;
  }

  min(field: string): Promise<number> {
    field = this.quoteField(field);
    return this.getField(`MIN(${field}) AS think_min`, true) as Promise<number>;
  }

  max(field: string): Promise<number> {
    field = this.quoteField(field);
    return this.getField(`MAX(${field}) AS think_max`, true) as Promise<number>;
  }

  avg(field: string): Promise<number> {
    field = this.quoteField(field);
    return this.getField(`AVG(${field}) AS think_avg`, true) as Promise<number>;
  }

  query(sqlOptions: string | { sql: string }): Promise<unknown[]> {
    sqlOptions = this.parseSql(sqlOptions);
    return this.db().query.select(sqlOptions, this.options.cache as Record<string, unknown> | undefined);
  }

  execute(sqlOptions: string | { sql: string }): Promise<unknown> {
    sqlOptions = this.parseSql(sqlOptions);
    return this.db().query.execute(sqlOptions);
  }
}
