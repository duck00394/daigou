// 訂單頁三步：備齊 → 出貨 → 客人取貨（可一起記收款）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx, BizError } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { createOrder, cancelItemQty, updateItem } from "@/server/services/orders";
import { addPayment } from "@/server/services/payments";
import { packState, setPacked, shipOrder, pickedUp } from "@/server/services/order-flow";

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

async function stock(owner: string, productId: string, qty: number) {
  const b = await tx((t) => createBatch(t, actor, { name: `${owner} 團`, supplier: "代購", orderedById: owner }));
  const i = await tx((t) => addBatchItem(t, actor, b.id, { productId, qty, unitCost: 300, currency: "TWD" }));
  await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: owner, lines: [{ batchItemId: i.id, receivedQty: qty }] }));
}

describe("訂單：備齊、出貨、客人取貨", () => {
  it("沒貨的不能勾；全部勾完才能出貨；重送不重複；取貨一起記收款只記一次", async () => {
    await stock(A, s.p1.id, 2);
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }], shippingFee: 60 }));
    const [i1, i2] = await prisma.orderItem.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });

    let st = await tx((t) => packState(t, o.id));
    expect(st.map((l) => [l.name, l.canPack, l.short])).toEqual([["吉伊吊娃", true, 0], ["小八 S 娃", false, 1]]);
    await expect(tx((t) => setPacked(t, actor, o.id, [i2.id], true))).rejects.toThrow("還差 1 件");
    await tx((t) => setPacked(t, actor, o.id, [i1.id], true));
    await expect(tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "ship-key-0001" }))).rejects.toThrow("還有 1 項沒勾備齊");

    // 小八不賣了 → 只剩吉伊，已勾 → 可以出貨
    await tx((t) => cancelItemQty(t, actor, { orderItemId: i2.id, qty: 1 }));
    const r1 = await tx((t) => shipOrder(t, actor, { orderId: o.id, method: "賣貨便", trackingNo: "F123", dedupeKey: "ship-key-0001" }));
    expect([r1.duplicated, r1.count]).toEqual([false, 2]);
    const r2 = await tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "ship-key-0001" }));
    expect(r2.duplicated).toBe(true);
    expect(await prisma.shipment.count()).toBe(1);
    st = await tx((t) => packState(t, o.id));
    expect(st).toEqual([]);

    // 客人取貨：待收 = 2×500 + 60 = 1060
    const p1 = await tx((t) => pickedUp(t, actor, { orderId: o.id, collect: true, dedupeKey: "pick-key-0001" }));
    expect(p1.paid).toBe(1060);
    const p2 = await tx((t) => pickedUp(t, actor, { orderId: o.id, collect: true, dedupeKey: "pick-key-0001" }));
    expect(p2.paid).toBe(0);
    const pays = await prisma.payment.findMany({ where: { orderId: o.id } });
    expect(pays.map((p) => [p.amount, p.method, p.note])).toEqual([[1060, "賣貨便", "取貨付款"]]);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect([after.paymentStatusCache, after.shipStatusCache]).toEqual(["PAID", "DELIVERED"]);
    // 沒有可取的了，換一個識別碼再按會擋下
    await expect(tx((t) => pickedUp(t, actor, { orderId: o.id, collect: true, dedupeKey: "pick-key-0002" }))).rejects.toThrow(BizError);
  });

  it("先付清的：取貨不再記收款；不勾記收款：只標取貨", async () => {
    await stock(A, s.p1.id, 1);
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    await tx((t) => addPayment(t, actor, { orderId: o.id, amount: 500 }));
    await tx(async (t) => setPacked(t, actor, o.id, (await packState(t, o.id)).map((l) => l.id), true));
    await tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "ship-key-0002" }));
    const r = await tx((t) => pickedUp(t, actor, { orderId: o.id, collect: true, dedupeKey: "pick-key-0003" }));
    expect(r.paid).toBe(0);
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(1);

    await stock(A, s.p3.id, 1);
    const o2 = await tx((t) => createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p3.id, qty: 1 }] }));
    await tx(async (t) => setPacked(t, actor, o2.id, (await packState(t, o2.id)).map((l) => l.id), true));
    await tx((t) => shipOrder(t, actor, { orderId: o2.id, dedupeKey: "ship-key-0003" }));
    expect((await tx((t) => pickedUp(t, actor, { orderId: o2.id, collect: false, dedupeKey: "pick-key-0004" }))).paid).toBe(0);
    const x = await prisma.order.findUniqueOrThrow({ where: { id: o2.id } });
    expect([x.paymentStatusCache, x.shipStatusCache]).toEqual(["UNPAID", "DELIVERED"]);
  });

  it("跟 B 訂的：只能用 B 的貨；A 有貨也不能勾；出貨扣 B 的", async () => {
    await stock(A, s.p1.id, 1);
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    const [it] = await prisma.orderItem.findMany({ where: { orderId: o.id } });
    await prisma.orderItem.update({ where: { id: it.id }, data: { ownerKey: B } });
    expect((await tx((t) => packState(t, o.id)))[0].canPack).toBe(false);
    await stock(B, s.p1.id, 1);
    expect((await tx((t) => packState(t, o.id)))[0].canPack).toBe(true);
    await tx((t) => updateItem(t, actor, it.id, { packFlag: "READY" }));
    await tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "ship-key-0004" }));
    const mv = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: it.id }, include: { purchaseBatchItem: { include: { batch: true } } } });
    expect(mv.map((m) => m.purchaseBatchItem?.batch.orderedById)).toEqual([B]);
  });
});
