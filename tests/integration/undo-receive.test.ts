// 按錯了：撤回收貨；刪除已取消、沒付過錢的團
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { cancelBatch, createBatch, deleteBatch } from "@/server/services/purchase";
import { receiveAll, undoReceiving } from "@/server/services/receiving";
import { inventorySummary, keepStock } from "@/server/services/inventory";
import { addSupplierPayment } from "@/server/services/supplier-payments";
import { checkIntegrity } from "@/server/services/integrity";

describe("撤回收貨、刪除取消的團", () => {
  let s: Awaited<ReturnType<typeof seedBasics>>;
  beforeEach(async () => {
    await resetDb();
    s = await seedBasics();
  });

  it("全部到了按錯：撤回後庫存拿掉、這團變回還沒到；已自留的擋下來", async () => {
    const op = await prisma.operator.create({ data: { code: "U", name: "小明" } });
    const b = await tx((t) => createBatch(t, actor, { name: "按錯團", supplier: "代購", orderedById: op.id, items: [{ productId: s.p1.id, qty: 3, unitCost: 100, currency: "TWD" }] }));
    await tx((t) => receiveAll(t, actor, b.id, { receivedById: op.id }));
    expect((await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!.onHand).toBe(3);
    // 自留了 1 件：不能整批撤回
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 1 }));
    await expect(tx((t) => undoReceiving(t, actor, { batchId: b.id }))).rejects.toThrow("要先作廢出售或取消自留");
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: -1 }));
    const rec = await prisma.receivingRecord.findFirstOrThrow({ where: { batchId: b.id } });
    const r = await tx((t) => undoReceiving(t, actor, { batchId: b.id, recordId: rec.id }));
    expect(r.qty).toBe(3);
    expect((await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!.onHand).toBe(0);
    expect(await prisma.receivingRecord.count({ where: { batchId: b.id } })).toBe(0);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("ORDERED");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("已取消、沒付錢的團可以刪；有付款的擋下來；沒取消的不能刪", async () => {
    const a = await tx((t) => createBatch(t, actor, { name: "取消團", supplier: "代購", items: [{ productId: s.p1.id, qty: 2, unitCost: 100, currency: "TWD" }] }));
    await expect(tx((t) => deleteBatch(t, actor, a.id))).rejects.toThrow("要先取消");
    await tx((t) => cancelBatch(t, actor, a.id));
    await tx((t) => deleteBatch(t, actor, a.id));
    expect(await prisma.purchaseBatch.findUnique({ where: { id: a.id } })).toBeNull();
    const b = await tx((t) => createBatch(t, actor, { name: "付過團", supplier: "代購", items: [{ productId: s.p1.id, qty: 1, unitCost: 100, currency: "TWD" }] }));
    await tx((t) => addSupplierPayment(t, actor, { batchId: b.id, paidById: null, paidAt: new Date(), amount: 100, currency: "TWD" }));
    await tx((t) => cancelBatch(t, actor, b.id));
    await expect(tx((t) => deleteBatch(t, actor, b.id))).rejects.toThrow("有付款紀錄");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});
