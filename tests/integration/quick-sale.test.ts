import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIntegrity } from "@/server/services/integrity";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchCost, addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { ensureDefaultOperators } from "@/server/services/operators";
import { inventorySummary, keepStock, productLots, reserveForItem } from "@/server/services/inventory";
import { createOrder } from "@/server/services/orders";
import { correctQuickSale, listQuickSales, quickSale, voidQuickSale } from "@/server/services/quick-sale";
import { monthlyReport } from "@/server/services/reports";
import { addPayment } from "@/server/services/payments";

let s: Awaited<ReturnType<typeof seedBasics>>;
let itemA: string;
let itemB: string;

/** 兔兔扭蛋：A 團 2 件（單價 100＋運費 20）、B 團 3 件（單價 150，未登記費用），全部到貨 */
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx(async (t) => {
    await ensureDefaultOperators(t);
    const a = await createBatch(t, actor, { name: "A 團", supplier: "代購甲" });
    itemA = (await addBatchItem(t, actor, a.id, { productId: s.p3.id, qty: 2, unitCost: 100, currency: "TWD", actualUnitCost: 100 })).id;
    await addBatchCost(t, actor, { batchId: a.id, kind: "INTL_SHIPPING", currency: "TWD", amount: 20, method: "BY_QTY" });
    await createReceivingRecord(t, actor, { batchId: a.id, receivedById: "op_a", lines: [{ batchItemId: itemA, receivedQty: 2 }] });
    const b = await createBatch(t, actor, { name: "B 團", supplier: "代購乙" });
    itemB = (await addBatchItem(t, actor, b.id, { productId: s.p3.id, qty: 3, unitCost: 150, currency: "TWD" })).id;
    await createReceivingRecord(t, actor, { batchId: b.id, receivedById: "op_b", lines: [{ batchItemId: itemB, receivedQty: 3 }] });
  });
});

const sell = (o: Partial<Parameters<typeof quickSale>[2]> = {}) => tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 1, unitPrice: 250, idemKey: "sale-key-1", ...o }));
const stock = async () => (await tx((t) => inventorySummary(t, [s.p3.id]))).get(s.p3.id)!;
const ym = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);


// 每項測試結束後交叉核對：庫存、訂單快取、到貨、費用分攤、出貨都要和流水一致
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("現貨直接出售", () => {
  it("扣可售庫存、先進先出取批次成本、記錄收入與毛利；重送不重複", async () => {
    const r = await sell({ qty: 3, idemKey: "sale-key-1" });
    expect(r).toMatchObject({ duplicated: false, qty: 3, revenue: 750, cost: 110 + 110 + 150, profit: 750 - 370, tentative: true });
    const again = await sell({ qty: 3, idemKey: "sale-key-1" });
    expect(again.duplicated).toBe(true);
    const st = await stock();
    expect([st.onHand, st.available, st.shipped]).toEqual([2, 2, 3]);
    expect(await prisma.order.count({ where: { source: "QUICK" } })).toBe(1);
    // 沒填買家記在「散客」，同時登記已收款
    const o = await prisma.order.findFirstOrThrow({ where: { source: "QUICK" }, include: { buyer: true, payments: true } });
    expect(o.buyer.name).toBe("散客");
    expect(o.payments.map((p) => p.amount)).toEqual([750]);
    expect(o.paymentStatusCache).toBe("PAID");
    // 月報口徑一致（收入依出貨、成本依批次）
    const m = await monthlyReport(prisma, ym());
    expect([m.revenue, m.cogs]).toEqual([750, 370]);
  });

  it("不能賣到已保留給買家或自留的數量", async () => {
    const order = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p3.id, qty: 2 }] }));
    await tx((t) => reserveForItem(t, actor, { orderItemId: order.items[0].id, qty: 2 }));
    await tx((t) => keepStock(t, actor, { productId: s.p3.id, delta: 2 }));
    await expect(sell({ qty: 2 })).rejects.toThrow("可售庫存只有 1 件");
    await sell({ qty: 1, buyerName: "小美" });
    const st = await stock();
    expect([st.reserved, st.kept, st.available]).toEqual([2, 2, 0]);
    expect((await prisma.order.findFirstOrThrow({ where: { source: "QUICK" } })).buyerId).toBe(s.b1.id); // 以名稱找到既有買家
  });

  it("作廢：庫存回到原批次、收入成本歸零、收款作廢、紀錄保留；不能重複作廢", async () => {
    const r = await sell({ qty: 3 });
    await tx((t) => voidQuickSale(t, actor, r.orderId, "輸入錯誤"));
    const st = await stock();
    expect([st.onHand, st.available, st.shipped]).toEqual([5, 5, 0]);
    const lots = await tx((t) => productLots(t, s.p3.id));
    expect(Object.fromEntries(lots.map((l) => [l.batchItemId, l.onHand]))).toEqual({ [itemA]: 2, [itemB]: 3 });
    const m = await monthlyReport(prisma, ym());
    expect([m.revenue, m.cogs, m.cashIn]).toEqual([0, 0, 0]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { payments: true, items: { include: { shipmentItems: true } } } });
    expect(o.payments[0].voidedAt).not.toBeNull();
    expect(o.items[0].shipmentItems.map((x) => x.qty).sort()).toEqual([-3, 3]);
    expect(await prisma.refund.count()).toBe(0);
    await expect(tx((t) => voidQuickSale(t, actor, r.orderId, "再一次"))).rejects.toThrow("已經作廢");
    const list = await tx((t) => listQuickSales(t, { includeVoided: true }));
    expect(list.rows[0]).toMatchObject({ voided: true, qty: 0, revenue: 0, cost: 0 });
    expect(list.total).toMatchObject({ count: 0, revenue: 0 });
  });

  it("更正：作廢舊的並建立正確的一筆，庫存只扣一次", async () => {
    const r = await sell({ qty: 1, unitPrice: 25 });
    const c = await tx((t) => correctQuickSale(t, actor, r.orderId, { productId: s.p3.id, qty: 2, unitPrice: 250, idemKey: "sale-key-2", reason: "價格少打一個 0" }));
    expect(c).toMatchObject({ qty: 2, revenue: 500, cost: 220 });
    const st = await stock();
    expect([st.onHand, st.shipped]).toEqual([3, 2]);
    const list = await tx((t) => listQuickSales(t, { includeVoided: true }));
    expect(list.rows.map((x) => x.voided).sort()).toEqual([false, true]);
    expect(list.total).toMatchObject({ count: 1, qty: 2, revenue: 500, cost: 220, profit: 280 });
  });

  it("一般訂單不能用現貨出售的作廢功能", async () => {
    const order = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p3.id, qty: 1 }] }));
    await expect(tx((t) => voidQuickSale(t, actor, order.id, "x"))).rejects.toThrow("只有「現貨出售」");
  });

  it("同一筆出售同時送出兩次，只建立一筆、只扣一次庫存", async () => {
    const [a, b] = await Promise.all([sell({ qty: 2, idemKey: "same-key-1" }), sell({ qty: 2, idemKey: "same-key-1" })]);
    expect(a.orderId).toBe(b.orderId);
    expect([a.duplicated, b.duplicated].sort()).toEqual([false, true]);
    expect(await prisma.order.count({ where: { source: "QUICK" } })).toBe(1);
    expect((await stock()).shipped).toBe(2);
  });

  it("作廢只作廢出售時自動登記的收款；另外手動登記的收款保留並顯示應退", async () => {
    const r = await sell({ qty: 1, paid: false });
    await tx((t) => addPayment(t, actor, { orderId: r.orderId, amount: 250, method: "現金", dedupeKey: "manual-pay-1" }));
    await tx((t) => voidQuickSale(t, actor, r.orderId, "客人退回"));
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { payments: true } });
    expect(o.payments.map((p) => p.voidedAt)).toEqual([null]);
    expect(o.refundDueCache).toBe(250);
  });

  it("庫存估值＋已賣出成本＝全部購入成本；自留、保留、可售分開估值", async () => {
    const { stockValuation } = await import("@/server/services/reports");
    const v0 = (await stockValuation(prisma, [s.p3.id])).byProduct.get(s.p3.id)!;
    expect(v0).toMatchObject({ free: 5, freeValue: 220 + 450, avgUnitCost: 134, tentative: true });
    const sold = await sell({ qty: 3 });
    const order = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p3.id, qty: 1 }] }));
    await tx((t) => reserveForItem(t, actor, { orderItemId: order.items[0].id, qty: 1 }));
    await tx((t) => keepStock(t, actor, { productId: s.p3.id, delta: 1 }));
    const v = (await stockValuation(prisma, [s.p3.id])).byProduct.get(s.p3.id)!;
    expect([v.free, v.reserved, v.kept]).toEqual([0, 1, 1]);
    expect(sold.cost + v.freeValue + v.reservedValue + v.keptValue).toBe(220 + 450);
    const inv = await stock();
    expect([inv.available, inv.reserved, inv.kept]).toEqual([v.free, v.reserved, v.kept]);
  });
});
