import { describe, expect, it } from "bun:test";
import { defineModel, RowOf, toDslConfig } from "./define";
import { t, required, primary, unique, autoIncrement, defaultTo } from "./types";

describe("defineModel", () => {
  const DeviceCategory = defineModel("iotbiz_device_category", {
    columns: {
      id: t.bigint(),
      code: t.string(64),
      name: t.string(128),
      status: t.enum(["enabled", "disabled"]),
      sort_order: t.integer(),
    },
    primaryKey: "id",
  });

  it("creates a model definition with correct table name", () => {
    expect(DeviceCategory.tableName).toBe("iotbiz_device_category");
  });

  it("has correct column types", () => {
    expect(DeviceCategory.columns.code._sqlType).toBe("varchar");
    expect(DeviceCategory.columns.code.length).toBe(64);
    expect(DeviceCategory.columns.status._sqlType).toBe("enum");
    expect(DeviceCategory.columns.status.enumValues).toEqual(["enabled", "disabled"]);
  });

  it("infers primary key from column definitions", () => {
    const model = defineModel("test", {
      columns: { id: t.bigint(), name: t.string(128) },
    });
    expect(model.primaryKey).toBe("id"); // first column is default PK
  });

  it("converts to DSL config compatible with model.json", () => {
    const config = toDslConfig(DeviceCategory);
    expect(config.name).toBe("iotbiz_device_category");
    expect((config.columns as Array<Record<string, unknown>>).length).toBe(5);
  });

  it("supports hooks with typed parameters", () => {
    const model = defineModel("test", {
      columns: { id: t.bigint(), name: t.string(128) },
      hooks: {
        beforeCreate(data) {
          // TypeScript verifies: data.name is string | undefined (partial)
          data.name ??= "default";
          return data;
        },
      },
    });
    expect(model.hooks?.beforeCreate).toBeDefined();
  });
});

describe("t.* helpers", () => {
  it("t.string() produces varchar type", () => {
    const col = t.string(128);
    expect(col._sqlType).toBe("varchar");
    expect(col.length).toBe(128);
  });

  it("t.bigint() has columnName override", () => {
    const col = t.bigint("user_id");
    expect(col._sqlType).toBe("bigint");
    expect(col.columnName).toBe("user_id");
  });

  it("chained constraints compose", () => {
    const col = t.string(64);
    const result = required(primary(unique(col)));
    expect(result._sqlType).toBe("varchar");
    expect(result.required).toBe(true);
    expect(result.primary).toBe(true);
    expect(result.unique).toBe(true);
  });
});
