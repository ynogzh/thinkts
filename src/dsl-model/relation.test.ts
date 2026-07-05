import { describe, it, expect } from "bun:test";
import { HAS_ONE, HAS_MANY, BELONG_TO, MANY_TO_MANY } from "../model/relation";
import { convertDslRelations, applyRelationsToModel } from "./relation";

class FakeModel {
  relations: Array<{ name: string; value: unknown }> = [];
  setRelation(name: string, value: unknown) {
    this.relations.push({ name, value });
  }
}

describe("convertDslRelations", () => {
  it("converts belongsTo with default keys", () => {
    const relations = convertDslRelations("mall_order", {
      product: { type: "belongsTo", model: "mall_product" },
    });
    expect(relations).toEqual([
      {
        name: "product",
        type: BELONG_TO,
        model: "mall_product",
        key: "mall_product_id",
        fKey: "id",
      },
    ]);
  });

  it("converts hasMany with default keys", () => {
    const relations = convertDslRelations("mall_order", {
      items: { type: "hasMany", model: "mall_order_item" },
    });
    expect(relations).toEqual([
      {
        name: "items",
        type: HAS_MANY,
        model: "mall_order_item",
        key: "id",
        fKey: "mall_order_id",
      },
    ]);
  });

  it("converts hasOne with default keys", () => {
    const relations = convertDslRelations("identity_user", {
      profile: { type: "hasOne", model: "identity_profile" },
    });
    expect(relations).toEqual([
      {
        name: "profile",
        type: HAS_ONE,
        model: "identity_profile",
        key: "id",
        fKey: "identity_user_id",
      },
    ]);
  });

  it("honors explicit key and foreign", () => {
    const relations = convertDslRelations("order", {
      owner: { type: "belongsTo", model: "user", key: "owner_id", foreign: "id" },
    });
    expect(relations[0].key).toBe("owner_id");
    expect(relations[0].fKey).toBe("id");
  });

  it("throws on unknown relation type", () => {
    expect(() =>
      convertDslRelations("order", {
        bad: { type: "unknown" as never, model: "x" },
      })
    ).toThrow('Unknown relation type "unknown" on order.bad');
  });

  it("honors foreignKey and localKey aliases", () => {
    const relations = convertDslRelations("mall_order", {
      items: { type: "hasMany", model: "mall_order_item", localKey: "id", foreignKey: "order_id" },
    });
    expect(relations).toEqual([
      {
        name: "items",
        type: HAS_MANY,
        model: "mall_order_item",
        key: "id",
        fKey: "order_id",
      },
    ]);
  });

  it("honors foreignKey and localKey aliases for belongsTo", () => {
    const relations = convertDslRelations("mall_order_item", {
      order: { type: "belongsTo", model: "mall_order", localKey: "id", foreignKey: "order_id" },
    });
    expect(relations).toEqual([
      {
        name: "order",
        type: BELONG_TO,
        model: "mall_order",
        key: "order_id",
        fKey: "id",
      },
    ]);
  });

  it("preserves extra options", () => {
    const relations = convertDslRelations("order", {
      items: {
        type: "hasMany",
        model: "item",
        field: ["id", "name"],
        order: { id: "desc" },
        limit: 10,
        where: { status: "enabled" },
      },
    });
    expect(relations[0].field).toEqual(["id", "name"]);
    expect(relations[0].order).toEqual({ id: "desc" });
    expect(relations[0].limit).toBe(10);
    expect(relations[0].where).toEqual({ status: "enabled" });
  });
});

describe("applyRelationsToModel", () => {
  it("registers relations on model", () => {
    const fake = new FakeModel();
    const model = fake as unknown as import("../model").Model;
    applyRelationsToModel(model, [
      {
        name: "items",
        type: HAS_MANY,
        model: "mall_order_item",
        key: "id",
        fKey: "mall_order_id",
      },
      {
        name: "product",
        type: BELONG_TO,
        model: "mall_product",
        key: "mall_product_id",
        fKey: "id",
      },
    ]);
    expect(fake.relations.length).toBe(2);
    expect(fake.relations[0].name).toBe("items");
    expect((fake.relations[0].value as { type: number }).type).toBe(HAS_MANY);
    expect((fake.relations[1].value as { type: number }).type).toBe(BELONG_TO);
  });

  it("preserves extra relation options", () => {
    const fake = new FakeModel();
    const model = fake as unknown as import("../model").Model;
    applyRelationsToModel(model, [
      {
        name: "items",
        type: HAS_MANY,
        model: "item",
        key: "id",
        fKey: "order_id",
        field: ["id", "name"],
        order: "id desc",
        limit: 5,
        where: { status: "enabled" },
      },
    ]);
    const value = fake.relations[0].value as {
      type: number;
      field: string[];
      order: string;
      limit: number;
      where: Record<string, unknown>;
      rModel?: string;
    };
    expect(value.field).toEqual(["id", "name"]);
    expect(value.order).toBe("id desc");
    expect(value.limit).toBe(5);
    expect(value.where).toEqual({ status: "enabled" });
  });

  it("sets rModel from through", () => {
    const fake = new FakeModel();
    const model = fake as unknown as import("../model").Model;
    applyRelationsToModel(model, [
      {
        name: "tags",
        type: MANY_TO_MANY,
        model: "tag",
        key: "id",
        fKey: "id",
        through: "post_tag",
      },
    ]);
    const value = fake.relations[0].value as { rModel: string };
    expect(value.rModel).toBe("post_tag");
  });
});
