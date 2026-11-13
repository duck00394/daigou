// 庫存「看某個人」：只算他自己的貨（個人團＋合資團指定給他的列），合資沒指定的、別人的都不算；看全部才全部算
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { stockLeft } from "@/server/services/stock-left";
import { inventoryFor } from "@/server/services/mine";

const A = "op_a";
const B = "op_b";
let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});

async function batch(kind: "A" | "B" | "JOINT", rows: { qty: number; ownerId?: string; received?: number }[]) {
  const b = await tx((t) => createBatch(t, actor, kind === "JOINT" ? { name: "合資團", supplier: "代購", ownership: "JOINT" } : { name: `${kind} 團`, supplier: "代購", orderedById: kind === "A" ? A : B }));
  for (const r of rows) {
    const i = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: r.qty, unitCost: 300, currency: "TWD" }));
    if (r.ownerId) await prisma.purchaseBatchItem.update({ where: { id: i.id }, data: { ownerId: r.ownerId } });
    const got = r.received ?? r.qty;
    if (got > 0) await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: A, lines: [{ batchItemId: i.id, receivedQty: got }] }));
  }
}

describe("庫存看某個人只算自己的", () => {
  it("A 的頁面：A 團＋合資團指定給 A 的；B 的、合資沒指定的不算；全部才全部算", async () => {
    await batch("A", [{ qty: 2 }, { qty: 2, received: 0 }]); // A：到 2、還沒到 2
    await batch("B", [{ qty: 1 }]);
    await batch("JOINT", [{ qty: 1, ownerId: A }, { qty: 3 }, { qty: 1, ownerId: B, received: 0 }]); // 合資：A 的 1、沒指定 3、B 的 1 還沒到
    const mine = await tx((t) => stockLeft(t, [s.p1.id], A));
    const a = mine.byProduct.get(s.p1.id)!;
    expect([a.s.onHand, a.s.incoming]).toEqual([3, 2]);
    const all = (await tx((t) => stockLeft(t, [s.p1.id], null))).byProduct.get(s.p1.id)!;
    expect([all.s.onHand, all.s.incoming]).toEqual([7, 3]);
    const b = (await tx((t) => stockLeft(t, [s.p1.id], B))).byProduct.get(s.p1.id)!;
    expect([b.s.onHand, b.s.incoming]).toEqual([1, 1]);
    // 商品列表、搜尋、出貨頁用的 inventoryFor 也一樣
    const inv = (await tx((t) => inventoryFor(t, [s.p1.id], A))).get(s.p1.id)!;
    expect([inv.onHand, inv.incoming]).toEqual([3, 2]);
  });
});
