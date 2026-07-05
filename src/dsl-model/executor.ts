import type { ThinkContext } from "../types";
import type { Model } from "../model";
import type { DslModelEntry, DslServiceEntry } from "./types";
import { convertDslRelations, applyRelationsToModel } from "./relation";
import { callDslHook, normalizeListResult, pickWritable, applyDefaults } from "./helpers";

const relationsCache = new WeakMap<DslModelEntry, ReturnType<typeof convertDslRelations>>();

export interface DslExecutionContext {
  ctx: ThinkContext;
  modelEntry: DslModelEntry;
  serviceEntry?: DslServiceEntry;
  action: string;
  opts: Record<string, unknown>;
}

function getModelInstance(ctx: ThinkContext, modelName: string): Model {
  return ctx.think.model(modelName, { _aclCtx: ctx }) as Model;
}

function getOrBuildRelations(entry: DslModelEntry) {
  let rels = relationsCache.get(entry);
  if (!rels) {
    rels = convertDslRelations(entry.name, entry.dsl.relations);
    relationsCache.set(entry, rels);
  }
  return rels;
}

function getModelWithRelations(ctx: ThinkContext, entry: DslModelEntry): Model {
  const model = getModelInstance(ctx, entry.name);
  const relations = getOrBuildRelations(entry);
  applyRelationsToModel(model, relations);
  return model;
}

function getPrimaryKey(entry: DslModelEntry): string {
  return entry.dsl.primaryKey ?? "id";
}

export async function executeDslAction(execCtx: DslExecutionContext): Promise<unknown> {
  const { ctx, modelEntry, serviceEntry, action, opts } = execCtx;
  const model = getModelWithRelations(ctx, modelEntry);
  const primaryKey = getPrimaryKey(modelEntry);

  switch (action) {
    case "list":
    case "page":
    case "search": {
      const page = Number(opts.page ?? opts.currentPage ?? 1);
      const pageSize = Number(opts.pageSize ?? opts.limit ?? 20);
      const where: Record<string, unknown> = { ...opts };
      delete where.page; delete where.pageSize; delete where.limit;
      delete where.currentPage; delete where.current_page;
      // Strip tenant_id if the model table doesn't have that column
      if (!modelEntry.dsl.columns.some((c) => c.name === "tenant_id")) {
        delete where.tenant_id;
      }
      let query = model.where(where).page(page, pageSize);
      const orderBy = (opts.orderBy as string) ?? (opts.order as string);
      const sort = (opts.sort as string) ?? "desc";
      if (orderBy) query = query.order(`${orderBy} ${sort}`);
      const raw = await query.countSelect();
      const data = await callDslHook(ctx, modelEntry, serviceEntry, "afterList", raw.data ?? []);
      return { ...normalizeListResult({ ...raw, data }), page, pageSize };
    }
    case "create": {
      const data = applyDefaults(modelEntry.dsl.columns, opts);
      const writable = pickWritable(modelEntry.dsl.columns, data);
      const payload = await callDslHook(ctx, modelEntry, serviceEntry, "beforeCreate", writable);
      const id = await model.add(payload);
      const record = await model.find(id);
      return { data: await callDslHook(ctx, modelEntry, serviceEntry, "afterCreate", record) };
    }
    case "get": {
      const pk = opts[primaryKey];
      const record = await model.where({ [primaryKey]: pk }).find();
      return { data: await callDslHook(ctx, modelEntry, serviceEntry, "afterGet", record) };
    }
    case "update": {
      const pk = opts[primaryKey];
      const data = pickWritable(modelEntry.dsl.columns, opts);
      delete data[primaryKey];
      const payload = await callDslHook(ctx, modelEntry, serviceEntry, "beforeUpdate", data, pk);
      await model.where({ [primaryKey]: pk }).update(payload);
      const record = await model.where({ [primaryKey]: pk }).find();
      return { data: await callDslHook(ctx, modelEntry, serviceEntry, "afterUpdate", record) };
    }
    case "delete": {
      const pk = opts[primaryKey];
      const record = await model.where({ [primaryKey]: pk }).find();
      await callDslHook(ctx, modelEntry, serviceEntry, "beforeDelete", record);
      await model.where({ [primaryKey]: pk }).delete();
      return { data: await callDslHook(ctx, modelEntry, serviceEntry, "afterDelete", record) };
    }
    default:
      throw new Error(`Unknown DSL action: ${action}`);
  }
}
