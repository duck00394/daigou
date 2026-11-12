// 賺多少照系列算：已出貨（實際成本）＋還沒給（預估）；每張單、每個系列
import { beforeEach, describe, expect, it } from "vitest";
import { tx } from "@/server/db";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { createOrder } from "@/server/services/orders";
import { createShipment } from "@/server/services/shipping";
import { orderProfits, profitOf } from "@/server/services/profit";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
});

describe("賺多少：照系列、每張單", () => {
  it("出貨的照實際成本、還沒給的照預估；沒成本的不算；選系列只算那個系列", async () => {
    const b = await tx((t) => createBatch(t, actor, { name: "團", supplier: "代購", orderedById: "op_a" }));
    const i1 = await tx((t) => addBatchItem(t, actor, b.id, { productId: s.p1.id, qty: 3, unitCost: 300, currency: "TWD" }));
    await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: "op_a", lines: [{ batchItemId: i1.id, receivedQty: 3 }] }));
    // 吉伊 2 件（每件 500）＋小八 1 件（沒買過，沒成本）；系列：萬聖節
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, groupBuyId: s.gb.id, items: [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }], shippingFee: 60 }));
    const [it1] = await tx((t) => t.orderItem.findMany({ where: { orderId: o.id, productId: s.p1.id } }));
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: it1.id, qty: 1 }], autoReserve: true, dedupeKey: "prof-ship-1" }));

    const all = await tx((t) => orderProfits(t, {}));
    const row = all.orders.find((x) => x.id === o.id)!;
    expect([row.shipped.qty, row.shipped.revenue, row.shipped.cost]).toEqual([1, 500, 300]);
    expect([row.open.qty, row.open.revenue, row.open.cost, row.open.uncosted]).toEqual([1, 500, 300, 1]); // 小八沒成本：不算收入
    expect(profitOf(row.shipped) + profitOf(row.open)).toBe(400);
    expect(all.total.shipped.qty).toBe(1);
    const halloween = all.series.find((x) => x.id === s.halloween.id)!;
    expect(profitOf(halloween.shipped) + profitOf(halloween.open)).toBe(400);
    expect(all.unpaid).toBe(1360); // 2×500＋300＋運費 60

    // 選別的系列：這張單看不到
    const other = await tx((t) => orderProfits(t, { categoryId: s.shanghai.id }));
    expect(other.orders.find((x) => x.id === o.id)).toBeUndefined();
    // 單一張
    const one = await tx((t) => orderProfits(t, { orderId: o.id }));
    expect(one.orders).toHaveLength(1);
  });
});
