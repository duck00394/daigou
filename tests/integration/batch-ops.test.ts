import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchCost, addBatchItem, createBatch, updateBatchItem } from "@/server/services/purchase";
import { cancelBatchItem, categoryOverview, copyBatchItems, updateBatchInfo } from "@/server/services/batch-ops";
import { addSupplierPayment } from "@/server/services/supplier-payments";
import { createReceivingRecord } from "@/server/services/receiving";
import { ensureDefaultOperators } from "@/server/services/operators";
import { inventorySummary, keepStock, productLots, reserveForItem } from "@/server/services/inventory";
import { createOrder } from "@/server/services/orders";
import { createShipment } from "@/server/services/shipping";
import { saveSupplier } from "@/server/services/series";

let s: Awaited<ReturnType<typeof seedBasics>>;

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});

/** 同一活動四個供應商、四個採購團，同一商品不同價格／數量／幣別 */
async function fourBatches() {
  return tx(async (t) => {
    const names = ["代購小美", "代購小林", "代購群 C", "日本官網"];
    const out: { batchId: string; itemId: string }[] = [];
    const spec: [number, number, "TWD" | "JPY"][] = [[420, 3, "TWD"], [450, 5, "TWD"], [400, 2, "TWD"], [1650, 4, "JPY"]];
    for (const [k, n] of names.entries()) {
      const sp = await saveSupplier(t, actor, null, { name: n, defaultCurrency: spec[k][2], kind: k === 3 ? "OFFICIAL_ONLINE" : "AGENT" });
      const b = await createBatch(t, actor, { name: `聖誕 ${"ABCD"[k]} 團`, supplierId: sp.id, rate: "0.21", categoryId: s.halloween.id });
      const it = await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: spec[k][1], unitCost: spec[k][0], currency: spec[k][2] });
      out.push({ batchId: b.id, itemId: it.id });
    }
    return out;
  });
}

describe("活動總覽與跨團價格", () => {
  it("同一商品在四團價格獨立；修改其中一團不影響其他團；比較表與合計一致", async () => {
    const b = await fourBatches();
    await tx((t) => updateBatchItem(t, actor, b[1].itemId, { actualUnitCost: 440 }));
    const items = await prisma.purchaseBatchItem.findMany({ where: { productId: s.p1.id }, orderBy: { createdAt: "asc" } });
    expect(items.map((i) => [i.estUnitCost, i.actualUnitCost, i.qty, i.currency])).toEqual([[420, null, 3, "TWD"], [450, 440, 5, "TWD"], [400, null, 2, "TWD"], [1650, null, 4, "JPY"]]);

    await tx((t) => addBatchCost(t, actor, { batchId: b[0].batchId, kind: "INTL_SHIPPING", currency: "TWD", amount: 90, method: "BY_QTY" }));
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.batches).toHaveLength(4);
    expect(o.total.qty).toBe(14); // 不合併成一筆，但總數正確
    const row = o.matrix.find((r) => r.product.id === s.p1.id)!;
    expect(row.totalQty).toBe(14);
    expect(row.cells[b[0].batchId][0]).toMatchObject({ unitTwd: 420, fullUnitTwd: 450, estimated: true, feesConfirmed: true });
    expect(row.cells[b[1].batchId][0]).toMatchObject({ unitCost: 440, unitTwd: 440, estimated: false, feesConfirmed: false });
    expect(row.cells[b[3].batchId][0]).toMatchObject({ unitCost: 1650, currency: "JPY", unitTwd: 347 }); // 1650 × 0.21 依該團匯率
    expect(row.minUnitTwd).toBe(347);
    expect(row.maxUnitTwd).toBe(440);
    expect(row.anyEstimated).toBe(true);
    // 總成本 = 各團合計
    expect(o.total.totalTwd).toBe(o.batches.reduce((x, y) => x + y.totalTwd, 0));
    expect(o.batches[0].totalTwd).toBe(420 * 3 + 90);
    expect(o.batches[0].issues).toContain("尚未登記付款");
  });

  it("修改採購團基本資料（活動、訂單編號、預計到貨）留下修改前後紀錄", async () => {
    const b = await fourBatches();
    await tx((t) => updateBatchInfo(t, actor, b[0].batchId, { categoryId: s.shanghai.id, supplierOrderNo: "SO-1", expectedAt: new Date("2026-11-01T00:00:00Z") }));
    const row = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: b[0].batchId } });
    expect([row.categoryId, row.supplierOrderNo]).toEqual([s.shanghai.id, "SO-1"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "batch.updateInfo" } });
    expect(log.data).toMatchObject({ before: { categoryId: s.halloween.id, supplierOrderNo: null }, after: { categoryId: s.shanghai.id, supplierOrderNo: "SO-1" } });
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.batches).toHaveLength(3);
  });
});

describe("跨團複製品項", () => {
  it("只建立新品項，不複製付款、收貨、庫存；重送不重複", async () => {
    const b = await fourBatches();
    await tx(async (t) => {
      await addBatchItem(t, actor, b[0].batchId, { productId: s.p2.id, qty: 2, unitCost: 300, currency: "TWD" });
      await addSupplierPayment(t, actor, { batchId: b[0].batchId, paidById: "op_a", paidAt: new Date(), amount: 1860, currency: "TWD" });
      await createReceivingRecord(t, actor, { batchId: b[0].batchId, receivedById: "op_b", lines: [{ batchItemId: b[0].itemId, receivedQty: 3 }] });
    });
    const target = await tx((t) => createBatch(t, actor, { name: "聖誕 E 團", supplier: "新代購", categoryId: s.halloween.id }));
    const src = await prisma.purchaseBatchItem.findMany({ where: { batchId: b[0].batchId }, orderBy: { createdAt: "asc" } });
    const rows = [
      { sourceItemId: src[0].id, qty: 1, unitCost: 430, currency: "TWD" as const },
      { sourceItemId: src[1].id, qty: 4, unitCost: 300, currency: "TWD" as const },
    ];
    const r1 = await tx((t) => copyBatchItems(t, actor, { fromBatchId: b[0].batchId, toBatchId: target.id, submissionKey: "copy-key-1", rows }));
    const r2 = await tx((t) => copyBatchItems(t, actor, { fromBatchId: b[0].batchId, toBatchId: target.id, submissionKey: "copy-key-1", rows }));
    expect(r1).toEqual({ created: 2, duplicated: 0 });
    expect(r2).toEqual({ created: 0, duplicated: 2 });
    const copied = await prisma.purchaseBatchItem.findMany({ where: { batchId: target.id }, include: { movements: true, receivingLines: true } });
    expect(copied.map((c) => [c.estUnitCost, c.qty]).sort()).toEqual([[300, 4], [430, 1]]);
    expect(copied.every((c) => c.movements.length === 0 && c.receivingLines.length === 0)).toBe(true);
    expect(await prisma.supplierPayment.count({ where: { batchId: target.id } })).toBe(0);
    // 來源團不受影響
    expect((await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: src[0].id } })).estUnitCost).toBe(420);
  });
});

describe("砍單", () => {
  it("只砍一個品項的部分數量，其他品項不變；已到貨不能砍；已付款不會變成已退款", async () => {
    const b = await fourBatches();
    const other = await tx((t) => addBatchItem(t, actor, b[1].batchId, { productId: s.p2.id, qty: 2, unitCost: 300, currency: "TWD" }));
    await tx(async (t) => {
      await addSupplierPayment(t, actor, { batchId: b[1].batchId, paidById: "op_a", paidAt: new Date(), amount: 2850, currency: "TWD" });
      await createReceivingRecord(t, actor, { batchId: b[1].batchId, receivedById: "op_a", lines: [{ batchItemId: b[1].itemId, receivedQty: 1 }] });
    });
    await expect(tx((t) => cancelBatchItem(t, actor, b[1].itemId, { qty: 5, reason: "AGENT_CANCEL" }))).rejects.toThrow("最多只能砍 4 件");
    await expect(tx((t) => cancelBatchItem(t, actor, b[1].itemId, { qty: 1, reason: "OTHER" }))).rejects.toThrow("補充原因");
    const r = await tx((t) => cancelBatchItem(t, actor, b[1].itemId, { qty: 2, reason: "AGENT_CANCEL" }));
    expect(r).toMatchObject({ cancelled: 2, remaining: 3, paid: [{ currency: "TWD", amount: 2850 }] });
    const it = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: b[1].itemId } });
    expect([it.qty, it.cancelledQty, it.cancelReason]).toEqual([5, 2, "代購砍單"]);
    expect((await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: other.id } })).cancelledQty).toBe(0);
    expect(await prisma.supplierPayment.count({ where: { batchId: b[1].batchId, status: "PAID" } })).toBe(1);
    const inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!;
    expect(inv.incoming).toBe(3 + 2 + 2 + 4); // 這團剩 2 件在途
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.batches[1].issues).toContain("砍單 2 件");
  });

  it("砍單造成買家缺貨時列出受影響訂單，選擇標記才改為缺貨，不刪訂單", async () => {
    const b = await tx(async (t) => {
      const batch = await createBatch(t, actor, { name: "唯一團", supplier: "代購" });
      const order = await createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p3.id, qty: 2 }] });
      const later = await createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p3.id, qty: 1 }] });
      const item = await addBatchItem(t, actor, batch.id, { productId: s.p3.id, qty: 3, unitCost: 400, markOrderItemIds: [order.items[0].id, later.items[0].id] });
      return { item, order, later };
    });
    const r = await tx((t) => cancelBatchItem(t, actor, b.item.id, { qty: 1, reason: "OUT_OF_STOCK", markShortage: true }));
    expect(r.affected).toEqual([{ orderNo: b.later.orderNo, buyerName: "阿婷", qty: 1 }]); // 最晚下單的先缺
    const later = await prisma.orderItem.findUniqueOrThrow({ where: { id: b.later.items[0].id } });
    expect(later.purchaseFlag).toBe("OUT_OF_STOCK");
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: b.order.items[0].id } })).purchaseFlag).toBe("ORDERED");
    expect(await prisma.order.count()).toBe(2);
  });
});

describe("自留", () => {
  it("自留不算可售；保留給買家的不能自留；可改回出售；成本來源保留", async () => {
    const b = await fourBatches();
    const order = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: b[0].batchId, receivedById: "op_a", lines: [{ batchItemId: b[0].itemId, receivedQty: 3 }] }));
    await tx((t) => reserveForItem(t, actor, { orderItemId: order.items[0].id, qty: 1 }));
    await expect(tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 3 }))).rejects.toThrow("可用庫存只有 2 件");
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 2, dedupeKey: "keep-1" }));
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 2, dedupeKey: "keep-1" })); // 重送不重複
    let inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!;
    expect([inv.onHand, inv.reserved, inv.available, inv.kept]).toEqual([1, 1, 0, 2]);
    const keep = await prisma.inventoryMovement.findFirstOrThrow({ where: { kind: "KEEP" } });
    expect(keep.purchaseBatchItemId).toBe(b[0].itemId);
    // 已保留的商品照常出貨
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: order.items[0].id, qty: 1 }] }));
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: -1 }));
    inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!;
    expect([inv.onHand, inv.available, inv.kept, inv.shipped]).toEqual([1, 1, 1, 1]);
    await expect(tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: -2 }))).rejects.toThrow("自留只有 1 件");
    const lots = await tx((t) => productLots(t, s.p1.id));
    expect(lots.find((l) => l.batchItemId === b[0].itemId)!.onHand).toBe(1);
  });
});
