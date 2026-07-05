import type { Model } from "../model";
import { HAS_ONE, HAS_MANY, BELONG_TO, MANY_TO_MANY } from "../model/relation";
import type { RelationDSL } from "./types";

const TYPE_MAP: Record<string, number> = {
  hasOne: HAS_ONE,
  hasMany: HAS_MANY,
  belongsTo: BELONG_TO,
  manyToMany: MANY_TO_MANY,
};

export interface ResolvedRelation {
  name: string;
  type: number;
  model: string;
  key: string;
  fKey: string;
  field?: string | string[];
  order?: string | string[] | Record<string, string>;
  limit?: number | number[];
  page?: number | number[];
  where?: Record<string, unknown>;
  through?: string;
}

function resolveKeys(type: number, modelName: string, rel: RelationDSL): { key: string; fKey: string } {
  // Native keys: `key` = column on the current model, `foreign` = column on the related model.
  // DSL aliases: `localKey` = the referenced/local key on the "one" side;
  //              `foreignKey` = the referencing/foreign key on the "many" side.
  switch (type) {
    case HAS_ONE:
    case HAS_MANY: {
      // Current model is the "one" side; related model is the "many" side.
      const ownKey = rel.key ?? rel.localKey;
      const relatedKey = rel.foreign ?? rel.foreignKey;
      return {
        key: ownKey ?? "id",
        fKey: relatedKey ?? `${modelName}_id`,
      };
    }
    case BELONG_TO: {
      // Current model is the "many" side; related model is the "one" side.
      const ownKey = rel.key ?? rel.foreignKey;
      const relatedKey = rel.foreign ?? rel.localKey;
      return {
        key: ownKey ?? `${rel.model}_id`,
        fKey: relatedKey ?? "id",
      };
    }
    default:
      return { key: rel.key ?? "id", fKey: rel.foreign ?? "id" };
  }
}

export function convertDslRelations(
  modelName: string,
  relations?: Record<string, RelationDSL>
): ResolvedRelation[] {
  if (!relations) return [];
  return Object.entries(relations).map(([name, rel]) => {
    const type = TYPE_MAP[rel.type];
    if (type === undefined) {
      throw new Error(`Unknown relation type "${rel.type}" on ${modelName}.${name}`);
    }
    const { key, fKey } = resolveKeys(type, modelName, rel);
    return {
      name,
      type,
      model: rel.model,
      key,
      fKey,
      field: rel.field,
      order: rel.order,
      limit: rel.limit,
      page: rel.page,
      where: rel.where,
      through: rel.through,
    };
  });
}

export function applyRelationsToModel(model: Model, relations: ResolvedRelation[]): void {
  for (const rel of relations) {
    model.setRelation(rel.name, {
      type: rel.type,
      model: rel.model,
      key: rel.key,
      fKey: rel.fKey,
      field: rel.field,
      order: rel.order,
      limit: rel.limit,
      page: rel.page,
      where: rel.where,
      rModel: rel.through,
    });
  }
}
