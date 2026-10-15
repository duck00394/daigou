import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { appendItems, cancelItemQty, cancelOrder, createOrder } from "@/server/services/orders";
import { addPayment, completeRefund, createRefund, voidPayment } from "@/server/services/payments";
import { adjustStock, inventorySummary, previewAllocation, receiveStock, reserveForItem } from "@/server/services/inventory";
import { createShipment } from "@/server/services/shipping";
import { addBatchCost, createBatch, landedCosts } from "@/server/services/purchase";
import { setDefaultRate } from "@/server/services/settings";
import { categoryDetail, categoryOverview, monthlyReport, currentYm } from "@/server/services/reports";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

const order = (o: Partial<Parameters<typeof createOrder>[2]> = {}) =>
  tx((t) =>
    createOrder(t, actor, {
      buyerId: s.b1.id,
      shippingFee: 60,
      items: [
        { productId: s.p1.id, qty: 2 },
        { productId: s.p2.id, qty: 1 },
      ],
      ...o,
    }),
  );

describe("訂單建立與金額", () => {
  it("預設售價、應收、可閱讀編號與預估成本快照", async () => {
    const o = await order();
    expect(o.orderNo).toMatch(/^O\d{6}-\d{3}$/);
    expect(o.receivableCache).toBe(500 * 2 + 300 + 60);
    expect(o.paymentStatusCache).toBe("UNPAID");
    const it1 = o.items.find((i) => i.productId === s.p1.id)!;
    expect(it1.estUnitCostTwd).toBe(360); // 商品預估成本
    const it2 = o.items.find((i) => i.productId === s.p2.id)!;
    expect(it2.estUnitCostTwd).toBe(Math.round(990 * 0.21)); // 以預設匯率估算
    expect(it2.estRateMicro).toBe(210000);
  });

  it("銷售歸屬分類：代購團的分類優先；只屬於一個分類時自動帶入", async () => {
    const o = await order({ groupBuyId: s.gb.id });
    expect(o.items.find((i) => i.productId === s.p1.id)!.categoryId).toBe(s.halloween.id);
    const o2 = await order({ items: [{ productId: s.p1.id, qty: 1 }, { productId: s.p3.id, qty: 1 }] });
    expect(o2.items.find((i) => i.productId === s.p1.id)!.categoryId).toBeNull(); // 兩個分類且無代購團 → 未歸類
    expect(o2.items.find((i) => i.productId === s.p3.id)!.categoryId).toBe(s.shanghai.id);
  });

  it("新匯率不影響舊訂單的成本快照", async () => {
    const o1 = await order();
    await tx((t) => setDefaultRate(t, actor, "0.25"));
    const o2 = await order();
    const old = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o1.id, productId: s.p2.id } });
    const neu = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o2.id, productId: s.p2.id } });
    expect(old.estUnitCostTwd).toBe(208);
    expect(neu.estUnitCostTwd).toBe(248);
  });

  it("追加到原訂單：保留原明細並記錄追加", async () => {
    const o = await order();
    await tx((t) => appendItems(t, actor, o.id, [{ productId: s.p3.id, qty: 3 }], "LINE 追加"));
    const items = await prisma.orderItem.findMany({ where: { orderId: o.id }, include: { events: true } });
    expect(items).toHaveLength(3);
    const added = items.find((i) => i.productId === s.p3.id)!;
    expect(added.addedLater).toBe(true);
    expect(added.events[0].type).toBe("APPENDED");
    expect(items.find((i) => i.productId === s.p1.id)!.events.map((e) => e.type)).toEqual(["CREATED"]);
  });

  it("獨立追加訂單必須是同一買家、同一代購團", async () => {
    const o = await order({ groupBuyId: s.gb.id });
    await expect(order({ buyerId: s.b2.id, parentOrderId: o.id, groupBuyId: s.gb.id })).rejects.toThrow("買家必須與原訂單相同");
    await expect(order({ parentOrderId: o.id })).rejects.toThrow("代購團");
    const linked = await order({ parentOrderId: o.id, groupBuyId: s.gb.id });
    expect(linked.parentOrderId).toBe(o.id);
  });
});

describe("付款、取消、退款", () => {
  it("部分付款 → 付清 → 取消一件 → 應退 → 待退款 → 已退款", async () => {
    const o = await order(); // 1360
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 1000 }));
    let r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect([r.paymentStatusCache, r.balanceCache]).toEqual(["PARTIAL", 360]);
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 360 }));
    r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.paymentStatusCache).toBe("PAID");
    expect(r.statusCache).toBe("CONFIRMED"); // 付清不代表出貨或完成

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id, productId: s.p1.id } });
    const c = await tx((t) => cancelItemQty(t, actor, { orderItemId: item.id, qty: 1, reason: "買家改單" }));
    expect(c.receivableAfter).toBe(860);
    expect(c.refundUnscheduled).toBe(500);
    r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.refundedCache).toBe(0); // 尚未退款，不能算已退
    expect(r.refundDueCache).toBe(500);

    const { refund } = await tx((t) => createRefund(t, actor, { orderId: o.id, amount: 500, cancellationId: c.cancellation.id, reason: "取消 1 件" }));
    r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect([r.paymentStatusCache, r.refundPendingCache, r.refundedCache]).toEqual(["REFUND_PENDING", 500, 0]);

    await tx((t) => completeRefund(t, actor, { refundId: refund.id }));
    r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect([r.paymentStatusCache, r.refundedCache, r.balanceCache, r.refundDueCache]).toEqual(["PARTIALLY_REFUNDED", 500, 0, 0]);

    // 取消紀錄與客觀交易紀錄都保留
    expect(await prisma.orderCancellation.count()).toBe(1);
    expect(await prisma.buyerIncident.count({ where: { buyerId: s.b1.id, kind: "CANCELLATION" } })).toBe(1);
  });

  it("退款不可超過可退金額；作廢付款保留紀錄", async () => {
    const o = await order();
    const { payment } = await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 300 }));
    await expect(tx((t) => createRefund(t, actor, { orderId: o.id, amount: 301 }))).rejects.toThrow("超過可退金額");
    await tx((t) => voidPayment(t, actor, { paymentId: payment.id, reason: "登記錯誤" }));
    const r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(r.paidCache).toBe(0);
    expect(await prisma.payment.count()).toBe(1);
  });

  it("付款重複送出（相同 dedupeKey）只記一筆", async () => {
    const o = await order();
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 100, dedupeKey: "k1" }));
    const again = await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 100, dedupeKey: "k1" }));
    expect(again.duplicated).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).paidCache).toBe(100);
  });

  it("整單取消：應收歸零、統計不再計入有效", async () => {
    const o = await order({ groupBuyId: s.gb.id });
    await tx((t) => cancelOrder(t, actor, { orderId: o.id, reason: "不要了" }));
    const r = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect([r.statusCache, r.receivableCache, r.confirmation]).toEqual(["CANCELLED", 0, "CANCELLED"]);
    const ov = await categoryOverview(prisma);
    const h = ov.categories.find((c) => c.id === s.halloween.id)!;
    expect(h.stats.activeQty).toBe(0);
    expect(h.stats.buyers.size).toBe(0);
    expect(h.stats.cancelledQty).toBe(3);
  });
});

describe("庫存、到貨、出貨", () => {
  it("部分到貨、部分出貨、剩餘數量正確；重複出貨不重複扣庫存", async () => {
    const o = await order({ items: [{ productId: s.p1.id, qty: 3 }] });
    const item = o.items[0];
    const batch = await tx((t) => createBatch(t, actor, { name: "10 月採購", rate: "0.2", items: [{ productId: s.p1.id, qty: 3, unitCostJpy: 1650, markOrderItemIds: [item.id] }] }));
    const bi = await prisma.purchaseBatchItem.findFirstOrThrow({ where: { batchId: batch.id } });
    let it = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(it.procurementStatusCache).toBe("ORDERED");

    // 先到 2 件
    await tx((t) => receiveStock(t, actor, { productId: s.p1.id, qty: 2, batchItemId: bi.id, dedupeKey: "rcv-1" }));
    const dupRcv = await tx((t) => receiveStock(t, actor, { productId: s.p1.id, qty: 2, batchItemId: bi.id, dedupeKey: "rcv-1" }));
    expect(dupRcv.duplicated).toBe(true);
    const plan = await tx((t) => previewAllocation(t, s.p1.id, 2));
    expect(plan.plan[0]).toMatchObject({ orderItemId: item.id, need: 3, allocate: 2 });
    await tx((t) => reserveForItem(t, actor, { orderItemId: item.id, qty: 2 }));
    it = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.procurementStatusCache, it.reservedQtyCache]).toEqual(["PARTIAL_ARRIVED", 2]);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("PARTIAL_RECEIVED");

    // 不能出貨超過保留（未開自動保留時）
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item.id, qty: 3 }] }))).rejects.toThrow("只保留了 2 件");

    // 出貨 1 件
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item.id, qty: 1 }], trackingNo: "TW123", dedupeKey: "ship-1" }));
    const again = await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item.id, qty: 1 }], dedupeKey: "ship-1" }));
    expect(again.duplicated).toBe(true);
    it = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.shippedQtyCache, it.reservedQtyCache, it.shipStatusCache]).toEqual([1, 1, "PARTIAL"]);
    let inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!;
    expect(inv).toMatchObject({ onHand: 1, reserved: 1, available: 0, incoming: 1, shipped: 1, activeOrdered: 3, openDemand: 2, unallocated: 1, shortage: 0 });

    const ord = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(ord.statusCache).toBe("PARTIAL");
    expect(ord.shipStatusCache).toBe("PARTIAL");

    // 取消剩下未到的 1 件；保留量剛好等於剩餘需求，不會被釋放
    await tx((t) => cancelItemQty(t, actor, { orderItemId: item.id, qty: 1 }));
    it = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.cancelledQtyCache, it.reservedQtyCache]).toEqual([1, 1]);
    // 再取消 1 件 → 已保留的那件被釋放回可用庫存
    await tx((t) => cancelItemQty(t, actor, { orderItemId: item.id, qty: 1 }));
    it = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.cancelledQtyCache, it.reservedQtyCache, it.shipStatusCache]).toEqual([2, 0, "SHIPPED"]);
    inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!;
    expect([inv.onHand, inv.reserved, inv.available]).toEqual([1, 0, 1]);
    // 已出貨的數量不能取消
    await expect(tx((t) => cancelItemQty(t, actor, { orderItemId: item.id, qty: 1 }))).rejects.toThrow("最多只能取消 0 件");
  });

  it("盤點扣除不能超過可用庫存；出貨可自動從可用庫存保留", async () => {
    await tx((t) => adjustStock(t, actor, { productId: s.p2.id, delta: 5, reason: "期初庫存", unitCostTwd: 200 }));
    const o = await order({ items: [{ productId: s.p2.id, qty: 2 }] });
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o.items[0].id, qty: 2 }], autoReserve: true }));
    await expect(tx((t) => adjustStock(t, actor, { productId: s.p2.id, delta: -4, reason: "盤損" }))).rejects.toThrow("可用庫存只有 3 件");
    const inv = (await tx((t) => inventorySummary(t, [s.p2.id]))).get(s.p2.id)!;
    expect([inv.onHand, inv.available, inv.shipped]).toEqual([3, 3, 2]);
  });

  it("不同買家的明細不能放進同一張出貨單", async () => {
    const o = await order({ buyerId: s.b2.id });
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o.items[0].id, qty: 1 }], autoReserve: true }))).rejects.toThrow("不屬於這位買家");
  });
});

describe("採購成本與利潤", () => {
  it("共同運費依件數分攤，總和不重複不遺漏；成本使用批次匯率快照", async () => {
    const batch = await tx((t) =>
      createBatch(t, actor, {
        name: "批次 A",
        rate: "0.2",
        items: [
          { productId: s.p1.id, qty: 2, unitCostJpy: 1650, weightGrams: 400 },
          { productId: s.p2.id, qty: 1, unitCostJpy: 990, weightGrams: 100 },
        ],
      }),
    );
    await tx((t) => addBatchCost(t, actor, { batchId: batch.id, kind: "INTL_SHIPPING", currency: "TWD", amount: 100, method: "BY_QTY" }));
    await tx((t) => addBatchCost(t, actor, { batchId: batch.id, kind: "JP_DOMESTIC_SHIPPING", currency: "JPY", amount: 1000, method: "BY_WEIGHT" }));
    const allocs = await prisma.costAllocation.findMany({ include: { batchCost: true } });
    const intl = allocs.filter((a) => a.batchCost.kind === "INTL_SHIPPING").map((a) => a.amountTwd).sort();
    expect(intl.reduce((a, b) => a + b, 0)).toBe(100);
    expect(intl).toEqual([33, 67]);
    const dom = allocs.filter((a) => a.batchCost.kind === "JP_DOMESTIC_SHIPPING").map((a) => a.amountTwd);
    expect(dom.reduce((a, b) => a + b, 0)).toBe(200); // 1000 円 × 0.2
    await tx((t) => setDefaultRate(t, actor, "0.3")); // 不影響已建立批次
    const lc = await tx((t) => landedCosts(t));
    const items = await prisma.purchaseBatchItem.findMany({ where: { batchId: batch.id } });
    const a = lc.get(items.find((i) => i.productId === s.p1.id)!.id)!;
    expect(a.goodsTwd).toBe(660); // 1650×2×0.2
    expect(a.feesTwd).toBe(67 + 160);
  });

  it("本月報表：已實現營收、銷貨成本、利潤與現金分開", async () => {
    const o = await order({ items: [{ productId: s.p1.id, qty: 2 }], shippingFee: 60 }); // 應收 1060
    const batch = await tx((t) => createBatch(t, actor, { name: "B", rate: "0.2", items: [{ productId: s.p1.id, qty: 2, unitCostJpy: 1500 }] }));
    const bi = await prisma.purchaseBatchItem.findFirstOrThrow({ where: { batchId: batch.id } });
    await tx((t) => addBatchCost(t, actor, { batchId: batch.id, kind: "INTL_SHIPPING", currency: "TWD", amount: 100, method: "BY_QTY" }));
    await tx((t) => receiveStock(t, actor, { productId: s.p1.id, qty: 2, batchItemId: bi.id }));
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 1060 }));
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o.items[0].id, qty: 1 }], autoReserve: true }));
    const rep = await monthlyReport(prisma, currentYm());
    expect(rep.revenue).toBe(500 + 30); // 一件 + 一半運費
    expect(rep.cogs).toBe(350); // (1500×2×0.2 + 100) / 2
    expect(rep.realizedProfit).toBe(530 - 350);
    expect(rep.cashIn).toBe(1060); // 收款不等於營收
    expect(rep.bookedSales).toBe(1060);
  });
});

describe("分類統計口徑", () => {
  it("同一買家多次購買同一商品：人數 1、件數加總；分類間不重複計算", async () => {
    await order({ groupBuyId: s.gb.id, items: [{ productId: s.p1.id, qty: 2 }] });
    await order({ groupBuyId: s.gb.id, items: [{ productId: s.p1.id, qty: 1 }] });
    await order({ buyerId: s.b2.id, groupBuyId: s.gb.id, items: [{ productId: s.p1.id, qty: 1 }] });
    // 同一商品歸屬上海限定的訂單
    await order({ buyerId: s.b3.id, items: [{ productId: s.p1.id, qty: 4, categoryId: s.shanghai.id }] });
    const d = await categoryDetail(prisma, s.halloween.id);
    expect(d.total.activeQty).toBe(4);
    expect(d.total.buyers.size).toBe(2);
    const p = d.products.find((x) => x.product.id === s.p1.id)!;
    expect(p.stats.activeQty).toBe(4);
    const sh = await categoryDetail(prisma, s.shanghai.id);
    expect(sh.total.activeQty).toBe(4);
    expect(sh.total.buyers.size).toBe(1);
    expect(d.products).toHaveLength(2); // 萬聖節：吉伊吊娃、小八 S 娃
    expect(d.total.toPurchase).toBe(4);
  });
});
