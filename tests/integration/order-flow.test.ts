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
import { packState, setPacked, shipOrder, pickedUp, bulkShip, bulkShipPreview, bulkPay, bulkPayPreview, readyToShip } from "@/server/services/order-flow";

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

  it("跟 B 訂的、只有 A 的貨：各賣各的，不能勾、不能出；B 的貨到了才可以，扣 B 的", async () => {
    await stock(A, s.p1.id, 1);
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    const [it] = await prisma.orderItem.findMany({ where: { orderId: o.id } });
    await prisma.orderItem.update({ where: { id: it.id }, data: { ownerKey: B } });
    const st = (await tx((t) => packState(t, o.id)))[0];
    expect([st.canPack, st.short]).toEqual([false, 1]);
    await expect(tx((t) => setPacked(t, actor, o.id, [it.id], true))).rejects.toThrow("還差 1 件");
    await stock(B, s.p1.id, 1);
    expect((await tx((t) => packState(t, o.id)))[0].canPack).toBe(true);
    await tx((t) => updateItem(t, actor, it.id, { packFlag: "READY" }));
    await tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "ship-key-0004" }));
    const mv = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: it.id }, include: { purchaseBatchItem: { include: { batch: true } } } });
    expect(mv.map((m) => m.purchaseBatchItem?.batch.orderedById)).toEqual([B]);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: it.id } })).ownerKey).toBe(B);
  });
});

describe("訂單列表：一次出貨、一次收款", () => {
  it("同一位客人併成一包；貨不夠的那張先不出；收款每張記待收、已付清跳過；重送不重複", async () => {
    await stock(A, s.p1.id, 2);
    const o1 = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    const o2 = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }], shippingFee: 60 }));
    const o3 = await tx((t) => createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p1.id, qty: 1 }] })); // 吉伊只有 2 件，第三張不夠
    const o4 = await tx((t) => createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p2.id, qty: 1 }] })); // 小八沒貨
    const ids = [o1.id, o2.id, o3.id, o4.id];

    const pv = await tx((t) => bulkShipPreview(t, ids));
    const mei = pv.find((g) => g.buyerId === s.b1.id)!;
    expect(mei.ok.map((o) => o.qty)).toEqual([1, 1]);
    const ting = pv.find((g) => g.buyerId === s.b2.id)!;
    // 吉伊只有 2 件：先下單的小美兩張先排，阿婷那張預覽時就標出還差（跟首頁、出貨頁同一套排程）
    expect(ting.skip.map((x) => x.reason)).toEqual(["吉伊吊娃還差 1 件", "小八 S 娃還差 1 件"]);

    const r = await tx((t) => bulkShip(t, actor, { orderIds: ids, method: "賣貨便", dedupeKey: "bulk-ship-0001" }));
    // 小美兩張併一包；阿婷兩張都先不出
    expect([r.buyers, r.qty]).toEqual([1, 2]);
    expect(r.skipped.map((x) => x.orderNo).sort()).toEqual([o3.orderNo, o4.orderNo].sort());
    const ships = await prisma.shipment.findMany({ include: { items: true } });
    expect(ships.map((x) => [x.buyerId, x.items.length])).toEqual([[s.b1.id, 2]]);
    // 重送同一個識別碼不會多一包
    await tx((t) => bulkShip(t, actor, { orderIds: ids, method: "賣貨便", dedupeKey: "bulk-ship-0001" })).catch(() => null);
    expect(await prisma.shipment.count()).toBe(1);

    // 收款：o1 500、o2 560；先把 o3 付清 → 跳過
    await tx((t) => addPayment(t, actor, { orderId: o3.id, amount: 500 }));
    const pp = await tx((t) => bulkPayPreview(t, ids));
    expect(pp.map((x) => [x.amount, x.reason])).toEqual([[500, null], [560, null], [0, "已付清"], [300, null]]);
    const pay = await tx((t) => bulkPay(t, actor, { orderIds: ids, method: "轉帳", dedupeKey: "bulk-pay-0001" }));
    expect([pay.count, pay.total]).toEqual([3, 1360]);
    // 重送：不會多記
    await tx((t) => bulkPay(t, actor, { orderIds: ids, method: "轉帳", dedupeKey: "bulk-pay-0001" })).catch(() => null);
    expect(await prisma.payment.count()).toBe(4);
    const after = await prisma.order.findMany({ where: { id: { in: ids } }, select: { paymentStatusCache: true } });
    expect(after.every((o) => o.paymentStatusCache === "PAID")).toBe(true);
  });
});

describe("到貨可以出貨的訂單", () => {
  it("先下單的先分；不夠的那張不算、也不佔貨；跟誰訂的只能用那個人的貨；看某個人只是篩給他看；出完就不列", async () => {
    await stock(A, s.p1.id, 1);
    const o1 = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    const o2 = await tx((t) => createOrder(t, actor, { buyerId: s.b2.id, items: [{ productId: s.p1.id, qty: 1 }] })); // 吉伊只有 1 件 → 先下單的 o1 可以出
    const o3 = await tx((t) => createOrder(t, actor, { buyerId: s.b3.id, items: [{ productId: s.p2.id, qty: 1 }] })); // 小八沒貨
    let r = await tx((t) => readyToShip(t, {}));
    expect(r.orderIds).toEqual([o1.id]);
    expect(r.qty).toBe(1);
    // o1 改成跟 B 訂、只有 A 的貨 → o1 不能用 A 的；沒記跟誰訂的 o2 拿到那 1 件；看 B 的待辦沒有
    await prisma.orderItem.updateMany({ where: { orderId: o1.id }, data: { ownerKey: B } });
    r = await tx((t) => readyToShip(t, {}));
    expect(r.orderIds).toEqual([o2.id]);
    expect((await tx((t) => readyToShip(t, { owner: B }))).orderIds).toEqual([]);
    // 到 1 件（B 團）：o1 也可以出；看 B 的待辦列出 o1
    await stock(B, s.p1.id, 1);
    r = await tx((t) => readyToShip(t, {}));
    expect(r.orderIds).toEqual([o1.id, o2.id]);
    expect((await tx((t) => readyToShip(t, { owner: B }))).orderIds).toEqual([o1.id]);
    // 只看跟小八有關的：沒有
    expect((await tx((t) => readyToShip(t, { productIds: [s.p2.id] }))).orderIds).toEqual([]);
    // 出完就不列
    await tx((t) => bulkShip(t, actor, { orderIds: [o1.id, o2.id], dedupeKey: "ready-ship-0001" }));
    expect((await tx((t) => readyToShip(t, {}))).orderIds).toEqual([]);
    expect(o3).toBeTruthy();
  });
});
