// 出貨排程：首頁待辦、訂單列表、出貨頁、採購團收貨提醒、一次出貨都用同一套（shipPlan）
// 各賣各的：記了跟誰訂的就只能用那個人的貨，沒記的誰的貨都可以；自留不算；已保留的不重複分；先下單的先分；實際扣庫存照批次進貨先後（FIFO）
// 驗：只扣自己的貨、有無「跟誰訂的」混在一起、預覽＝實際保留、FIFO 成本、自留、先下單優先、部分到貨、整張可出、一次出貨、重複送出、同時送出、失敗整筆退回
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { addBatchItem, createBatch } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { createOrder } from "@/server/services/orders";
import { keepStock, inventorySummary, reserveForItem } from "@/server/services/inventory";
import { createShipment } from "@/server/services/shipping";
import { bulkShip, bulkShipPreview, readyToShip, setPacked, shipOrder, shipPlan } from "@/server/services/order-flow";

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

async function stock(owner: string, productId: string, qty: number, unitCost = 300, received = qty) {
  const b = await tx((t) => createBatch(t, actor, { name: `${owner} 團 ${unitCost}`, supplier: "代購", orderedById: owner }));
  const i = await tx((t) => addBatchItem(t, actor, b.id, { productId, qty, unitCost, currency: "TWD" }));
  if (received > 0) await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: owner, lines: [{ batchItemId: i.id, receivedQty: received }] }));
  return i;
}
const order = (buyerId: string, items: { productId: string; qty: number }[]) => tx((t) => createOrder(t, actor, { buyerId, items }));
const setOwner = (orderId: string, ownerKey: string | null) => prisma.orderItem.updateMany({ where: { orderId }, data: { ownerKey } });
const onHand = async (productId: string) => (await tx((t) => inventorySummary(t, [productId]))).get(productId)!;
const itemsOf = (orderId: string) => prisma.orderItem.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
const itemOf = async (orderId: string, productId: string) => (await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId } }));
/** 每一項實際出了幾件（SHIP 異動加總） */
async function shippedBy(orderId: string) {
  const mv = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", orderItem: { orderId } }, select: { orderItemId: true, onHandDelta: true } });
  const m = new Map<string, number>();
  for (const x of mv) m.set(x.orderItemId!, (m.get(x.orderItemId!) ?? 0) - x.onHandDelta);
  return m;
}
/** 出貨扣了哪一批（批次的單價），照件數展開 */
async function shipCosts(where: object = {}) {
  const mv = await prisma.inventoryMovement.findMany({ where: { kind: "SHIP", ...where }, select: { onHandDelta: true, purchaseBatchItem: { select: { estUnitCost: true, batch: { select: { orderedById: true } } } } } });
  return mv.flatMap((m) => Array(-m.onHandDelta).fill(`${m.purchaseBatchItem!.batch.orderedById}:${m.purchaseBatchItem!.estUnitCost}`)).sort();
}
/** 沒有孤立保留：每個商品的保留異動加總＝各明細記的保留數，且出完都是 0 */
async function reservedTotals(productId: string) {
  const mv = await prisma.inventoryMovement.aggregate({ where: { productId }, _sum: { reservedDelta: true } });
  const items = await prisma.orderItem.aggregate({ where: { productId }, _sum: { reservedQtyCache: true } });
  return { movements: mv._sum.reservedDelta ?? 0, items: items._sum.reservedQtyCache ?? 0 };
}

/** 四個地方看到的「可以出貨」：首頁（全部）、訂單列表（同一個函式）、出貨頁（排程的整張可出）、採購團收貨提醒（只看這團的商品） */
async function views(productIds: string[]) {
  const home = (await tx((t) => readyToShip(t, {}))).orderIds;
  const plan = await tx((t) => shipPlan(t));
  const batch = (await tx((t) => readyToShip(t, { productIds }))).orderIds;
  return { home, list: home, shippingPage: plan.readyOrderIds, batch, plan };
}

describe("出貨排程（各頁一致）", () => {
  it("同一客人多張、不同客人一起出；不同成本批次照 FIFO；出完剩下的單與庫存正確", async () => {
    await stock(A, s.p1.id, 2, 300); // 先買進的 300
    await stock(A, s.p1.id, 2, 500); // 後買進的 500
    const m1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const m2 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const t1 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    const w1 = await order(s.b3.id, [{ productId: s.p1.id, qty: 2 }]); // 只剩 1 件 → 不夠
    const v = await views([s.p1.id]);
    expect(v.home).toEqual([m1.id, m2.id, t1.id]);
    expect(v.shippingPage).toEqual(v.home);
    expect(v.batch).toEqual(v.home);
    // 出貨頁：不夠的那張可以先出一部分（剩 1 件）
    const wItem = v.plan.items.find((i) => i.orderId === w1.id)!;
    expect([wItem.pending, wItem.shippable]).toEqual([2, 1]);

    const pv = await tx((t) => bulkShipPreview(t, [m1.id, m2.id, t1.id, w1.id]));
    expect(pv.find((g) => g.buyerId === s.b3.id)!.skip[0].reason).toContain("還差 1 件");
    const r = await tx((t) => bulkShip(t, actor, { orderIds: [m1.id, m2.id, t1.id, w1.id], dedupeKey: "plan-ship-0001" }));
    expect([r.buyers, r.qty, r.skipped.map((x) => x.id), r.duplicated]).toEqual([2, 3, [w1.id], false]);
    // 小美兩張併一包、阿婷一包
    const ships = await prisma.shipment.findMany({ include: { items: true } });
    expect(ships.map((x) => [x.buyerId, x.items.length]).sort()).toEqual([[s.b1.id, 2], [s.b2.id, 1]].sort());
    // FIFO：先出 300 的兩件，再一件 500
    expect(await shipCosts()).toEqual([`${A}:300`, `${A}:300`, `${A}:500`]);
    // 剩下：庫存 1、還沒給的只有 w1 的 2 件；各頁都沒有可以整張出的
    expect((await onHand(s.p1.id)).onHand).toBe(1);
    const after = await views([s.p1.id]);
    expect(after.home).toEqual([]);
    expect(after.shippingPage).toEqual([]);
    expect(after.plan.items.map((i) => [i.orderId, i.pending, i.shippable])).toEqual([[w1.id, 2, 1]]);
    // 重複送出同一個識別碼：回傳第一次的結果，不會多出貨
    const again = await tx((t) => bulkShip(t, actor, { orderIds: [m1.id, m2.id, t1.id], dedupeKey: "plan-ship-0001" }));
    expect([again.buyers, again.qty, again.duplicated]).toEqual([2, 3, true]);
    expect(await prisma.shipment.count()).toBe(2);
    expect((await onHand(s.p1.id)).onHand).toBe(1);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("部分到貨：還不能整張出；到齊後各頁同時出現（整張可出）", async () => {
    const bi = await stock(A, s.p1.id, 2, 300, 1); // 買 2 到 1
    const o = await order(s.b1.id, [{ productId: s.p1.id, qty: 2 }]);
    let v = await views([s.p1.id]);
    expect([v.home, v.shippingPage, v.batch]).toEqual([[], [], []]);
    expect(v.plan.items[0].shippable).toBe(1);
    // 只到 1 件：一次出貨擋下來並說原因
    await expect(tx((t) => bulkShip(t, actor, { orderIds: [o.id], dedupeKey: "plan-ship-part" }))).rejects.toThrow("沒辦法出貨");
    await tx((t) => createReceivingRecord(t, actor, { batchId: bi.batchId, receivedById: A, lines: [{ batchItemId: bi.id, receivedQty: 1 }] }));
    v = await views([s.p1.id]);
    expect([v.home, v.shippingPage, v.batch]).toEqual([[o.id], [o.id], [o.id]]);
    expect(v.plan.items[0].shippable).toBe(2);
  });

  it("庫存不足：一件都沒到的單不會出現在任何一頁；一次出貨整筆擋下來並說原因", async () => {
    const o = await order(s.b1.id, [{ productId: s.p2.id, qty: 1 }]);
    const v = await views([s.p2.id]);
    expect([v.home, v.shippingPage, v.batch]).toEqual([[], [], []]);
    await expect(tx((t) => bulkShip(t, actor, { orderIds: [o.id], dedupeKey: "plan-ship-none" }))).rejects.toThrow("沒辦法出貨");
    expect(await prisma.shipment.count()).toBe(0);
  });
});

describe("各賣各的（記了跟誰訂的就只扣那個人的貨）", () => {
  it("A 團有貨、B 團沒貨：跟 B 訂的單不能用 A 的貨（各頁都不列、出貨擋下來）；沒記跟誰訂的就可以用", async () => {
    await stock(A, s.p1.id, 1, 300);
    const o = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    await setOwner(o.id, B);
    let v = await views([s.p1.id]);
    expect([v.home, v.shippingPage, v.batch]).toEqual([[], [], []]);
    expect(v.plan.items[0].shippable).toBe(0);
    expect((await tx((t) => readyToShip(t, { owner: B }))).orderIds).toEqual([]);
    const [it] = await itemsOf(o.id);
    await expect(tx((t) => setPacked(t, actor, o.id, [it.id], true))).rejects.toThrow("還差 1 件");
    await expect(tx((t) => bulkShip(t, actor, { orderIds: [o.id], dedupeKey: "own-ship-0000" }))).rejects.toThrow("沒辦法出貨");
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: it.id, qty: 1 }], autoReserve: true, dedupeKey: "own-ship-page" }))).rejects.toThrow("可用庫存只有 0 件");
    expect(await prisma.inventoryMovement.count({ where: { kind: { in: ["RESERVE", "SHIP"] } } })).toBe(0);
    // 改成沒記跟誰訂的：誰的貨都可以，照到貨先後扣
    await setOwner(o.id, null);
    v = await views([s.p1.id]);
    expect([v.home, v.shippingPage, v.batch]).toEqual([[o.id], [o.id], [o.id]]);
    await tx((t) => setPacked(t, actor, o.id, [it.id], true));
    await tx((t) => shipOrder(t, actor, { orderId: o.id, dedupeKey: "own-ship-0001" }));
    expect(await shipCosts()).toEqual([`${A}:300`]);
  });

  it("A、B 團都有貨：跟誰訂的就扣誰的（不會搶對方的）；沒記的照到貨先後；預覽＝實際", async () => {
    await stock(A, s.p1.id, 1, 300); // 最早到貨
    await stock(B, s.p1.id, 1, 500);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]); // 跟 B 訂
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]); // 跟 A 訂
    const o3 = await order(s.b3.id, [{ productId: s.p1.id, qty: 1 }]); // 沒記跟誰訂的
    await setOwner(o1.id, B);
    await setOwner(o2.id, A);
    const v = await views([s.p1.id]);
    expect(v.home).toEqual([o1.id, o2.id]);
    expect(v.shippingPage).toEqual(v.home);
    expect(v.plan.items.find((i) => i.orderId === o3.id)!.shippable).toBe(0);
    // 看 A：只列跟 A 訂的
    expect((await tx((t) => readyToShip(t, { owner: A }))).orderIds).toEqual([o2.id]);
    const pv = await tx((t) => bulkShipPreview(t, [o1.id, o2.id, o3.id]));
    expect(pv.flatMap((g) => g.ok.map((x) => x.id)).sort()).toEqual([o1.id, o2.id].sort());
    expect(pv.flatMap((g) => g.skip.map((x) => x.id))).toEqual([o3.id]);
    const r = await tx((t) => bulkShip(t, actor, { orderIds: [o3.id, o2.id, o1.id], dedupeKey: "own-ship-0002" }));
    expect([r.buyers, r.qty, r.skipped.map((x) => x.id)]).toEqual([2, 2, [o3.id]]);
    // 實際扣的：o1 扣 B 的 500、o2 扣 A 的 300
    expect(await shipCosts({ orderItem: { orderId: o1.id } })).toEqual([`${B}:500`]);
    expect(await shipCosts({ orderItem: { orderId: o2.id } })).toEqual([`${A}:300`]);
    expect((await onHand(s.p1.id)).onHand).toBe(0);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("有記跟誰訂的、沒記的混在一起，多個商品、多個批次：預覽的每一項可出件數＝實際能保留、能出的", async () => {
    await stock(A, s.p1.id, 2, 300);
    await stock(B, s.p1.id, 1, 500);
    await stock(A, s.p1.id, 1, 400);
    await stock(B, s.p2.id, 1, 200);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }]); // 跟 B 訂：B 的吉伊只有 1
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]); // 沒記：照到貨先後（A 300）
    const o3 = await order(s.b3.id, [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }]); // 跟 A 訂：A 沒有小八
    const o4 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]); // 跟 A 訂
    await setOwner(o1.id, B);
    await setOwner(o3.id, A);
    await setOwner(o4.id, A);
    const plan = await tx((t) => shipPlan(t));
    expect(plan.readyOrderIds).toEqual([o2.id, o4.id]);
    const of = (id: string) => plan.items.find((i) => i.id === id)!;
    const o1p1 = await itemOf(o1.id, s.p1.id);
    const o1p2 = await itemOf(o1.id, s.p2.id);
    const o3p1 = await itemOf(o3.id, s.p1.id);
    const o3p2 = await itemOf(o3.id, s.p2.id);
    // 剩下：B 的吉伊 1、小八 1 給 o1；A 的吉伊剩 1（400）給 o3
    expect([of(o1p1.id).shippable, of(o1p2.id).shippable, of(o3p1.id).shippable, of(o3p2.id).shippable]).toEqual([1, 1, 1, 0]);

    const r = await tx((t) => bulkShip(t, actor, { orderIds: [o1.id, o2.id, o3.id, o4.id], dedupeKey: "own-ship-0003" }));
    expect([r.buyers, r.qty, r.skipped.map((x) => x.id).sort()]).toEqual([2, 2, [o1.id, o3.id].sort()]);
    for (const id of plan.readyOrderIds) for (const it of await itemsOf(id)) expect((await shippedBy(id)).get(it.id)).toBe(it.qty);
    // o2（沒記）、o4（A）都扣 A 最早的 300
    expect(await shipCosts({ productId: s.p1.id })).toEqual([`${A}:300`, `${A}:300`]);

    // 出貨頁照預覽的可出件數出：o3 吉伊 1 件扣 A 的 400；多 1 件就擋下來
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b3.id, items: [{ orderItemId: o3p1.id, qty: 2 }], autoReserve: true, dedupeKey: "own-ship-over" }))).rejects.toThrow();
    await tx((t) => createShipment(t, actor, { buyerId: s.b3.id, items: [{ orderItemId: o3p1.id, qty: 1 }], autoReserve: true, dedupeKey: "own-ship-part" }));
    expect(await shipCosts({ orderItemId: o3p1.id })).toEqual([`${A}:400`]);
    // o1：B 的吉伊 1、小八 1 照樣可以出
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: o1p1.id, qty: 1 }, { orderItemId: o1p2.id, qty: 1 }], autoReserve: true, dedupeKey: "own-ship-o1" }));
    expect(await shipCosts({ orderItem: { orderId: o1.id } })).toEqual([`${B}:200`, `${B}:500`]);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("自留不算可出；保留給別人的不重複分；跟 B 訂的不能用 A 的貨", async () => {
    await stock(A, s.p1.id, 3);
    await tx((t) => keepStock(t, actor, { productId: s.p1.id, delta: 1, owner: A, dedupeKey: "keep-plan-1" })); // A 自留 1
    const o0 = await order(s.b3.id, [{ productId: s.p1.id, qty: 1 }]);
    const it0 = await itemOf(o0.id, s.p1.id);
    await tx((t) => reserveForItem(t, actor, { orderItemId: it0.id, qty: 1, owner: null })); // o0 已保留 1 件（還沒出）
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    await setOwner(o1.id, B); // 跟 B 訂、B 沒貨 → 不能出
    const v = await views([s.p1.id]);
    // 3 件：自留 1、保留給 o0 1 → 只剩 1 件可賣；o1 跟 B 訂用不到，給 o2
    expect(v.home).toEqual([o0.id, o2.id]);
    expect(v.plan.items.find((i) => i.orderId === o1.id)!.shippable).toBe(0);
    const it1 = await itemOf(o1.id, s.p1.id);
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: it1.id, qty: 1 }], autoReserve: true, dedupeKey: "keep-plan-ship1" }))).rejects.toThrow();
    const it2 = await itemOf(o2.id, s.p1.id);
    await tx((t) => createShipment(t, actor, { buyerId: s.b2.id, items: [{ orderItemId: it2.id, qty: 1 }], autoReserve: true, dedupeKey: "keep-plan-ship2" }));
    expect((await itemOf(o0.id, s.p1.id)).reservedQtyCache).toBe(1);
    // o0 出貨：用它自己保留的那件；o1 還是不能出
    const r = await tx((t) => bulkShip(t, actor, { orderIds: [o0.id, o1.id], dedupeKey: "keep-plan-bulk0" }));
    expect([r.buyers, r.qty, r.skipped.map((x) => x.id)]).toEqual([1, 1, [o1.id]]);
    const inv = await onHand(s.p1.id);
    expect([inv.onHand, inv.kept]).toEqual([0, 1]);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("保留一部分的單：已保留的照算，只需要補差額；有保留的單不會被後面的搶走", async () => {
    await stock(A, s.p1.id, 2);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 2 }]);
    const [it1] = await itemsOf(o1.id);
    await tx((t) => reserveForItem(t, actor, { orderItemId: it1.id, qty: 1, owner: null }));
    const o0 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    // 下單順序 o1 先；o1 已保留 1 件、再補 1 件 → 整張可出；o0 沒貨
    const plan = await tx((t) => shipPlan(t));
    expect(plan.readyOrderIds).toEqual([o1.id]);
    expect(plan.items.find((i) => i.orderId === o0.id)!.shippable).toBe(0);
    const r = await tx((t) => bulkShip(t, actor, { orderIds: [o1.id, o0.id], dedupeKey: "res-ship-0001" }));
    expect([r.buyers, r.qty]).toEqual([1, 2]);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });
});

describe("重複送出、同時送出、失敗整筆退回", () => {
  it("重複送出：一次出貨、單張出貨、出貨頁都回傳第一次的結果（不會出現「最多只能再出貨 0 件」）", async () => {
    await stock(A, s.p1.id, 3);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    const o3 = await order(s.b3.id, [{ productId: s.p1.id, qty: 1 }]);
    const first = await tx((t) => bulkShip(t, actor, { orderIds: [o1.id], dedupeKey: "dup-bulk-1" }));
    const second = await tx((t) => bulkShip(t, actor, { orderIds: [o1.id], dedupeKey: "dup-bulk-1" }));
    expect([second.buyers, second.qty, second.duplicated]).toEqual([first.buyers, first.qty, true]);

    const [it2] = await itemsOf(o2.id);
    await tx((t) => setPacked(t, actor, o2.id, [it2.id], true));
    const s1 = await tx((t) => shipOrder(t, actor, { orderId: o2.id, dedupeKey: "dup-ship-1" }));
    const s2 = await tx((t) => shipOrder(t, actor, { orderId: o2.id, dedupeKey: "dup-ship-1" }));
    expect([s2.shipmentNo, s2.count, s2.duplicated]).toEqual([s1.shipmentNo, 1, true]);

    const [it3] = await itemsOf(o3.id);
    const input = { buyerId: s.b3.id, items: [{ orderItemId: it3.id, qty: 1 }], autoReserve: true, dedupeKey: "dup-page-1" };
    const c1 = await tx((t) => createShipment(t, actor, input));
    const c2 = await tx((t) => createShipment(t, actor, input)); // 這一項已經沒有要出的，但同一個識別碼直接回傳原本那筆
    expect([c2.shipment.id, c2.duplicated]).toEqual([c1.shipment.id, true]);

    expect(await prisma.shipment.count()).toBe(3);
    expect((await onHand(s.p1.id)).onHand).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { kind: "SHIP" } })).toBe(3);
    expect(await prisma.inventoryMovement.count({ where: { kind: "RESERVE" } })).toBe(3);
  });

  it("同時送出相同識別碼（一次出貨）：只出一次、不重複保留、沒有孤立保留、不多扣；另一個拿到第一次的結果", async () => {
    await stock(A, s.p1.id, 2, 300);
    await stock(B, s.p1.id, 2, 500);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 2 }]);
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    await setOwner(o2.id, B);
    const run = () => tx((t) => bulkShip(t, actor, { orderIds: [o1.id, o2.id], dedupeKey: "race-bulk-1" }));
    const rs = await Promise.allSettled([run(), run(), run()]);
    expect(rs.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const vals = rs.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value);
    expect(vals.filter((v) => !v.duplicated)).toHaveLength(1);
    for (const v of vals) expect([v.buyers, v.qty]).toEqual([2, 3]);
    expect(await prisma.shipment.count()).toBe(2);
    expect((await onHand(s.p1.id)).onHand).toBe(1);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
    expect(await shipCosts()).toEqual([`${A}:300`, `${A}:300`, `${B}:500`]);
  });

  it("同時送出相同識別碼（訂單頁出貨、出貨頁出貨）：只出一次，另一個拿到原本那筆", async () => {
    await stock(A, s.p1.id, 2);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const [it1] = await itemsOf(o1.id);
    await tx((t) => setPacked(t, actor, o1.id, [it1.id], true));
    const ship = () => tx((t) => shipOrder(t, actor, { orderId: o1.id, dedupeKey: "race-ship-1" }));
    const a = await Promise.allSettled([ship(), ship()]);
    expect(a.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const av = a.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof ship>>>).value);
    expect(av.filter((v) => v.duplicated)).toHaveLength(1);
    expect(av[0].shipmentNo).toBe(av[1].shipmentNo);

    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    const [it2] = await itemsOf(o2.id);
    const page = () => tx((t) => createShipment(t, actor, { buyerId: s.b2.id, items: [{ orderItemId: it2.id, qty: 1 }], autoReserve: true, dedupeKey: "race-page-1" }));
    const b = await Promise.allSettled([page(), page()]);
    expect(b.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const bv = b.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof page>>>).value);
    expect(bv.filter((v) => v.duplicated)).toHaveLength(1);
    expect(bv[0].shipment.id).toBe(bv[1].shipment.id);

    expect(await prisma.shipment.count()).toBe(2);
    expect(await prisma.inventoryMovement.count({ where: { kind: "RESERVE" } })).toBe(2);
    expect((await onHand(s.p1.id)).onHand).toBe(0);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("同時搶最後一件（不同識別碼）：只有一張出得去，另一張擋下來、什麼都沒留下", async () => {
    await stock(A, s.p1.id, 1);
    const o1 = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }]);
    const o2 = await order(s.b2.id, [{ productId: s.p1.id, qty: 1 }]);
    const [it2] = await itemsOf(o2.id);
    const rs = await Promise.allSettled([
      tx((t) => bulkShip(t, actor, { orderIds: [o1.id], dedupeKey: "race-last-1" })),
      tx((t) => createShipment(t, actor, { buyerId: s.b2.id, items: [{ orderItemId: it2.id, qty: 1 }], autoReserve: true, dedupeKey: "race-last-2" })),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.shipment.count()).toBe(1);
    expect((await onHand(s.p1.id)).onHand).toBe(0);
    expect(await reservedTotals(s.p1.id)).toEqual({ movements: 0, items: 0 });
  });

  it("出貨中途不夠：整筆退回，前面已保留的也不留下", async () => {
    await stock(A, s.p1.id, 1);
    const o = await order(s.b1.id, [{ productId: s.p1.id, qty: 1 }, { productId: s.p2.id, qty: 1 }]); // 小八沒貨
    const a = await itemOf(o.id, s.p1.id);
    const b = await itemOf(o.id, s.p2.id);
    await expect(tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: a.id, qty: 1 }, { orderItemId: b.id, qty: 1 }], autoReserve: true, dedupeKey: "rollback-1" }))).rejects.toThrow();
    expect(await prisma.shipment.count()).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { kind: { in: ["RESERVE", "SHIP"] } } })).toBe(0);
    expect((await itemsOf(o.id)).every((i) => i.reservedQtyCache === 0 && i.shippedQtyCache === 0)).toBe(true);
    // 同一個識別碼之後補貨再送：可以正常出（沒有被卡住）
    await stock(A, s.p2.id, 1);
    await tx((t) => createShipment(t, actor, { buyerId: s.b1.id, items: [{ orderItemId: a.id, qty: 1 }, { orderItemId: b.id, qty: 1 }], autoReserve: true, dedupeKey: "rollback-1" }));
    expect(await prisma.shipment.count()).toBe(1);
  });
});
