// 真實使用情境：多團購入 → 付款與費用 → 砍單 → 分批到貨與瑕疵 → 預購保留 → 自留 → 現貨出售／更正／作廢
// → 出貨 → 取消退款 → 確認實際成本 → 備份還原。每一步之後都做資料健康檢查，最後交叉核對金額與庫存。
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { checkIntegrity } from "@/server/services/integrity";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchCost, addBatchItem, createBatch, landedCosts, updateBatchItem } from "@/server/services/purchase";
import { cancelBatchItem } from "@/server/services/batch-ops";
import { addSupplierPayment } from "@/server/services/supplier-payments";
import { createReceivingRecord } from "@/server/services/receiving";
import { inventorySummary, keepStock, reserveForItem } from "@/server/services/inventory";
import { cancelItemQty, createOrder } from "@/server/services/orders";
import { addPayment, completeRefund, createRefund } from "@/server/services/payments";
import { createShipment } from "@/server/services/shipping";
import { correctQuickSale, listQuickSales, quickSale, saleSummary, voidQuickSale } from "@/server/services/quick-sale";
import { monthlyReport } from "@/server/services/reports";
import { updateProduct } from "@/server/services/catalog";
import { setDefaultRate } from "@/server/services/settings";
import { createBackup, restoreBackup } from "@/server/services/backup";

let s: Awaited<ReturnType<typeof seedBasics>>;
const ctx: Record<string, string> = {};
const ym = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const healthy = async () => expect(await checkIntegrity(prisma)).toEqual([]);
const stock = async (productId: string) => (await tx((t) => inventorySummary(t, [productId]))).get(productId)!;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});

describe.sequential("收藏與轉售完整情境", () => {
  it("1. 三個採購團購入同一商品，價格、幣別各自保留", async () => {
    await tx(async (t) => {
      const a = await createBatch(t, actor, { name: "A 團", supplier: "代購小美" });
      ctx.aP1 = (await addBatchItem(t, actor, a.id, { productId: s.p1.id, qty: 3, unitCost: 420, currency: "TWD" })).id;
      ctx.aP2 = (await addBatchItem(t, actor, a.id, { productId: s.p2.id, qty: 2, unitCost: 300, currency: "TWD" })).id;
      ctx.a = a.id;
      const b = await createBatch(t, actor, { name: "B 團", supplier: "日本官網", rate: "0.21" });
      ctx.bP1 = (await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 5, unitCost: 1650, currency: "JPY" })).id;
      ctx.bP3 = (await addBatchItem(t, actor, b.id, { productId: s.p3.id, qty: 4, unitCost: 400, currency: "JPY" })).id;
      ctx.b = b.id;
      const c = await createBatch(t, actor, { name: "C 團", supplier: "代購群" });
      ctx.cP1 = (await addBatchItem(t, actor, c.id, { productId: s.p1.id, qty: 2, unitCost: 400, currency: "TWD" })).id;
      ctx.c = c.id;
    });
    const p1 = await prisma.purchaseBatchItem.findMany({ where: { productId: s.p1.id }, orderBy: { createdAt: "asc" } });
    expect(p1.map((i) => [i.estUnitCost, i.currency, i.qty])).toEqual([[420, "TWD", 3], [1650, "JPY", 5], [400, "TWD", 2]]);
    expect((await stock(s.p1.id)).incoming).toBe(10);
    expect((await stock(s.p1.id)).onHand).toBe(0); // 到貨前不算持有
    await healthy();
  });

  it("2. 分次付款、不同付款人與幣別；共同費用分攤", async () => {
    await tx(async (t) => {
      await addSupplierPayment(t, actor, { batchId: ctx.a, paidById: "op_a", paidAt: new Date(), amount: 1000, currency: "TWD", purpose: "DEPOSIT", dedupeKey: "pay-a-1" });
      await addSupplierPayment(t, actor, { batchId: ctx.a, paidById: "op_b", paidAt: new Date(), amount: 860, currency: "TWD", purpose: "BALANCE", dedupeKey: "pay-a-2" });
      await addSupplierPayment(t, actor, { batchId: ctx.b, paidById: "op_a", paidAt: new Date(), amount: 9850, currency: "JPY", rate: "0.205", dedupeKey: "pay-b-1" });
      await addSupplierPayment(t, actor, { batchId: ctx.b, paidById: "op_a", paidAt: new Date(), amount: 9850, currency: "JPY", rate: "0.205", dedupeKey: "pay-b-1" }); // 重送
      await addBatchCost(t, actor, { batchId: ctx.a, kind: "TW_DOMESTIC_SHIPPING", currency: "TWD", amount: 100, method: "BY_QTY" });
      await addBatchCost(t, actor, { batchId: ctx.b, kind: "INTL_SHIPPING", currency: "JPY", amount: 2000, method: "BY_VALUE" });
    });
    expect(await prisma.supplierPayment.count()).toBe(3);
    await healthy();
  });

  it("3. 砍單：C 團整個品項、A 團小八部分；費用重新分攤；付款不變", async () => {
    await tx((t) => cancelBatchItem(t, actor, ctx.cP1, { qty: 2, reason: "AGENT_CANCEL" }));
    await tx((t) => cancelBatchItem(t, actor, ctx.aP2, { qty: 1, reason: "OUT_OF_STOCK" }));
    expect((await stock(s.p1.id)).incoming).toBe(8);
    const l = await tx((t) => landedCosts(t, [ctx.aP1, ctx.aP2]));
    expect(l.get(ctx.aP1)!.feesTwd + l.get(ctx.aP2)!.feesTwd).toBe(100); // 運費改由剩下 4 件分攤
    expect(l.get(ctx.aP1)!.feesTwd).toBe(75);
    expect(await prisma.supplierPayment.count({ where: { status: "PAID" } })).toBe(3);
    await healthy();
  });

  it("4. 修改商品參考價與預設匯率，不影響已購入成本", async () => {
    const before = await tx((t) => landedCosts(t));
    await tx((t) => updateProduct(t, actor, s.p1.id, { name: "吉伊吊娃", salePriceTwd: 999, officialPriceJpy: 3000, categoryIds: [s.halloween.id, s.shanghai.id] }));
    await tx((t) => setDefaultRate(t, actor, "0.3"));
    const after = await tx((t) => landedCosts(t));
    expect([...after.entries()]).toEqual([...before.entries()]);
  });

  it("5. 分批到貨與瑕疵：只有良品入庫，重送不重複", async () => {
    await tx((t) => createReceivingRecord(t, actor, { batchId: ctx.a, receivedById: "op_a", dedupeKey: "rcv-a-1", lines: [{ batchItemId: ctx.aP1, receivedQty: 2, defectQty: 1 }] }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: ctx.a, receivedById: "op_a", dedupeKey: "rcv-a-1", lines: [{ batchItemId: ctx.aP1, receivedQty: 2, defectQty: 1 }] }));
    expect((await stock(s.p1.id)).onHand).toBe(1);
    await tx((t) => createReceivingRecord(t, actor, { batchId: ctx.a, receivedById: "op_b", lines: [{ batchItemId: ctx.aP1, receivedQty: 2 }, { batchItemId: ctx.aP2, receivedQty: 1 }] }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: ctx.b, receivedById: "op_b", lines: [{ batchItemId: ctx.bP1, receivedQty: 5 }, { batchItemId: ctx.bP3, receivedQty: 4, defectQty: 1 }] }));
    const p1 = await stock(s.p1.id);
    expect([p1.onHand, p1.incoming]).toEqual([8, 0]);
    const p3 = await stock(s.p3.id);
    expect([p3.onHand, p3.incoming]).toEqual([3, 1]); // 瑕疵那件仍待補
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: ctx.a } })).status).toBe("RECEIVED");
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: ctx.b } })).status).toBe("PARTIAL_RECEIVED");
    await healthy();
  });

  it("6. 買家預購保留、自留：可售正確扣除，不能重複賣", async () => {
    const o1 = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }] }));
    const o2 = await tx((t) => createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p3.id, qty: 1, unitPrice: 150 }] }));
    ctx.o1 = o1.id;
    ctx.o1i = o1.items[0].id;
    ctx.o2 = o2.id;
    ctx.o2i = o2.items[0].id;
    await tx((t) => reserveForItem(t, actor, { orderItemId: ctx.o1i, qty: 2 }));
    await tx((t) => reserveForItem(t, actor, { orderItemId: ctx.o2i, qty: 1 }));
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 3, dedupeKey: "keep-1" }));
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: -1, dedupeKey: "keep-2" }));
    const p1 = await stock(s.p1.id);
    expect([p1.onHand, p1.reserved, p1.kept, p1.available]).toEqual([6, 2, 2, 4]);
    await expect(tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 5, unitPrice: 600, idemKey: "qs-key-too-many" }))).rejects.toThrow("可售庫存只有 4 件");
    await healthy();
  });

  it("7. 現貨出售：多件跨批次、未收款、更正、作廢；重複送出不重複", async () => {
    const r1 = await tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 3, unitPrice: 600, idemKey: "qs-key-1" }));
    await tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 3, unitPrice: 600, idemKey: "qs-key-1" }));
    expect((await stock(s.p1.id)).available).toBe(1);
    const r2 = await tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 1, unitPrice: 200, buyerName: "路人甲", paid: false, idemKey: "qs-key-2" }));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r2.orderId } })).balanceCache).toBe(200);
    // 更正 r1：數量 3 → 2、價格 600 → 650
    const r1b = await tx((t) => correctQuickSale(t, actor, r1.orderId, { productId: s.p1.id, qty: 2, unitPrice: 650, idemKey: "qs-key-1b", reason: "少賣一件" }));
    expect(r1b).toMatchObject({ qty: 2, revenue: 1300 });
    // 作廢 r2
    await tx((t) => voidQuickSale(t, actor, r2.orderId, "沒成交"));
    const p1 = await stock(s.p1.id);
    expect([p1.onHand, p1.available, p1.shipped]).toEqual([4, 2, 2]);
    expect((await stock(s.p3.id)).available).toBe(2);
    ctx.sale = r1b.orderId;
    await healthy();
  });

  it("8. 買家出貨、取消並退款", async () => {
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: ctx.o1i, qty: 2 }], dedupeKey: "ship-1" }));
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: ctx.o1i, qty: 2 }], dedupeKey: "ship-1" }));
    await tx((t) => addPayment(t, actor, { orderId: ctx.o2, amount: 150, dedupeKey: "pay-o2" }));
    await tx((t) => cancelItemQty(t, actor, { orderItemId: ctx.o2i, qty: 1, reason: "買家不要了" }));
    const o2 = await prisma.order.findUniqueOrThrow({ where: { id: ctx.o2 } });
    expect(o2.refundDueCache).toBe(150); // 已收但未退：不會自動當成已退款
    const ref = await tx((t) => createRefund(t, actor, { orderId: ctx.o2, amount: 150, reason: "取消", dedupeKey: "ref-1" }));
    await tx((t) => completeRefund(t, actor, { refundId: ref.refund.id }));
    expect((await stock(s.p3.id)).available).toBe(3); // 保留釋放回可售
    expect((await stock(s.p1.id)).onHand).toBe(2);
    await healthy();
  });

  it("9. 確認實際單價後，成本更新且報表、出售紀錄、單筆毛利一致", async () => {
    const before = await tx((t) => saleSummary(t, ctx.sale));
    await tx((t) => updateBatchItem(t, actor, ctx.bP1, { actualUnitCost: 1600 }));
    const after = await tx((t) => saleSummary(t, ctx.sale));
    const list = await tx((t) => listQuickSales(t, {}));
    const m = await monthlyReport(prisma, ym());
    // 本月收入 = 現貨出售（2 × 650）＋ 小美出貨（2 × 500）
    expect(m.revenue).toBe(1300 + 1000);
    expect(list.total.revenue).toBe(1300);
    expect(list.total.cost).toBe(after.cost);
    // 本月銷貨成本 = 現貨出售成本 ＋ 小美那 2 件的成本（同一套批次成本）
    const o1Moves = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: ctx.o1i } });
    const lc = await tx((t) => landedCosts(t));
    const o1Cost = o1Moves.reduce((sum, mv) => {
      const l = lc.get(mv.purchaseBatchItemId!)!;
      return sum + Math.round((l.totalTwd * -mv.onHandDelta) / l.qty);
    }, 0);
    expect(m.cogs).toBe(after.cost + o1Cost);
    const saleLots = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItem: { orderId: ctx.sale } }, select: { purchaseBatchItemId: true } });
    if (saleLots.some((x) => x.purchaseBatchItemId === ctx.bP1)) expect(after.cost).not.toBe(before.cost); // 用到 B 團的批次，成本隨實際單價更新
    else expect(after.cost).toBe(before.cost);
    await healthy();
  });

  it("10. 備份還原後資料與健康檢查一致", async () => {
    const before = { p1: await stock(s.p1.id), p3: await stock(s.p3.id), sales: (await tx((t) => listQuickSales(t, { includeVoided: true }))).total, report: await monthlyReport(prisma, ym()) };
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await restoreBackup(actor, backup, { wipe: true });
    const after = { p1: await stock(s.p1.id), p3: await stock(s.p3.id), sales: (await tx((t) => listQuickSales(t, { includeVoided: true }))).total, report: await monthlyReport(prisma, ym()) };
    expect(after).toEqual(before);
    await healthy();
  });
});
