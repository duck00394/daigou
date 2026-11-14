// 合併訂單：同一位客人的幾張單合成一張，金額、收款、出貨都跟著搬，合計不變
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { receiveStock } from "@/server/services/inventory";
import { quickSale } from "@/server/services/quick-sale";
import { mergeOrders, mergePreview } from "@/server/services/order-merge";
import { checkIntegrity } from "@/server/services/integrity";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx(async (t) => {
    for (const p of [s.p1, s.p2, s.p3]) await receiveStock(t, actor, { productId: p.id, qty: 5, unitCostTwd: 100 });
  });
});

const sell = (productId: string, qty: number, key: string, buyerName = "pinn", paid = false) =>
  tx((t) => quickSale(t, actor, { productId, qty, unitPrice: 680, buyerName, paid, idemKey: `merge-${key}-0001` }));

describe("合併訂單", () => {
  it("同一位客人 3 張現貨單合成一張：留最早的、商品和收款都搬過去，金額不變", async () => {
    const a = await sell(s.p1.id, 2, "a");
    const b = await sell(s.p2.id, 1, "b", "pinn", true);
    const c = await sell(s.p3.id, 1, "c");
    const before = await prisma.order.findMany({ where: { id: { in: [a.orderId, b.orderId, c.orderId] } } });
    const pv = await tx((t) => mergePreview(t, [c.orderId, a.orderId, b.orderId]));
    expect(pv).toMatchObject({ keep: { id: a.orderId }, count: 3, qty: 4, receivable: 680 * 4, paid: 680 });

    const r = await tx((t) => mergeOrders(t, actor, [c.orderId, a.orderId, b.orderId]));
    expect(r).toMatchObject({ orderId: a.orderId, merged: 2 });
    const left = await prisma.order.findMany({ where: { buyer: { name: "pinn" } }, include: { items: true, payments: true } });
    expect(left).toHaveLength(1);
    expect(left[0].items).toHaveLength(3);
    expect(left[0].payments.map((p) => p.amount)).toEqual([680]);
    expect(left[0].receivableCache).toBe(before.reduce((x, o) => x + o.receivableCache, 0));
    expect(left[0].balanceCache).toBe(680 * 3);
    expect(left[0].shipStatusCache).toBe("SHIPPED");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });

  it("不同客人、已取消的單不能合併", async () => {
    const a = await sell(s.p1.id, 1, "d");
    const b = await sell(s.p2.id, 1, "e", "阿婷");
    await expect(tx((t) => mergeOrders(t, actor, [a.orderId, b.orderId]))).rejects.toThrow("要同一位客人才能合併");
    const c = await sell(s.p3.id, 1, "f");
    const { voidQuickSale } = await import("@/server/services/quick-sale");
    await tx((t) => voidQuickSale(t, actor, c.orderId, "測試"));
    await expect(tx((t) => mergeOrders(t, actor, [a.orderId, c.orderId]))).rejects.toThrow("已取消的單不能合併");
    expect(await checkIntegrity(prisma)).toEqual([]);
  });
});
