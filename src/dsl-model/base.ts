import type { ThinkContext } from "../types";
import type { ModelConfig } from "../model";
import type { ModelDSL, ColumnDSL, AclRuleDSL } from "./types";

export abstract class BaseModelDSL implements ModelDSL {
  abstract name: string;
  abstract table: string;
  abstract columns: ColumnDSL[];

  comment?: string;
  primaryKey = "id";
  relations: ModelDSL["relations"] = {};
  indexes: ModelDSL["indexes"] = [];
  option: ModelDSL["option"] = { timestamps: true, softDeletes: false };

  getDefaultValue(_column: ColumnDSL, _ctx?: ThinkContext): unknown {
    if (typeof _column.default === "function") {
      return _column.default();
    }
    return _column.default;
  }

  async validate(
    _ctx: ThinkContext,
    _data: Record<string, unknown>,
    _mode: "create" | "update"
  ): Promise<void> {
    // override for custom validation
  }

  async compute(
    _ctx: ThinkContext,
    record: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return record;
  }

  acl(_ctx: ThinkContext): AclRuleDSL | undefined {
    return undefined;
  }

  toModelConfig(): ModelConfig & ModelDSL {
    return {
      name: this.name,
      table: this.table,
      comment: this.comment,
      primaryKey: this.primaryKey,
      columns: this.columns,
      relations: this.relations,
      indexes: this.indexes,
      option: this.option,
    };
  }
}
