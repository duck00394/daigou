// 賣給客人分誰賣的：只賣、只扣那個人的現貨；不夠的記成預訂，別人的庫存不動
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { sellToCustomer } from "@/server/services/sell";
import { stockByOwner } from "@/server/services/ownership";

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

async function stockOf(owner: string, qty: number) {
  const b = await tx((t) => createBatch(t, actor, { name: `${owner} 的團`, supplier: "代購", orderedById: owner }));
  const it = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty, unitCost: 300, currency: "TWD" }));
  await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: owner, lines: [{ batchItemId: it.id, receivedQty: qty }] }));
}

describe("賣給客人分誰賣的", () => {
  it("B 賣 2 件：只扣 B 的 1 件，另 1 件記預訂；A 的 2 件不動", async () => {
    await stockOf(A, 2);
    await stockOf(B, 1);
    const r = await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", owner: B, lines: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }], idemKey: "owner-sell-01" }));
    expect([r.sold, r.preordered]).toEqual([1, 1]);
    const by = (await tx((t) => stockByOwner(t, { productIds: [s.p1.id] }))).get(s.p1.id)!;
    expect(by.get(A)?.free).toBe(2);
    expect(by.get(B)?.free ?? 0).toBe(0);
  });

  it("沒選誰賣的：照舊先賣先買進的（誰的都可以）", async () => {
    await stockOf(A, 1);
    await stockOf(B, 1);
    const r = await tx((t) => sellToCustomer(t, actor, { buyerName: null, lines: [{ productId: s.p1.id, qty: 2, unitPrice: 500 }], idemKey: "owner-sell-02" }));
    expect([r.sold, r.preordered]).toEqual([2, 0]);
  });
});
