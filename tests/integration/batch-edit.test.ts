// 採購團：編輯時一起砍單、砍錯恢復；已確認／未確認；總計買了什麼（不一定有貨）
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { createBatch, landedCosts } from "@/server/services/purchase";
import { bulkUpdateBatchItems } from "@/server/services/series";
import { batchPaySummary, purchasedSummary, setBatchConfirmed } from "@/server/services/batch-ops";
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

  it("新開的團預設未確認；總計買了什麼：未確認的團裡還沒到的算「不一定有貨」", async () => {
    const a = await tx((t) => createBatch(t, actor, { name: "A", supplier: "代購", items: [{ productId: s.p1.id, qty: 3, unitCost: 400, currency: "TWD" }] }));
    const b = await tx((t) => createBatch(t, actor, { name: "B", supplier: "代購", items: [{ productId: s.p1.id, qty: 2, unitCost: 400, currency: "TWD" }] }));
    expect(a.confirmed).toBe(false);
    await tx((t) => setBatchConfirmed(t, actor, a.id, true));
    const ai = await prisma.purchaseBatchItem.findFirstOrThrow({ where: { batchId: a.id } });
    await tx((t) => receiveStock(t, actor, { productId: s.p1.id, qty: 1, batchItemId: ai.id }));
    const rows = await tx((t) => purchasedSummary(t, [a.id, b.id]));
    const r = rows.find((x) => x.productId === s.p1.id)!;
    expect([r.ordered, r.received, r.unsure, r.batches]).toEqual([5, 1, 2, 2]);
  });
});
