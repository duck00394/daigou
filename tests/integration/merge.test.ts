import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createProduct } from "@/server/services/catalog";
import { receiveAll } from "@/server/services/receiving";
import { inventorySummary } from "@/server/services/inventory";
import { quickSale } from "@/server/services/quick-sale";
import { duplicateGroups, mergeProducts } from "@/server/services/merge";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("合併重複商品", () => {
  it("列出名稱一樣的；合併後採購、庫存、出售都算在留下的商品，被合併的封存", async () => {
    const [a, b] = await tx(async (t) => [
      await createProduct(t, actor, { name: "ANA小桃 吊娃", categoryIds: [s.halloween.id] }),
      await createProduct(t, actor, { name: "ANA小桃  吊娃", categoryIds: [s.shanghai.id] }),
    ]);
    const b1 = await tx((t) => createBatch(t, actor, { name: "一團", supplier: "砂糖", orderedById: "op_a", categoryId: s.halloween.id }));
    const b2 = await tx((t) => createBatch(t, actor, { name: "二團", supplier: "頑皮喵", orderedById: "op_b", categoryId: s.halloween.id }));
    await tx((t) => addBatchItem(t, actor, b1.id, { productId: a.id, qty: 2, unitCost: 610, currency: "TWD" }));
    await tx((t) => addBatchItem(t, actor, b2.id, { productId: b.id, qty: 3, unitCost: 670, currency: "TWD" }));
    await tx((t) => receiveAll(t, actor, b2.id, { receivedById: null }));
    await tx((t) => quickSale(t, actor, { productId: b.id, qty: 1, unitPrice: 800, idemKey: "merge-sale" }));

    const groups = await tx((t) => duplicateGroups(t, s.halloween.id));
    expect(groups).toHaveLength(1);
    expect(groups[0].keepId).toBe(a.id);
    expect(groups[0].products.map((p) => [p.bought, p.onHand, p.incoming])).toEqual([[2, 0, 2], [3, 2, 0]]);

    expect(await tx((t) => mergeProducts(t, actor, a.id, [b.id]))).toBe(1);
    const st = (await tx((t) => inventorySummary(t, [a.id]))).get(a.id)!;
    expect([st.onHand, st.incoming]).toEqual([2, 2]);
    expect(await prisma.purchaseBatchItem.count({ where: { productId: a.id } })).toBe(2);
    expect(await prisma.orderItem.count({ where: { productId: b.id } })).toBe(0);
    const gone = await prisma.product.findUniqueOrThrow({ where: { id: b.id } });
    expect([gone.archivedAt !== null, gone.mergedIntoId]).toEqual([true, a.id]);
    expect((await prisma.productCategory.findMany({ where: { productId: a.id } })).map((c) => c.categoryId).sort()).toEqual([s.halloween.id, s.shanghai.id].sort());
    expect(await tx((t) => duplicateGroups(t, s.halloween.id))).toEqual([]);
  });

  it("之後再買到被合併的那一款，會用留下的商品，不會再生出重複的", async () => {
    const { findVariant, variantKey } = await import("@/server/services/series");
    const [a, b] = await tx(async (t) => [await createProduct(t, actor, { name: "兔兔 吊娃" }), await createProduct(t, actor, { name: "兔兔 吊娃" })]);
    await prisma.product.update({ where: { id: b.id }, data: { variantKey: variantKey("s1", null, "c1", null, s.halloween.id) } });
    await tx((t) => mergeProducts(t, actor, a.id, [b.id]));
    const p = await findVariant(prisma, { seriesId: "s1", productTypeId: null, characterId: "c1", spec: null, category: { id: s.halloween.id, name: "萬聖節" } });
    expect(p?.id).toBe(a.id);
  });

  it("名稱不一樣的不能合併", async () => {
    await expect(tx((t) => mergeProducts(t, actor, s.p1.id, [s.p2.id]))).rejects.toThrow("名稱不一樣");
  });
});
