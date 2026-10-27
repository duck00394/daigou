// 客人預訂預估可賺：預訂金額 − 預購平均成本（現有＋一定到）；不一定到的、沒買的不算成本
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { sellToCustomer } from "@/server/services/sell";
import { preorderCosts, preorderProfit, seriesProfit } from "@/server/services/preorder";
import { createReceivingRecord } from "@/server/services/receiving";
import { ensureDefaultOperators } from "@/server/services/operators";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("客人預訂分人看", () => {
  it("看某個人：只算跟他訂的（＋合資）；還沒分的另外算件數；看全部都算", async () => {
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", owner: "op_a", lines: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }], idemKey: "own-0001" }));
    await tx((t) => sellToCustomer(t, actor, { buyerName: "阿婷", owner: "op_b", lines: [{ productId: s.p2.id, qty: 1, unitPrice: 300 }], idemKey: "own-0002" }));
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小王", lines: [{ productId: s.p3.id, qty: 3, unitPrice: 150 }], idemKey: "own-0003" }));
    const a = await tx((t) => preorderProfit(t, { owner: "op_a" }));
    expect([a.qty, a.revenue, a.unassigned]).toEqual([2, 1000, 3]);
    expect(a.buyers.map((b) => b.name)).toEqual(["小美"]);
    const b = await tx((t) => preorderProfit(t, { owner: "op_b" }));
    expect([b.qty, b.unassigned]).toEqual([1, 3]);
    const all = await tx((t) => preorderProfit(t));
    expect(all.qty).toBe(6);
  });
});

describe("預購成本與預估可賺", () => {
  it("一定到的算成本、不一定的不算；客人預訂算出預估可賺", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "預購團", supplier: "代購" }));
    const [i1, i2] = await tx(async (t) => [
      await addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 3, unitCost: 300, currency: "TWD" }),
      await addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 2, unitCost: 400, currency: "TWD" }),
    ]);
    // 還沒對單：都是不一定 → 沒成本
    expect((await tx((t) => preorderCosts(t, [s.p1.id]))).get(s.p1.id)).toBeUndefined();
    // p1 對單買到 3 件；p2 還沒確定
    await prisma.purchaseBatchItem.update({ where: { id: i1.id }, data: { confirmedQty: 3 } });
    void i2;
    expect((await tx((t) => preorderCosts(t, [s.p1.id]))).get(s.p1.id)?.avg).toBe(300);

    // 小美預訂 p1 2 件 × 500、p2 1 件 × 600；p3 沒買 1 件 × 450
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", lines: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }, { productId: s.p2.id, qty: 1, unitPrice: 600 }, { productId: s.p3.id, qty: 1, unitPrice: 450 }], idemKey: "pre-0001" }));
    const p = await tx((t) => preorderProfit(t));
    expect(p.qty).toBe(4);
    expect(p.revenue).toBe(1000 + 600 + 450);
    expect(p.cost).toBe(600);
    expect(p.profit).toBe(400); // 只算有成本的：1000 − 600
    expect(p.uncosted).toBe(2);
    expect(p.buyers.map((x) => [x.name, x.profit, x.uncosted])).toEqual([["小美", 400, 2]]);
  });

  it("系列預估可賺：已賣、客人預訂、還沒人訂的（照售價）", async () => {
    const cat = s.halloween.id; // p1、p2 在萬聖節
    const b = await tx((t) => createBatch(t, actor, { name: "萬聖團", supplier: "代購", categoryId: cat }));
    const i1 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 4, unitCost: 300, currency: "TWD" }));
    await prisma.purchaseBatchItem.update({ where: { id: i1.id }, data: { confirmedQty: 4 } });
    await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: "op_a", lines: [{ batchItemId: i1.id, receivedQty: 2 }] }));
    // 賣掉 1 件現貨 500；再預訂 2 件（1 件現貨不夠→預訂）
    await tx((t) => sellToCustomer(t, actor, { buyerName: "阿明", lines: [{ productId: s.p1.id, qty: 1, unitPrice: 500 }], idemKey: "series-0001" }));
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", lines: [{ productId: s.p1.id, qty: 2, unitPrice: 520 }], idemKey: "series-0002" }));
    const p = await tx((t) => seriesProfit(t, cat));
    const r = p.rows.get(s.p1.id)!;
    // 現有 2−1−1(賣)… 現有 0、一定到 2、客人訂 1 → 庫存 1，剩 1 件照售價 500
    expect(p.sold.qty).toBe(2);
    expect(p.sold.revenue).toBe(500 + 520);
    expect(p.sold.cost).toBe(600);
    expect([r.onHand, r.sure, r.ordered, r.left]).toEqual([0, 2, 1, 1]);
    expect(p.pre).toMatchObject({ qty: 1, revenue: 520, cost: 300 });
    expect(p.free).toMatchObject({ qty: 1, revenue: 500, cost: 300 });
    expect(p.profit).toBe(1020 - 600 + 220 + 200);
    expect(r.profit).toBe(p.profit);
  });

  it("確定的／預估的：還在等確認的算進預估；客人訂比預估還多 → 不夠", async () => {
    const cat = s.halloween.id;
    const b = await tx((t) => createBatch(t, actor, { name: "預估團", supplier: "代購", categoryId: cat }));
    const i1 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 3, unitCost: 300, currency: "TWD" }));
    const i2 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p2.id, qty: 1, unitCost: 400, currency: "TWD" }));
    // p1 確定 1 件、另 2 件還在等確認；p2 還沒確認
    await prisma.purchaseBatchItem.update({ where: { id: i1.id }, data: { confirmedQty: 1 } });
    void i2;
    // 客人訂 p1 2 件、p2 3 件
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", lines: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }, { productId: s.p2.id, qty: 3, unitPrice: 600 }], idemKey: "est-0001" }));
    const p = await tx((t) => seriesProfit(t, cat));
    const r1 = p.rows.get(s.p1.id)!;
    const r2 = p.rows.get(s.p2.id)!;
    expect([r1.left, r1.est.unsure, r1.est.left]).toEqual([-1, 2, 1]);
    expect([r2.left, r2.est.unsure, r2.est.left]).toEqual([-3, 1, -2]);
    expect(r1.est.avg).toBe(300);
    expect(p.short.map((x) => [x.id, x.n])).toEqual(expect.arrayContaining([[s.p1.id, 1], [s.p2.id, 3]]));
    expect(p.estShort.map((x) => [x.id, x.n])).toEqual([[s.p2.id, 2]]);
    expect(p.actual).toBe(0);
  });
});
