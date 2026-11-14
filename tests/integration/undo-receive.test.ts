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

  it("刪除整團：付款、收貨、自留一起刪；貨已經賣出的擋下來", async () => {
    const { quickSale } = await import("@/server/services/quick-sale");
    const op = await prisma.operator.create({ data: { code: "D", name: "小華" } });
    const a = await tx((t) => createBatch(t, actor, { name: "整團刪", supplier: "代購", orderedById: op.id, items: [{ productId: s.p1.id, qty: 2, unitCost: 100, currency: "TWD" }] }));
    await tx((t) => addSupplierPayment(t, actor, { batchId: a.id, paidById: op.id, paidAt: new Date(), amount: 3150, currency: "TWD" }));
    await tx((t) => receiveAll(t, actor, a.id, { receivedById: op.id }));
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 1 }));
    await tx((t) => deleteBatch(t, actor, a.id));
    expect(await prisma.purchaseBatch.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.supplierPayment.count({ where: { batchId: a.id } })).toBe(0);
    const inv = (await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id);
    expect([inv?.onHand ?? 0, inv?.kept ?? 0]).toEqual([0, 0]);
    // 賣出了就不能刪
    const b = await tx((t) => createBatch(t, actor, { name: "賣過團", supplier: "代購", orderedById: op.id, items: [{ productId: s.p1.id, qty: 1, unitCost: 100, currency: "TWD" }] }));
    await tx((t) => receiveAll(t, actor, b.id, { receivedById: op.id }));
    await tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 1, unitPrice: 300, idemKey: "del-sale-0001" }));
    await expect(tx((t) => deleteBatch(t, actor, b.id))).rejects.toThrow("已經賣出");
    await tx((t) => cancelBatch(t, actor, b.id)).catch(() => null);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("這團的貨已經賣掉、別團手上還有：從同一個人別團補過來，撤回成功；別人的貨不拿來補", async () => {
    const { quickSale } = await import("@/server/services/quick-sale");
    const a = await prisma.operator.create({ data: { code: "A", name: "小明" } });
    const bOp = await prisma.operator.create({ data: { code: "B", name: "小華" } });
    const first = await tx((t) => createBatch(t, actor, { name: "先到團", supplier: "代購", orderedById: a.id, items: [{ productId: s.p1.id, qty: 2, unitCost: 100, currency: "TWD" }] }));
    await tx((t) => receiveAll(t, actor, first.id, { receivedById: a.id }));
    const later = await tx((t) => createBatch(t, actor, { name: "後到團", supplier: "代購", orderedById: a.id, items: [{ productId: s.p1.id, qty: 3, unitCost: 120, currency: "TWD" }] }));
    await tx((t) => receiveAll(t, actor, later.id, { receivedById: a.id }));
    const other = await tx((t) => createBatch(t, actor, { name: "別人的團", supplier: "代購", orderedById: bOp.id, items: [{ productId: s.p1.id, qty: 5, unitCost: 90, currency: "TWD" }] }));
    await tx((t) => receiveAll(t, actor, other.id, { receivedById: bOp.id }));
    // 賣 1 件（先進先出扣到「先到團」），手上：小明 4、小華 5
    await tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 1, unitPrice: 300, idemKey: "undo-sale-0001", owner: a.id }));
    // 撤回「先到團」：這團剩 1 件，差的 1 件從「後到團」補
    const r = await tx((t) => undoReceiving(t, actor, { batchId: first.id }));
    expect(r.qty).toBe(2);
    expect((await tx((t) => inventorySummary(t, [s.p1.id]))).get(s.p1.id)!.onHand).toBe(2 + 5);
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("ORDERED");
    const laterItem = await prisma.purchaseBatchItem.findFirstOrThrow({ where: { batchId: later.id } });
    const laterLeft = await prisma.inventoryMovement.aggregate({ where: { purchaseBatchItemId: laterItem.id }, _sum: { onHandDelta: true } });
    expect(laterLeft._sum.onHandDelta).toBe(2);
    expect(await checkIntegrity(prisma)).toEqual([]);
    // 小明手上的 2 件都賣掉，再撤回「後到團」：小明別團沒貨了，小華的貨不能拿來補
    await tx((t) => quickSale(t, actor, { productId: s.p1.id, qty: 2, unitPrice: 300, idemKey: "undo-sale-0002", owner: a.id }));
    await expect(tx((t) => undoReceiving(t, actor, { batchId: later.id }))).rejects.toThrow("還差 3 件");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});
