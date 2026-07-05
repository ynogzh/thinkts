import { QueryBuilder } from "./query-builder";
import { withAcl } from "./with-acl";
import { withRelations } from "./with-relations";

/**
 * v2 Model — fluent query builder composed via mixins.
 *
 * Replaces the v1 5-layer inheritance chain:
 *   ModelCore → ModelWithAcl → ModelWithBuilder → ModelWithOps → Model
 *
 * With 3 mixin functions:
 *   QueryBuilder → withAcl → withRelations → Model
 */
export const ModelV2 = withRelations(withAcl(QueryBuilder));

export { QueryBuilder, type WhereClause, type WhereValue } from "./query-builder";
export { withAcl, type AclRule } from "./with-acl";
export { withRelations, type RelationConfig } from "./with-relations";
