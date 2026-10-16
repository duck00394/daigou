import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { receiveAll } from "@/server/services/receiving";
import { listShippingMethods, saveShippingMethod } from "@/server/services/shipping-methods";
import { renameCategory } from "@/server/services/catalog";
import { inventorySummary } from "@/server/services/inventory";
import { batchStage } from "@/lib/labels";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("現貨：全部到了一次入庫", () => {
  it("把還沒收到的一次收進庫存；再按一次不會重複；砍單的不收", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "現貨團", supplier: "砂糖", orderedById: "op_a" }));
    const i1 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p3.id, qty: 3, unitCost: 600, currency: "TWD" }));
    await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 2, unitCost: 400, currency: "TWD" }));
    await prisma.purchaseBatchItem.update({ where: { id: i1.id }, data: { cancelledQty: 1 } });
    const before = (await tx((t) => inventorySummary(t, [s.p3.id]))).get(s.p3.id)?.onHand ?? 0;
    const r = await tx((t) => receiveAll(t, actor, b.id, { receivedById: null, dedupeKey: "all-1" }));
    expect(r.received).toBe(4); // 3−1 ＋ 2
    expect((await tx((t) => inventorySummary(t, [s.p3.id]))).get(s.p3.id)!.onHand).toBe(before + 2);
    const again = await tx((t) => receiveAll(t, actor, b.id, { receivedById: null, dedupeKey: "all-2" }));
    expect(again.received).toBe(0);
    const row = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(batchStage(row)).toBe("DONE");
    expect((await prisma.receivingRecord.findFirstOrThrow({ where: { batchId: b.id } })).receivedById).toBe("op_a");
  });

  it("合資團沒有主人時要指定收貨的人", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "合資現貨", supplier: "砂糖", ownership: "JOINT" }));
    await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p3.id, qty: 1, unitCost: 600, currency: "TWD" }));
    await expect(tx((t) => receiveAll(t, actor, b.id, { receivedById: null }))).rejects.toThrow("請先選這團是誰的");
    expect((await tx((t) => receiveAll(t, actor, b.id, { receivedById: "op_b" }))).received).toBe(1);
  });
});

describe("常用運費方式、活動改名", () => {
  it("新增、修改、停用運費方式；名稱不能重複、金額要整數", async () => {
    const a = await tx((t) => saveShippingMethod(t, actor, null, { name: "賣貨便", amount: 38 }));
    await tx((t) => saveShippingMethod(t, actor, null, { name: "EMS", amount: 1450, currency: "JPY", kind: "INTL_SHIPPING" }));
    await expect(tx((t) => saveShippingMethod(t, actor, null, { name: "賣貨便", amount: 40 }))).rejects.toThrow("已經有「賣貨便」了");
    await expect(tx((t) => saveShippingMethod(t, actor, null, { name: "交貨便", amount: 1.5 }))).rejects.toThrow("整數");
    await tx((t) => saveShippingMethod(t, actor, a.id, { name: "賣貨便", amount: 39, active: false }));
    expect((await listShippingMethods(prisma)).map((x) => x.name)).toEqual(["EMS"]);
    expect((await listShippingMethods(prisma, { includeInactive: true })).find((x) => x.id === a.id)).toMatchObject({ amount: 39, active: false, kind: "TW_DOMESTIC_SHIPPING" });
  });

  it("活動只改名稱，其他設定不變；名稱重複會擋", async () => {
    const before = await prisma.category.findUniqueOrThrow({ where: { id: s.halloween.id } });
    await tx((t) => renameCategory(t, actor, s.halloween.id, "萬聖節 2026"));
    const after = await prisma.category.findUniqueOrThrow({ where: { id: s.halloween.id } });
    expect([after.name, after.type, after.active]).toEqual(["萬聖節 2026", before.type, before.active]);
    await expect(tx((t) => renameCategory(t, actor, s.halloween.id, "上海限定"))).rejects.toThrow("已存在");
  });
});
