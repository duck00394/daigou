// 客人預訂的商品改出貨人：出貨時選扣誰的、已保留的換人、已經出貨的換人；不夠就擋下來；作廢過的不能換
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { createOrder } from "@/server/services/orders";
import { createShipment } from "@/server/services/shipping";
import { reserveForItem } from "@/server/services/inventory";
import { switchShipmentOwner } from "@/server/services/ship-owner";
import { stockByOwner } from "@/server/services/ownership";
import { sellToCustomer } from "@/server/services/sell";
import { listQuickSales, voidQuickSale } from "@/server/services/quick-sale";

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
const free = async () => {
  const by = (await tx((t) => stockByOwner(t, { productIds: [s.p1.id] }))).get(s.p1.id)!;
  return [by.get(A)?.free ?? 0, by.get(B)?.free ?? 0];
};
const preorder = async (qty: number) => (await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty, unitPrice: 500 }] }))).items[0].id;

describe("預訂商品改出貨人", () => {
  it("出貨時選 B：不夠的從 B 的保留，A 的不動", async () => {
    await stockOf(A, 2);
    await stockOf(B, 1);
    const item = await preorder(1);
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item, qty: 1 }], autoReserve: true, owner: B }));
    expect(await free()).toEqual([2, 0]);
  });

  it("已經保留了 A 的，出貨時選 B：換成 B 的", async () => {
    await stockOf(A, 2);
    await stockOf(B, 1);
    const item = await preorder(1);
    await tx((t) => reserveForItem(t, actor, { orderItemId: item, qty: 1 }));
    expect(await free()).toEqual([1, 1]);
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item, qty: 1 }], owner: B }));
    expect(await free()).toEqual([2, 0]);
  });

  it("已經出貨扣到 A 的：改成 B 出貨 → A 退回、B 扣掉；不夠就擋下來", async () => {
    await stockOf(A, 2);
    await stockOf(B, 1);
    const item = await preorder(1);
    const { shipment } = await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: item, qty: 1 }], autoReserve: true }));
    expect(await free()).toEqual([1, 1]);
    const r = await tx((t) => switchShipmentOwner(t, actor, shipment.id, B));
    expect(r.moved).toBe(1);
    expect(await free()).toEqual([2, 0]);
    // 再換一次 B：本來就是 B 的，不用換
    expect((await tx((t) => switchShipmentOwner(t, actor, shipment.id, B))).moved).toBe(0);
    // 換回 A 可以；再換成 B，但 B 已經沒貨 → 擋下來
    await tx((t) => switchShipmentOwner(t, actor, shipment.id, A));
    expect(await free()).toEqual([1, 1]);
    const second = await preorder(1);
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: second, qty: 1 }], autoReserve: true, owner: B }));
    await expect(tx((t) => switchShipmentOwner(t, actor, shipment.id, B))).rejects.toThrow(/的可用庫存只有 0 件/);
    expect(await free()).toEqual([1, 0]);
  });

  it("現貨出售也能改；作廢過的就不能改；改過再作廢，貨回到新的人", async () => {
    await stockOf(A, 1);
    await stockOf(B, 1);
    await tx((t) => sellToCustomer(t, actor, { buyerName: null, lines: [{ productId: s.p1.id, qty: 1, unitPrice: 500 }], idemKey: "ship-owner-01" }));
    const sale = (await tx((t) => listQuickSales(t))).rows[0];
    const sh = await prisma.shipment.findFirstOrThrow({ where: { items: { some: { orderItem: { orderId: sale.id } } } } });
    await tx((t) => switchShipmentOwner(t, actor, sh.id, B));
    expect(await free()).toEqual([1, 0]);
    const after = (await tx((t) => listQuickSales(t))).rows[0];
    expect(after.owners.filter((o) => o.qty > 0).map((o) => o.key)).toEqual([B]);
    await tx((t) => voidQuickSale(t, actor, sale.id, "測試"));
    expect(await free()).toEqual([1, 1]);
    await expect(tx((t) => switchShipmentOwner(t, actor, sh.id, A))).rejects.toThrow(/作廢或退回/);
  });
});
