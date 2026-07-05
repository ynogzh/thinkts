import { ControllerBase } from "./base";
import { normalizeWhere } from "./query-helper";

export class BaseController extends ControllerBase {
  /** Create a new record. */
  async createAction(opts: Record<string, unknown> = {}) {
    const model = this.model();
    const id = await model.add(opts);
    return this.success({ [model.pk]: id, ...opts });
  }

  /** Update a record by primary key. Requires `id` in opts. */
  async updateAction(opts: Record<string, unknown> = {}) {
    const model = this.model();
    const id = opts.id;
    if (id === undefined || id === null) return this.fail(400, "Missing primary key (id)");
    const data = { ...opts };
    delete data.id;
    await model.where({ [model.pk]: id }).update(data);
    return this.success(null);
  }

  /** Delete a record by primary key. Requires `id` in opts. */
  async deleteAction(opts: Record<string, unknown> = {}) {
    const model = this.model();
    const id = opts.id;
    if (id === undefined || id === null) return this.fail(400, "Missing primary key (id)");
    await model.where({ [model.pk]: id }).delete();
    return this.success(null);
  }

  /** Get a single record by primary key. Requires `id` in opts. */
  async getAction(opts: Record<string, unknown> = {}) {
    const model = this.model();
    const id = opts.id;
    if (id === undefined || id === null) return this.fail(400, "Missing primary key (id)");
    const data = await model.find(id as string | number);
    return this.success(data);
  }

  /** List records (paginated when page/pageSize provided).
   *  Supports expressive `where` with operators: $gt $gte $lt $lte $ne $like $in $nin.
   *  Supports `field` to limit returned columns.
   */
  async listAction(opts: Record<string, unknown> = {}) {
    const model = this.model();
    const rawWhere = (opts.where as Record<string, unknown>) ?? {};
    let m = model.where(normalizeWhere(rawWhere));
    if (opts.field) {
      m = m.field(opts.field as string | string[]);
    }
    if (opts.orderBy) {
      m = m.order(`${opts.orderBy} ${(opts.sort as string) || "ASC"}`);
    }
    const page = opts.page as number | undefined;
    const pageSize = opts.pageSize as number | undefined;
    if (page != null && pageSize != null) {
      const data = await m.page(page, pageSize).countSelect();
      return this.success(data);
    }
    const data = await m.select();
    return this.success(data);
  }
}
