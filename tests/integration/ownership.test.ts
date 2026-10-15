import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators, updateBatchProgress, updateBatchResponsibility } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { addSupplierPayment } from "@/server/services/supplier-payments";
import { categoriesSummary, categoryOverview } from "@/server/services/batch-ops";
import { keepStock } from "@/server/services/inventory";
import { listQuickSales, quickSale } from "@/server/services/quick-sale";
import { JOINT, stockByOwner } from "@/server/services/ownership";
import { batchStage } from "@/lib/labels";

let s: Awaited<ReturnType<typeof seedBasics>>;
const A = "op_a";
const B = "op_b";
const ids: Record<string, string> = {};

beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx(async (t) => {
    await ensureDefaultOperators(t);
    // ANA 活動：A 的團（兔兔 2 件 × 400）、B 的團（兔兔 3 件 × 450）、合資團（兔兔 5 件 × 300）
    const mk = async (name: string, owner: string | null, qty: number, price: number, joint = false) => {
      const b = await createBatch(t, actor, { name, supplier: name, categoryId: s.halloween.id, orderedById: owner, ownership: joint ? "JOINT" : "PERSONAL" });
      const it = await addBatchItem(t, actor, b.id, { productId: s.p3.id, qty, unitCost: price, currency: "TWD", actualUnitCost: price });
      await createReceivingRecord(t, actor, { batchId: b.id, receivedById: A, lines: [{ batchItemId: it.id, receivedQty: qty }] });
      return { b: b.id, i: it.id };
    };
    const a = await mk("YUANS", A, 2, 400);
    const bb = await mk("QQ Shop", B, 3, 450);
    const j = await mk("頑皮貓", A, 5, 300, true);
    Object.assign(ids, { a: a.b, b: bb.b, j: j.b, ai: a.i, bi: bb.i, ji: j.i });
  });
});

afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

const owners = async () => (await tx((t) => stockByOwner(t, { productIds: [s.p3.id] }))).get(s.p3.id)!;

describe("各自採買與合資", () => {
  it("合資團沒有單一主人；庫存依團的歸屬分開", async () => {
    expect((await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: ids.j } })).orderedById).toBeNull();
    const st = await owners();
    expect([st.get(A)!.free, st.get(B)!.free, st.get(JOINT)!.free]).toEqual([2, 3, 5]);
  });

  it("出售、自留可以指定是誰的，只會扣那個人的庫存", async () => {
    await expect(tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 3, unitPrice: 600, owner: A, idemKey: "own-sale-1" }))).rejects.toThrow("這個人的可售庫存只有 2 件");
    const r = await tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 2, unitPrice: 600, owner: B, idemKey: "own-sale-2" }));
    expect(r.cost).toBe(900); // B 的團 450 × 2，不會先扣到 A 較早的團
    await tx((t) => keepStock(t, actor, { productId: s.p3.id, delta: 1, owner: A }));
    const st = await owners();
    expect([st.get(A)!.free, st.get(A)!.kept, st.get(B)!.free, st.get(JOINT)!.free]).toEqual([1, 1, 1, 5]);
    await expect(tx((t) => keepStock(t, actor, { productId: s.p3.id, delta: -1, owner: B }))).rejects.toThrow("自留只有 0 件");
  });

  it("合資團賣掉的錢：誰付錢誰拿錢（依實際付款比例）；還沒付款時不分", async () => {
    // 還沒登記付款
    let list = await tx((t) => listQuickSales(t, {}));
    await tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 2, unitPrice: 500, owner: JOINT, idemKey: "joint-sale-1" }));
    list = await tx((t) => listQuickSales(t, {}));
    expect(list.byOwner[JOINT]).toMatchObject({ qty: 2, revenue: 1000, cost: 600 });
    // A 付 900、B 付 600 → 60% / 40%
    await tx(async (t) => {
      await addSupplierPayment(t, actor, { batchId: ids.j, paidById: A, paidAt: new Date(), amount: 900, currency: "TWD" });
      await addSupplierPayment(t, actor, { batchId: ids.j, paidById: B, paidAt: new Date(), amount: 600, currency: "TWD" });
    });
    list = await tx((t) => listQuickSales(t, {}));
    expect(list.byOwner[A]).toMatchObject({ revenue: 600, cost: 360 });
    expect(list.byOwner[B]).toMatchObject({ revenue: 400, cost: 240 });
    expect(list.byOwner[JOINT]).toMatchObject({ qty: 2, revenue: 0, cost: 0 });
    const sum = Object.values(list.byOwner).reduce((x, v) => x + v.revenue, 0);
    expect(sum).toBe(list.total.revenue); // 分完合計不變
  });

  it("活動總覽與活動總表：總額、各團、依人分、依進度分、庫存", async () => {
    await tx((t) => addSupplierPayment(t, actor, { batchId: ids.j, paidById: B, paidAt: new Date(), amount: 1500, currency: "TWD" }));
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.total.totalTwd).toBe(800 + 1350 + 1500);
    expect(o.batches.map((b) => b.totalTwd)).toEqual([800, 1350, 1500]);
    expect(o.byOwner[A].amount).toBe(800);
    expect(o.byOwner[B].amount).toBe(1350 + 1500); // 合資團全部由 B 付款
    expect(o.byOwner[JOINT]).toMatchObject({ amount: 0, qty: 5, batches: 1 });
    expect(o.jointShares[ids.j]).toEqual([{ key: B, amount: 1500, percent: 100 }]);
    expect(o.stock[A].free + o.stock[B].free + o.stock[JOINT].free).toBe(10);
    expect(o.byStage.DONE.batches).toBe(3);
    const all = await tx((t) => categoriesSummary(t));
    expect(all.get(s.halloween.id)).toMatchObject({ batches: 3, totalTwd: o.total.totalTwd, byOwner: { [A]: 800, [B]: 2850 } });
  });

  it("改歸屬與進度都有紀錄；改成合資會清掉單一主人", async () => {
    const nb = await tx((t) => createBatch(t, actor, { name: "新團", supplier: "沐比", orderedById: A }));
    await tx((t) => updateBatchProgress(t, actor, nb.id, "AGENT_HAS"));
    await tx((t) => updateBatchProgress(t, actor, nb.id, "SHIPPED"));
    let b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: nb.id } });
    expect(batchStage(b)).toBe("SHIPPED");
    await tx((t) => updateBatchResponsibility(t, actor, nb.id, { ownership: "JOINT" }));
    b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: nb.id } });
    expect([b.ownership, b.orderedById]).toEqual(["JOINT", null]);
    await tx((t) => updateBatchResponsibility(t, actor, nb.id, { orderedById: B }));
    b = await prisma.purchaseBatch.findUniqueOrThrow({ where: { id: nb.id } });
    expect([b.ownership, b.orderedById]).toEqual(["PERSONAL", B]);
    expect(await prisma.auditLog.count({ where: { action: { in: ["batch.progress", "batch.responsibility"] }, entityId: nb.id } })).toBe(4);
    await expect(tx((t) => updateBatchProgress(t, actor, nb.id, "DONE"))).rejects.toThrow("進度不正確");
  });
});

describe("預設經營者補建", () => {
  it("資料庫沒有經營者時，同時多個請求補建不會出錯，也不覆寫改過的名稱", async () => {
    await prisma.$executeRawUnsafe(`UPDATE "PurchaseBatch" SET "orderedById" = NULL, "paymentResponsibleById" = NULL, "receivingResponsibleById" = NULL`);
    await prisma.receivingLine.deleteMany();
    await prisma.inventoryMovement.updateMany({ data: { receivingLineId: null } });
    await prisma.receivingRecord.deleteMany();
    await prisma.supplierPayment.deleteMany();
    await prisma.operator.deleteMany();
    const { ensureDefaultOperators: ensure, saveOperator } = await import("@/server/services/operators");
    await Promise.all(Array.from({ length: 5 }, () => tx((t) => ensure(t))));
    expect(await prisma.operator.count()).toBe(2);
    await tx((t) => saveOperator(t, actor, A, { name: "阿珍" }));
    await tx((t) => ensure(t));
    expect((await prisma.operator.findUniqueOrThrow({ where: { id: A } })).name).toBe("阿珍");
  });
});
