// 「現在看誰的」：看某個人時，庫存、平均成本、報表、待下單都只算他的，別人的不算
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch, purchaseDemand } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { sellToCustomer } from "@/server/services/sell";
import { inventoryFor } from "@/server/services/mine";
import { monthlyReport, currentYm, stockValuation, receivablesSnapshot } from "@/server/services/reports";

const A = "op_a";
const B = "op_b";
let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
});

async function buy(owner: string, qty: number, cost: number, receive = qty) {
  const b = await tx((t) => createBatch(t, actor, { name: `${owner} 團 ${cost}`, supplier: "代購", orderedById: owner }));
  const it = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty, unitCost: cost, currency: "TWD" }));
  await prisma.purchaseBatchItem.update({ where: { id: it.id }, data: { confirmedQty: qty } });
  if (receive) await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: owner, lines: [{ batchItemId: it.id, receivedQty: receive }] }));
}

describe("看某個人只算他的", () => {
  it("庫存、在途、平均成本：A 只看到 A 的；全部才加起來", async () => {
    await buy(A, 3, 300, 2); // A：到 2、還沒到 1
    await buy(B, 1, 600);
    const a = (await tx((t) => inventoryFor(t, [s.p1.id], A))).get(s.p1.id)!;
    expect([a.onHand, a.available, a.incoming]).toEqual([2, 2, 1]);
    const all = (await tx((t) => inventoryFor(t, [s.p1.id], null))).get(s.p1.id)!;
    expect([all.onHand, all.incoming]).toEqual([3, 1]);
    expect((await stockValuation(prisma, [s.p1.id], A)).byProduct.get(s.p1.id)?.avgUnitCost).toBe(300);
    expect((await stockValuation(prisma, [s.p1.id])).byProduct.get(s.p1.id)?.avgUnitCost).toBe(400);
  });

  it("報表、應收、待下單：A 賣的只算在 A；B 看不到", async () => {
    await buy(A, 2, 300);
    await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", owner: A, lines: [{ productId: s.p1.id, qty: 1, unitPrice: 500 }], idemKey: "mine-0001" }));
    // B 的客人訂了沒貨的 p2
    await tx((t) => sellToCustomer(t, actor, { buyerName: "阿婷", owner: B, lines: [{ productId: s.p2.id, qty: 2, unitPrice: 300 }], idemKey: "mine-0002" }));
    const ym = currentYm();
    const ra = await monthlyReport(prisma, ym, A);
    const rb = await monthlyReport(prisma, ym, B);
    expect([ra.revenue, ra.cogs]).toEqual([500, 300]);
    expect(rb.revenue).toBe(0);
    expect((await receivablesSnapshot(prisma, B)).balance).toBe(600);
    expect((await receivablesSnapshot(prisma, A)).balance).toBe(0);
    expect([...(await tx((t) => purchaseDemand(t, { owner: A }))).keys()]).toEqual([]);
    expect((await tx((t) => purchaseDemand(t, { owner: B }))).get(s.p2.id)?.qty).toBe(2);
  });
});
