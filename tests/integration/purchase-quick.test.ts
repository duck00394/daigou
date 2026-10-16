import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, cancelBatch, createBatch, deleteBatchItem } from "@/server/services/purchase";
import { keepStock } from "@/server/services/inventory";
import { quickSale, voidQuickSale } from "@/server/services/quick-sale";
import { createProduct } from "@/server/services/catalog";
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

describe("手誤：已經收進庫存的也能刪／取消（東西還沒動過才可以）", () => {
  it("刪掉已入庫的品項：庫存一起拿掉；自留過的就不能刪", async () => {
    const [pa, pb] = await tx(async (t) => [await createProduct(t, actor, { name: "手誤商品 A" }), await createProduct(t, actor, { name: "手誤商品 B" })]);
    const b = await tx((t) => createBatch(t, actor, { name: "常設店", supplier: "常設店", orderedById: "op_a" }));
    const wrong = await tx((t) => addBatchItem(t, actor, b.id, { productId: pa.id, qty: 1, unitCost: 0, currency: "TWD" }));
    const kept = await tx((t) => addBatchItem(t, actor, b.id, { productId: pb.id, qty: 1, unitCost: 300, currency: "TWD" }));
    const before = (await tx((t) => inventorySummary(t, [pa.id]))).get(pa.id)?.onHand ?? 0;
    await tx((t) => receiveAll(t, actor, b.id, { receivedById: null }));
    expect((await tx((t) => inventorySummary(t, [pa.id]))).get(pa.id)!.onHand).toBe(before + 1);
    const r = await tx((t) => deleteBatchItem(t, actor, wrong.id));
    expect(r.undone).toBe(1);
    expect((await tx((t) => inventorySummary(t, [pa.id]))).get(pa.id)?.onHand ?? 0).toBe(before);
    expect(await prisma.receivingLine.count({ where: { batchItemId: wrong.id } })).toBe(0);
    // 自留過的：刪除時自留一起拿掉
    await tx((t) => keepStock(t, actor, { productId: pb.id, delta: 1, owner: "op_a" }));
    expect(await tx((t) => deleteBatchItem(t, actor, kept.id))).toEqual({ undone: 1, kept: 1 });
    expect((await tx((t) => inventorySummary(t, [pb.id]))).get(pb.id)?.kept ?? 0).toBe(0);
  });

  it("賣出的要先作廢才能刪；作廢後就可以刪，出售紀錄留著", async () => {
    const pc = await tx((t) => createProduct(t, actor, { name: "手誤商品 D" }));
    const b = await tx((t) => createBatch(t, actor, { name: "賣錯團", supplier: "常設店", orderedById: "op_a" }));
    const it = await tx((t) => addBatchItem(t, actor, b.id, { productId: pc.id, qty: 1, unitCost: 100, currency: "TWD" }));
    await tx((t) => receiveAll(t, actor, b.id, { receivedById: null }));
    const sale = await tx((t) => quickSale(t, actor, { productId: pc.id, qty: 1, unitPrice: 300, idemKey: "undo-sale-1" }));
    await expect(tx((t) => deleteBatchItem(t, actor, it.id))).rejects.toThrow("已經賣出 1 件");
    await tx((t) => voidQuickSale(t, actor, sale.orderId, "記錯了"));
    expect(await tx((t) => deleteBatchItem(t, actor, it.id))).toEqual({ undone: 1, kept: 0 });
    expect((await tx((t) => inventorySummary(t, [pc.id]))).get(pc.id)?.onHand ?? 0).toBe(0);
  });

  it("取消已收貨的團：還沒動過的庫存一起拿掉", async () => {
    const pa = await tx((t) => createProduct(t, actor, { name: "手誤商品 C" }));
    const b = await tx((t) => createBatch(t, actor, { name: "買錯的團", supplier: "常設店", orderedById: "op_a" }));
    await tx((t) => addBatchItem(t, actor, b.id, { productId: pa.id, qty: 2, unitCost: 500, currency: "TWD" }));
    const before = (await tx((t) => inventorySummary(t, [pa.id]))).get(pa.id)?.onHand ?? 0;
    await tx((t) => receiveAll(t, actor, b.id, { receivedById: null }));
    expect((await tx((t) => cancelBatch(t, actor, b.id))).undone).toBe(2);
    expect((await tx((t) => inventorySummary(t, [pa.id]))).get(pa.id)?.onHand ?? 0).toBe(before);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
  });
});

describe("實體店買的團：之後再加的品項也直接入庫", () => {
  it("加進實體店的團就入庫；跟代購買的團不會", async () => {
    const { bulkAddSeriesItems, saveSeries, saveSupplier, addCharactersToSeries } = await import("@/server/services/series");
    const { upsertCharacter } = await import("@/server/services/catalog");
    const ctx = await tx(async (t) => {
      const series = await saveSeries(t, actor, null, { name: "店測系列" });
      const c = await upsertCharacter(t, actor, { name: "店測角色" });
      await addCharactersToSeries(t, actor, series.id, { characterIds: [c.id] });
      const store = await saveSupplier(t, actor, null, { name: "常設店測試", kind: "STORE" });
      const agent = await saveSupplier(t, actor, null, { name: "代購測試", kind: "AGENT" });
      const sb = await createBatch(t, actor, { name: "店", supplierId: store.id, orderedById: "op_a" });
      const ab = await createBatch(t, actor, { name: "代", supplierId: agent.id, orderedById: "op_a" });
      return { series: series.id, c: c.id, sb: sb.id, ab: ab.id };
    });
    await bulkAddSeriesItems(actor, { batchId: ctx.sb, seriesId: ctx.series, productTypeId: null, submissionKey: "store-add-1", rows: [{ rowKey: "a", characterId: ctx.c, unitCost: 500, currency: "TWD", qty: 2 }] });
    await bulkAddSeriesItems(actor, { batchId: ctx.ab, seriesId: ctx.series, productTypeId: null, submissionKey: "agent-add-1", rows: [{ rowKey: "a", characterId: ctx.c, unitCost: 500, currency: "TWD", qty: 3 }] });
    const items = await prisma.purchaseBatchItem.findMany({ where: { batchId: { in: [ctx.sb, ctx.ab] } }, include: { receivingLines: true } });
    expect(items.find((i) => i.batchId === ctx.sb)!.receivingLines.reduce((s, l) => s + l.receivedQty, 0)).toBe(2);
    expect(items.find((i) => i.batchId === ctx.ab)!.receivingLines.length).toBe(0);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: ctx.sb } })).status).toBe("RECEIVED");
  });
});
