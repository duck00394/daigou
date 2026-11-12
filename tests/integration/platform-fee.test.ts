// 販售平台抽成：設 KOCA 2%；賣給客人用商品金額算（不含運費）、小數捨去；可以改實際扣的；賺多少扣掉；改費率不影響舊單
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { sellToCustomer } from "@/server/services/sell";
import { getPlatformFees, setPlatformFee } from "@/server/services/settings";
import { orderProfits, profitOf } from "@/server/services/profit";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});

describe("販售平台抽成", () => {
  it("2%：商品 1750 → 抽 35；現貨＋預訂分到兩張單；賺多少扣掉；改費率不影響舊單；可以改實際扣的", async () => {
    await tx((t) => setPlatformFee(t, actor, "KOCA", 2));
    expect(await getPlatformFees(prisma)).toEqual({ KOCA: 2 });
    const b = await tx((t) => createBatch(t, actor, { name: "團", supplier: "代購", orderedById: "op_a" }));
    const i = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 1, unitCost: 300, currency: "TWD" }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: "op_a", lines: [{ batchItemId: i.id, receivedQty: 1 }] }));
    // 吉伊 1 件現貨 875＋1 件預訂 875 → 商品 1750；運費 38 不算
    const r = await tx((t) => sellToCustomer(t, actor, { buyerName: "小美", channel: "KOCA", lines: [{ productId: s.p1.id, qty: 2, unitPrice: 875 }], idemKey: "koca-sell-1", shippingFee: 38 }));
    expect(r.platformFee).toBe(35);
    const orders = await prisma.order.findMany({ where: { salesChannel: "KOCA" }, select: { id: true, platformFee: true } });
    expect(orders.reduce((a, o) => a + o.platformFee, 0)).toBe(35);
    const p = await tx((t) => orderProfits(t, {}));
    // 現貨那件賣掉了（成本 300）；預訂那件還沒有成本 → 先不算（收入、平台費都只算有成本的那件）
    expect([p.total.shipped.fee, p.total.open.uncosted]).toEqual([17, 1]);
    expect(profitOf(p.total.shipped)).toBe(875 - 300 - 17);
    // 改成 3.2%：舊單不變
    await tx((t) => setPlatformFee(t, actor, "KOCA", 3.2));
    expect((await prisma.order.findMany({ where: { salesChannel: "KOCA" } })).reduce((a, o) => a + o.platformFee, 0)).toBe(35);
    // 自己打實際扣的
    const r2 = await tx((t) => sellToCustomer(t, actor, { buyerName: "阿婷", channel: "KOCA", lines: [{ productId: s.p2.id, qty: 1, unitPrice: 1000 }], idemKey: "koca-sell-2", platformFee: 20 }));
    expect(r2.platformFee).toBe(20);
    // 沒設抽成的平台：0
    const r3 = await tx((t) => sellToCustomer(t, actor, { buyerName: "小王", channel: "蝦皮", lines: [{ productId: s.p3.id, qty: 1, unitPrice: 1000 }], idemKey: "koca-sell-3" }));
    expect(r3.platformFee).toBe(0);
    await expect(tx((t) => setPlatformFee(t, actor, "KOCA", 80))).rejects.toThrow("0～50");
  });
});
