import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators, updateBatchProgress, updateBatchResponsibility } from "@/server/services/operators";
import { addBatchCost, addBatchItem, createBatch, landedCosts } from "@/server/services/purchase";
import { currentYm, monthlyReport } from "@/server/services/reports";
import { createReceivingRecord } from "@/server/services/receiving";
import { addSupplierPayment } from "@/server/services/supplier-payments";
import { batchPaySummary, categoriesSummary, categoryOverview, payRemaining } from "@/server/services/batch-ops";
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

describe("這團金額：總額、已付、待付款、一鍵付清", () => {
  it("待付款 = 總額 − 已付；活動總覽依人分待付／已付", async () => {
    await tx((t) => addSupplierPayment(t, actor, { batchId: ids.a, paidById: A, paidAt: new Date(), amount: 300, currency: "TWD" }));
    const m = await tx((t) => batchPaySummary(t, [ids.a, ids.b]));
    expect(m.get(ids.a)).toEqual({ totalTwd: 800, paidTwd: 300, dueTwd: 500 });
    expect(m.get(ids.b)).toEqual({ totalTwd: 1350, paidTwd: 0, dueTwd: 1350 });
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.total).toMatchObject({ paidTwd: 300, dueTwd: 500 + 1350 + 1500 });
    expect(o.batches.find((b) => b.id === ids.a)).toMatchObject({ paidTwd: 300, dueTwd: 500, ownerKey: A });
  });

  it("付清只登記剩下的金額，重送不重複，付清後再按會擋下", async () => {
    await tx((t) => addSupplierPayment(t, actor, { batchId: ids.a, paidById: A, paidAt: new Date(), amount: 300, currency: "TWD" }));
    const r1 = await tx((t) => payRemaining(t, actor, ids.a, { paidById: A, dedupeKey: "payoff-test-1" }));
    expect([r1.duplicated, r1.payment.amount, r1.payment.purpose]).toEqual([false, 500, "BALANCE"]);
    const r2 = await tx((t) => payRemaining(t, actor, ids.a, { paidById: A, dedupeKey: "payoff-test-1" }));
    expect(r2.duplicated).toBe(true);
    expect(await prisma.supplierPayment.count({ where: { batchId: ids.a } })).toBe(2);
    expect((await tx((t) => batchPaySummary(t, [ids.a]))).get(ids.a)!.dueTwd).toBe(0);
    await expect(tx((t) => payRemaining(t, actor, ids.a, { paidById: A, dedupeKey: "payoff-test-2" }))).rejects.toThrow("這團已經付清了");
    const full = await tx((t) => payRemaining(t, actor, ids.b, { paidById: B, dedupeKey: "payoff-test-3" }));
    expect([full.payment.amount, full.payment.purpose]).toEqual([1350, "FULL"]);
  });
});

describe("運費：預設不攤、單獨記；兩人一起付才分擔", () => {
  it("不攤的運費：算在這團總額與還要付，不進商品成本，算這團主人的，也算進當月其他費用", async () => {
    const before = (await tx((t) => landedCosts(t, [ids.ai]))).get(ids.ai)!.totalTwd;
    const exp0 = (await monthlyReport(prisma, currentYm())).expenses;
    await tx((t) => addBatchCost(t, actor, { batchId: ids.a, kind: "INTL_SHIPPING", currency: "TWD", amount: 120, method: "NONE" }));
    expect(await prisma.costAllocation.count()).toBe(0);
    expect((await tx((t) => landedCosts(t, [ids.ai]))).get(ids.ai)!.totalTwd).toBe(before);
    expect((await tx((t) => batchPaySummary(t, [ids.a]))).get(ids.a)).toEqual({ totalTwd: 920, paidTwd: 0, dueTwd: 920 });
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.byOwner[A].amount).toBe(920);
    expect(o.batches.find((b) => b.id === ids.a)!.totalTwd).toBe(920);
    expect((await tx((t) => categoriesSummary(t))).get(s.halloween.id)!.byOwner[A]).toBe(920);
    expect((await monthlyReport(prisma, currentYm())).expenses).toBe(exp0 + 120);
  });

  it("指定別人付的、兩人一起付的：算給付錢的人；兩人金額要等於費用", async () => {
    await tx((t) => addBatchCost(t, actor, { batchId: ids.a, kind: "AGENT_FEE", currency: "TWD", amount: 50, method: "NONE", payer: B }));
    await expect(tx((t) => addBatchCost(t, actor, { batchId: ids.a, kind: "INTL_SHIPPING", currency: "TWD", amount: 300, method: "BY_QTY", payer: "joint", shareSplit: { [A]: 100, [B]: 100 } }))).rejects.toThrow("和費用 300 元不一樣");
    await tx((t) => addBatchCost(t, actor, { batchId: ids.a, kind: "INTL_SHIPPING", currency: "TWD", amount: 300, method: "BY_QTY", payer: "joint", shareSplit: { [A]: 150, [B]: 150 } }));
    // 共同付的這筆有攤進商品成本：2 件各 +150
    expect((await tx((t) => landedCosts(t, [ids.ai]))).get(ids.ai)!.feesTwd).toBe(300);
    const o = await tx((t) => categoryOverview(t, s.halloween.id));
    expect(o.batches.find((b) => b.id === ids.a)!.totalTwd).toBe(800 + 50 + 300);
    expect(o.byOwner[A].amount).toBe(800 + 150);
    expect(o.byOwner[B].amount).toBe(1350 + 50 + 150);
    expect(Object.values(o.byOwner).reduce((x, v) => x + v.amount, 0)).toBe(o.total.totalTwd); // 分完合計不變
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
