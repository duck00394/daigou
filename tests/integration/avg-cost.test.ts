// 平均成本：同一個商品、同一個人買的所有團（買價＋運費等費用）平均；賣掉的、手上的都用同一個平均
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchCost, addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { ensureDefaultOperators } from "@/server/services/operators";
import { pooledCosts } from "@/server/services/avg-cost";
import { stockValuation } from "@/server/services/reports";
import { quickSale } from "@/server/services/quick-sale";
import { checkIntegrity } from "@/server/services/integrity";

let s: Awaited<ReturnType<typeof seedBasics>>;
let itemA: string, itemB: string, itemC: string, itemD: string;

/**
 * 兔兔扭蛋
 * A 的團：A1 團 2 件（每件 100，運費共 20）、A2 團 3 件（150）都到貨；A3 團 2 件（500）還沒確認有買到
 * B 的團：1 件（1000）到貨
 */
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx(async (t) => {
    await ensureDefaultOperators(t);
    const a1 = await createBatch(t, actor, { name: "A1", supplier: "代購甲", orderedById: "op_a" });
    itemA = (await addBatchItem(t, actor, a1.id, { productId: s.p3.id, qty: 2, unitCost: 100, currency: "TWD", actualUnitCost: 100 })).id;
    await addBatchCost(t, actor, { batchId: a1.id, kind: "INTL_SHIPPING", currency: "TWD", amount: 20, method: "BY_QTY" });
    await createReceivingRecord(t, actor, { batchId: a1.id, receivedById: "op_a", lines: [{ batchItemId: itemA, receivedQty: 2 }] });
    const a2 = await createBatch(t, actor, { name: "A2", supplier: "代購乙", orderedById: "op_a" });
    itemB = (await addBatchItem(t, actor, a2.id, { productId: s.p3.id, qty: 3, unitCost: 150, currency: "TWD", actualUnitCost: 150 })).id;
    await createReceivingRecord(t, actor, { batchId: a2.id, receivedById: "op_a", lines: [{ batchItemId: itemB, receivedQty: 3 }] });
    const a3 = await createBatch(t, actor, { name: "A3", supplier: "代購丙", orderedById: "op_a" });
    itemD = (await addBatchItem(t, actor, a3.id, { productId: s.p3.id, qty: 2, unitCost: 500, currency: "TWD" })).id;
    const b1 = await createBatch(t, actor, { name: "B1", supplier: "代購甲", orderedById: "op_b" });
    itemC = (await addBatchItem(t, actor, b1.id, { productId: s.p3.id, qty: 1, unitCost: 1000, currency: "TWD", actualUnitCost: 1000 })).id;
    await createReceivingRecord(t, actor, { batchId: b1.id, receivedById: "op_b", lines: [{ batchItemId: itemC, receivedQty: 1 }] });
  });
});

const unit = (m: Map<string, { qty: number; totalTwd: number }>, id: string) => m.get(id)!.totalTwd / m.get(id)!.qty;

describe("平均成本", () => {
  it("同一個人的團一起平均（含運費），還沒確認買到的不算；別人的團不混進來", async () => {
    const m = await tx((t) => pooledCosts(t, [itemA, itemB, itemC, itemD]));
    // A：(220 + 450) ÷ 5 ＝ 134；A3 還沒確認，不算
    expect(unit(m, itemA)).toBe(134);
    expect(unit(m, itemB)).toBe(134);
    expect(unit(m, itemD)).toBe(134);
    // B 自己的團
    expect(unit(m, itemC)).toBe(1000);
  });

  it("賣掉的成本＝平均成本，不管出貨扣到哪一團", async () => {
    const r = await tx((t) => quickSale(t, actor, { productId: s.p3.id, qty: 2, unitPrice: 300, idemKey: "avg-sale-1", owner: "op_a" }));
    expect(r.cost).toBe(134 * 2);
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("手上的貨也用同一個平均", async () => {
    const v = await tx((t) => stockValuation(t, [s.p3.id], "op_a"));
    expect(v.byProduct.get(s.p3.id)!.avgUnitCost).toBe(134);
  });
});
