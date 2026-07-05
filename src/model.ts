import { ModelWithOps } from "./model/ops";
import type { ModelQuery } from "./model/relation";

export class Model<T = Record<string, unknown>> extends ModelWithOps implements ModelQuery {}

export { ModelCore } from "./model/core";
export { ModelWithAcl } from "./model/acl";
export { ModelWithBuilder } from "./model/builder";
export { ModelWithOps } from "./model/ops";
export type { ModelConfig, AdapterInstance } from "./model/core";
export { HAS_ONE, HAS_MANY, BELONG_TO, MANY_TO_MANY } from "./model/relation";
export type { RelationConfig } from "./model/relation";
