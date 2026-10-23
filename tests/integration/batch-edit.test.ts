// 採購團：編輯時一起砍單、砍錯恢復；已確認／未確認；總計買了什麼（不一定有貨）
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { createBatch, landedCosts } from "@/server/services/purchase";
import { bulkUpdateBatchItems } from "@/server/services/series";
import { batchPaySummary, purchasedSummary } from "@/server/services/batch-ops";
import { reconcileList, reconcileSheet, saveReconcile } from "@/server/services/reconcile";
import { receiveStock } from "@/server/services/inventory";
import { checkIntegrity } from "@/server/services/integrity";

describe("採購團編輯與確認", () => {
  let s: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    await resetDb();
    s = await seedBasics();
  });

  it("編輯時一起改單價和砍單；砍錯可以恢復；總額跟著重算", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "A 團", supplier: "代購", items: [{ productId: s.p1.id, qty: 3, unitCost: 400, currency: "TWD" }, { productId: s.p2.id, qty: 2, unitCost: 300, currency: "TWD" }] }));
    const items = await prisma.purchaseBatchItem.findMany({ where: { batchId: b.id }, orderBy: { createdAt: "asc" } });
    let r = await bulkUpdateBatchItems(actor, b.id, [{ itemId: items[0].id, actualUnitCost: 420, cancelQty: 1, cancelReason: "AGENT_CANCEL" }]);
    expect(r.ok).toBe(true);
    let it = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: items[0].id } });
    expect([it.cancelledQty, it.cancelReason, it.actualUnitCost]).toEqual([1, "代購砍單", 420]);
    expect((await tx((t) => batchPaySummary(t, [b.id]))).get(b.id)!.totalTwd).toBe(420 * 2 + 600);
    // 砍太多：整批不寫入
    r = await bulkUpdateBatchItems(actor, b.id, [{ itemId: items[1].id, qty: 5 }, { itemId: items[0].id, cancelQty: 9, cancelReason: "AGENT_CANCEL" }]);
    expect(r.ok).toBe(false);
    expect((await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: items[1].id } })).qty).toBe(2);
    // 恢復
    r = await bulkUpdateBatchItems(actor, b.id, [{ itemId: items[0].id, restoreQty: 1 }]);
    expect(r.ok).toBe(true);
    it = await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: items[0].id } });
    expect([it.cancelledQty, it.cancelReason]).toEqual([0, null]);
    expect((await tx((t) => landedCosts(t, [it.id]))).get(it.id)!.goodsTwd).toBe(420 * 3);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("總計買了什麼：對單還沒確認的算「不一定有貨」", async () => {
    const a = await tx((t) => createBatch(t, actor, { name: "A", supplier: "代購", items: [{ productId: s.p1.id, qty: 3, unitCost: 400, currency: "TWD" }] }));
    const b = await tx((t) => createBatch(t, actor, { name: "B", supplier: "代購", items: [{ productId: s.p1.id, qty: 2, unitCost: 400, currency: "TWD" }] }));
    const ai = await prisma.purchaseBatchItem.findFirstOrThrow({ where: { batchId: a.id } });
    await tx((t) => saveReconcile(t, actor, a.id, { rows: [{ itemId: ai.id, bought: 3, cutRest: false }] }));
    await tx((t) => receiveStock(t, actor, { productId: s.p1.id, qty: 1, batchItemId: ai.id }));
    const rows = await tx((t) => purchasedSummary(t, [a.id, b.id]));
    const r = rows.find((x) => x.productId === s.p1.id)!;
    expect([r.ordered, r.received, r.unsure, r.batches]).toEqual([5, 1, 2, 2]);
  });

  it("對單：一團裡有的買到、有的砍、有的還沒回；到貨的一定算買到；對完自動離開清單", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "對單團", supplier: "代購", items: [{ productId: s.p1.id, qty: 3, unitCost: 400, currency: "TWD" }, { productId: s.p2.id, qty: 2, unitCost: 300, currency: "TWD" }] }));
    let list = await tx((t) => reconcileList(t));
    expect(list.todo.find((x) => x.id === b.id)!.pending).toBe(5);
    const [i1, i2] = await prisma.purchaseBatchItem.findMany({ where: { batchId: b.id }, orderBy: { createdAt: "asc" } });
    // 吉伊買到 2、剩 1 砍；小八還沒回
    await expect(tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i1.id, bought: 2, cutRest: true }] }))).rejects.toThrow("砍單原因");
    await expect(tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i1.id, bought: 9, cutRest: false }] }))).rejects.toThrow("只訂了 3");
    let r = await tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i1.id, bought: 2, cutRest: true }], reason: "AGENT_CANCEL" }));
    expect(r.pending).toBe(2);
    let sheet = await tx((t) => reconcileSheet(t, b.id));
    expect(sheet.items.map((i) => [i.bought, i.cut, i.pending])).toEqual([[2, 1, 0], [0, 0, 2]]);
    expect((await tx((t) => batchPaySummary(t, [b.id]))).get(b.id)!.totalTwd).toBe(800 + 600);
    // 小八到了 1 件：到貨的算買到，待確認剩 1
    await tx((t) => receiveStock(t, actor, { productId: s.p2.id, qty: 1, batchItemId: i2.id }));
    sheet = await tx((t) => reconcileSheet(t, b.id));
    expect(sheet.items[1].pending).toBe(1);
    await expect(tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i2.id, bought: 0, cutRest: false }] }))).rejects.toThrow("已經到貨 1 件");
    r = await tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i2.id, bought: 2, cutRest: false }] }));
    expect(r.pending).toBe(0);
    list = await tx((t) => reconcileList(t));
    expect(list.todo.some((x) => x.id === b.id)).toBe(false);
    expect(list.done.some((x) => x.id === b.id)).toBe(true);
    // 之後改數量變少：買到的跟著調
    await bulkUpdateBatchItems(actor, b.id, [{ itemId: i2.id, qty: 1 }]);
    expect((await prisma.purchaseBatchItem.findUniqueOrThrow({ where: { id: i2.id } })).confirmedQty).toBe(1);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("對單時一起填總共付了多少：記差額一筆付款；填少了擋下來；重送不重複", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "付款團", supplier: "代購", items: [{ productId: s.p1.id, qty: 2, unitCost: 500, currency: "TWD" }] }));
    const [i1] = await prisma.purchaseBatchItem.findMany({ where: { batchId: b.id } });
    let r = await tx((t) => saveReconcile(t, actor, b.id, { rows: [{ itemId: i1.id, bought: 1, cutRest: true }], reason: "AGENT_CANCEL", paidTotal: 300, payKey: "pay-key-0001" }));
    expect([r.pay.totalTwd, r.pay.paidTwd, r.pay.dueTwd, r.paidAdded]).toEqual([500, 300, 200, 300]);
    r = await tx((t) => saveReconcile(t, actor, b.id, { rows: [], paidTotal: 300, payKey: "pay-key-0001" }));
    expect(r.paidAdded).toBe(0);
    await expect(tx((t) => saveReconcile(t, actor, b.id, { rows: [], paidTotal: 100 }))).rejects.toThrow("要改少");
    r = await tx((t) => saveReconcile(t, actor, b.id, { rows: [], paidTotal: 500, payKey: "pay-key-0002" }));
    expect(r.pay.dueTwd).toBe(0);
    expect(await prisma.supplierPayment.count({ where: { batchId: b.id } })).toBe(2);
  });
});

describe("種類、系列排順序", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("種類與系列可以移到最上面、上移、下移；下拉選單照這個順序", async () => {
    const { saveCategory } = await import("@/server/services/catalog");
    const { seriesOptions, moveKind, moveSeriesOrder } = await import("@/server/services/catalog-tree");
    const { kindsOf } = await import("@/components/series-picker");
    const a = await tx((t) => saveCategory(t, actor, null, { name: "肉包", type: "CUSTOM", customType: "常設店" }));
    await tx((t) => saveCategory(t, actor, null, { name: "便當", type: "CUSTOM", customType: "常設店" }));
    const c = await tx((t) => saveCategory(t, actor, null, { name: "聖誕節", type: "FESTIVAL" }));
    await tx((t) => moveKind(t, actor, "FESTIVAL", "top"));
    let opts = await seriesOptions(prisma);
    expect(kindsOf(opts).map(([, l]) => l)).toEqual(["節慶", "常設店"]);
    expect(opts[0].id).toBe(c.id);
    await tx((t) => moveSeriesOrder(t, actor, a.id, "top"));
    opts = await seriesOptions(prisma);
    expect(opts.filter((o) => o.kindLabel === "常設店").map((o) => o.name)).toEqual(["肉包", "便當"]);
    await tx((t) => moveSeriesOrder(t, actor, a.id, "down"));
    opts = await seriesOptions(prisma);
    expect(opts.filter((o) => o.kindLabel === "常設店").map((o) => o.name)).toEqual(["便當", "肉包"]);
    await tx((t) => moveKind(t, actor, "FESTIVAL", "down"));
    expect(kindsOf(await seriesOptions(prisma)).map(([, l]) => l)).toEqual(["常設店", "節慶"]);
  });
});
