// 客人預訂預估可賺：預訂金額 − 預購平均成本（現有＋一定到）；不一定到的、沒買的不算成本
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { sellToCustomer } from "@/server/services/sell";
import { preorderCosts, preorderProfit } from "@/server/services/preorder";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});
afterEach(async () => {
  expect(await checkIntegrity(prisma)).toEqual([]);
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
});
