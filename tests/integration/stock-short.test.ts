// 首頁「客人訂的比庫存多」：跟庫存頁「庫存」欄同一套算法。自留不算可賣、不一定到的不算、看某人只算他的
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { sellToCustomer } from "@/server/services/sell";
import { keepStock } from "@/server/services/inventory";
import { saveReconcile } from "@/server/services/reconcile";
import { shortProducts, stockLeft } from "@/server/services/stock-left";

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

describe("客人訂的比庫存多", () => {
  it("自留不算、不一定到不算、對單買到才算；看某人只算他的", async () => {
    // A 有 2 件現貨
    const ba = await tx((t) => createBatch(t, actor, { name: "A 團", supplier: "代購", orderedById: A }));
    const ia = await tx((t) => addBatchItem(t, actor, ba.id, { productId: s.p1.id, qty: 2, unitCost: 300, currency: "TWD" }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: ba.id, receivedById: A, lines: [{ batchItemId: ia.id, receivedQty: 2 }] }));
    expect(await tx((t) => shortProducts(t, null))).toEqual([]);

    // B 賣 3 件（B 沒貨）→ 3 件記成 B 的預訂
    const r = await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", owner: B, lines: [{ productId: s.p1.id, qty: 3, unitPrice: 500 }], idemKey: "short-01" }));
    expect(r.preordered).toBe(3);
    expect(await tx((t) => shortProducts(t, null))).toEqual([{ productId: s.p1.id, short: 1 }]); // 全部：2 − 3
    expect(await tx((t) => shortProducts(t, B))).toEqual([{ productId: s.p1.id, short: 3 }]); // B：0 − 3
    expect(await tx((t) => shortProducts(t, A))).toEqual([]); // A：跟 A 無關

    // A 自留 1 件：可賣的變 1 → 全部看缺 2
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 1, owner: A, dedupeKey: "short-keep" }));
    expect(await tx((t) => shortProducts(t, null))).toEqual([{ productId: s.p1.id, short: 2 }]);

    // B 開團買 5 件、還沒對單（不一定到）→ 還是缺
    const bb = await tx((t) => createBatch(t, actor, { name: "B 團", supplier: "代購", orderedById: B }));
    const ib = await tx((t) => addBatchItem(t, actor, bb.id, { productId: s.p1.id, qty: 5, unitCost: 300, currency: "TWD" }));
    expect(await tx((t) => shortProducts(t, B))).toEqual([{ productId: s.p1.id, short: 3 }]);
    const x = (await tx((t) => stockLeft(t, [s.p1.id], B))).byProduct.get(s.p1.id)!;
    expect([x.s.incoming, x.unsure, x.left]).toEqual([5, 5, -3]);

    // 對單：5 件都買到 → 一定到 5，不缺了
    await tx((t) => saveReconcile(t, actor, bb.id, { rows: [{ itemId: ib.id, bought: 5, cutRest: false }] }));
    expect(await tx((t) => shortProducts(t, B))).toEqual([]);
    expect(await tx((t) => shortProducts(t, null))).toEqual([]);
  });
});
