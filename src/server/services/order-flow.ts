// 訂單頁的三步：備齊（勾）→ 出貨（整張單還沒出的一次出）→ 客人取貨（可一起記收款）
import { BizError, lockRows, type Tx } from "@/server/db";
import type { Actor } from "./common";
import { updateItem } from "./orders";
import { reserveForItem } from "./inventory";
import { stockByOwner } from "./ownership";
import { createShipment } from "./shipping";
import { addPayment } from "./payments";
import { recomputeOrder } from "./recompute";
import { audit } from "./common";

/**
 * 出貨前先上鎖：訂單（依 id 排序）→ 這些訂單還沒出的商品（依 id 排序）。
 * 跟出貨單、保留庫存的鎖定順序一致；鎖住後才讀數量、算排程、保留，同時送出的請求會排隊、不會重複保留。
 */
async function lockForShip(t: Tx, orderIds: string[]) {
  await lockRows(t, "Order", orderIds);
  const prods = await t.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { productId: true } });
  await lockRows(t, "Product", prods.map((p) => p.productId));
}

type Line = { id: string; productId: string; name: string; pending: number; reserved: number; ownerKey: string | null; packed: boolean };

/** 這張單還沒出貨的明細，以及每一項現在能不能備齊（保留＋可用庫存夠不夠；共用庫存池） */
export async function packState(t: Tx, orderId: string) {
  const items = await t.orderItem.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, productId: true, productNameSnapshot: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true, ownerKey: true, packFlag: true },
  });
  const lines: Line[] = items
    .map((i) => ({ id: i.id, productId: i.productId, name: i.productNameSnapshot, pending: i.qty - i.cancelledQtyCache - i.shippedQtyCache, reserved: i.reservedQtyCache, ownerKey: i.ownerKey, packed: i.packFlag === "READY" }))
    .filter((l) => l.pending > 0);
  const byOwner = await stockByOwner(t, { productIds: [...new Set(lines.map((l) => l.productId))] });
  // 同一商品出現在好幾列：可用庫存依序分，不重複算；不分是誰的貨（共用庫存池）
  const used = new Map<string, number>();
  return lines.map((l) => {
    const m = byOwner.get(l.productId);
    const key = l.productId;
    const free = [...(m?.values() ?? [])].reduce((a, x) => a + Math.max(0, x.free), 0);
    const left = Math.max(0, free - (used.get(key) ?? 0));
    const need = Math.max(0, l.pending - l.reserved);
    const ok = need <= left;
    if (ok) used.set(key, (used.get(key) ?? 0) + need);
    return { ...l, canPack: ok, short: ok ? 0 : need - left };
  });
}

/** 勾／取消勾「備齊」；勾的時候要有貨 */
export async function setPacked(t: Tx, actor: Actor, orderId: string, itemIds: string[], packed: boolean) {
  const st = await packState(t, orderId);
  const ids = new Set(itemIds);
  const rows = st.filter((l) => ids.has(l.id));
  if (rows.length !== ids.size) throw new BizError("有商品已經出貨或不在這張單");
  for (const l of rows) {
    if (packed && !l.canPack) throw new BizError(`「${l.name}」還差 ${l.short} 件，貨到了才能勾`);
    if (l.packed !== packed) await updateItem(t, actor, l.id, { packFlag: packed ? "READY" : "NONE" });
  }
  return rows.length;
}

/** 整張單還沒出的一次出貨：不夠的先從共用庫存池保留（FIFO），再建出貨 */
export async function shipOrder(t: Tx, actor: Actor, input: { orderId: string; method?: string | null; trackingNo?: string | null; shippedAt?: Date; dedupeKey: string }) {
  const done = async () => {
    const dup = await t.shipment.findUnique({ where: { dedupeKey: input.dedupeKey }, include: { items: true } });
    return dup ? { shipmentNo: dup.shipmentNo, duplicated: true, count: dup.items.reduce((a, i) => a + i.qty, 0) } : null;
  };
  const before = await done();
  if (before) return before;
  await lockForShip(t, [input.orderId]);
  // 鎖住後再查：同一個請求剛剛完成了，就回傳那一次的結果
  const again = await done();
  if (again) return again;
  const order = await t.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { buyerId: true, confirmation: true } });
  if (order.confirmation !== "CONFIRMED") throw new BizError("這張單不是已確認，不能出貨");
  const st = await packState(t, input.orderId);
  if (!st.length) throw new BizError("這張單沒有要出貨的商品");
  const notPacked = st.filter((l) => !l.packed);
  if (notPacked.length) throw new BizError(`還有 ${notPacked.length} 項沒勾備齊：${notPacked.map((l) => l.name).join("、")}`);
  for (const l of st) {
    const need = l.pending - l.reserved;
    if (need > 0) await reserveForItem(t, actor, { orderItemId: l.id, qty: need, owner: null }); // 共用庫存池，照批次進貨先後（FIFO）
  }
  const r = await createShipment(t, actor, { buyerId: order.buyerId, method: input.method, trackingNo: input.trackingNo, shippedAt: input.shippedAt, items: st.map((l) => ({ orderItemId: l.id, qty: l.pending })), autoReserve: false, dedupeKey: input.dedupeKey });
  return { shipmentNo: r.shipment.shipmentNo, duplicated: false, count: st.reduce((a, l) => a + l.pending, 0) };
}

/** 客人取貨了：這張單已出貨、還沒取的都標成已取貨；collect＝同時把待收記成收款 */
export async function pickedUp(t: Tx, actor: Actor, input: { orderId: string; at?: Date; collect: boolean; dedupeKey: string }) {
  const at = input.at ?? new Date();
  const ships = await t.shipment.findMany({ where: { status: "SHIPPED", items: { some: { orderItem: { orderId: input.orderId } } } }, include: { items: { select: { orderItem: { select: { orderId: true } } } } } });
  const already = input.collect ? await t.payment.findUnique({ where: { dedupeKey: `${input.dedupeKey}:pay` } }) : null;
  if (!ships.length && !already) throw new BizError("這張單沒有還沒取貨的出貨");
  const orderIds = new Set<string>([input.orderId]);
  for (const s of ships) {
    await t.shipment.update({ where: { id: s.id }, data: { status: "DELIVERED", deliveredAt: at } });
    for (const i of s.items) orderIds.add(i.orderItem.orderId);
    await audit(t, actor, "shipment.update", "Shipment", s.id, { delivered: true });
  }
  let paid = 0;
  for (const id of orderIds) {
    const r = await recomputeOrder(t, id);
    if (id === input.orderId && input.collect && r.balance > 0 && !already) {
      await addPayment(t, actor, { orderId: id, amount: r.balance, paidAt: at, method: ships[0]?.method ?? null, note: "取貨付款", dedupeKey: `${input.dedupeKey}:pay` });
      paid = r.balance;
    }
  }
  return { paid };
}

/** 多張訂單一次出貨（看一下）：同一位客人併成一包；貨不夠的那張先不出 */
export async function bulkShipPreview(t: Tx, orderIds: string[]) {
  const orders = await t.order.findMany({ where: { id: { in: orderIds } }, orderBy: { orderedAt: "asc" }, select: { id: true, orderNo: true, confirmation: true, buyerId: true, buyer: { select: { name: true } } } });
  // 跟首頁、訂單列表、出貨頁同一套：整張可以出的才出
  const plan = await shipPlan(t);
  const ready = new Set(plan.readyOrderIds);
  const names = new Map((await t.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, productNameSnapshot: true } })).map((x) => [x.id, x.productNameSnapshot]));
  const groups = new Map<string, { buyerId: string; buyer: string; ok: { id: string; orderNo: string; qty: number }[]; skip: { id: string; orderNo: string; reason: string }[] }>();
  for (const o of orders) {
    const g = groups.get(o.buyerId) ?? { buyerId: o.buyerId, buyer: o.buyer.name, ok: [], skip: [] };
    groups.set(o.buyerId, g);
    if (o.confirmation !== "CONFIRMED") {
      g.skip.push({ id: o.id, orderNo: o.orderNo, reason: o.confirmation === "CANCELLED" ? "已取消" : "還沒確認" });
      continue;
    }
    const lines = plan.items.filter((i) => i.orderId === o.id);
    if (!lines.length) {
      g.skip.push({ id: o.id, orderNo: o.orderNo, reason: "沒有要出的" });
      continue;
    }
    if (ready.has(o.id)) g.ok.push({ id: o.id, orderNo: o.orderNo, qty: lines.reduce((a, l) => a + l.pending, 0) });
    else g.skip.push({ id: o.id, orderNo: o.orderNo, reason: lines.filter((l) => l.shippable < l.pending).map((l) => `${names.get(l.id) ?? ""}還差 ${l.pending - l.shippable} 件`).join("、") || "貨先排給比較早下單的" });
  }
  return [...groups.values()];
}

/** 多張訂單一次出貨：可以出的照客人併成一包（勾到的算備齊）；貨不夠的跳過 */
export async function bulkShip(t: Tx, actor: Actor, input: { orderIds: string[]; method?: string | null; shippedAt?: Date; dedupeKey: string }) {
  // 同一個識別碼已經出過（每位客人一包，識別碼＝「識別碼:客人」）：回傳那一次的結果，不再保留、不再扣庫存
  const done = async () => {
    const prev = await t.shipment.findMany({ where: { dedupeKey: { startsWith: `${input.dedupeKey}:` } }, include: { items: true } });
    return prev.length ? { buyers: prev.length, qty: prev.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0), skipped: [] as { id: string; orderNo: string; reason: string }[], duplicated: true } : null;
  };
  const before = await done();
  if (before) return before;
  await lockForShip(t, input.orderIds);
  const again = await done();
  if (again) return again;
  // 鎖住後才算排程（數量、保留、可用庫存都是最新的）
  const groups = await bulkShipPreview(t, input.orderIds);
  let buyers = 0;
  let qty = 0;
  const skipped = groups.flatMap((g) => g.skip);
  for (const g of groups) {
    if (!g.ok.length) continue;
    const key = `${input.dedupeKey}:${g.buyerId}`;
    if (await t.shipment.findUnique({ where: { dedupeKey: key } })) continue;
    const lines: { orderItemId: string; qty: number }[] = [];
    for (const o of g.ok) {
      // 照預覽的排程出；出貨時再確認一次（萬一同時有人動了庫存，保留不到就整筆擋下來，不會出一半）
      const st = await packState(t, o.id);
      for (const l of st) {
        if (!l.packed) await updateItem(t, actor, l.id, { packFlag: "READY" });
        const need = l.pending - l.reserved;
        if (need > 0) await reserveForItem(t, actor, { orderItemId: l.id, qty: need, owner: null }); // 共用庫存池，照批次進貨先後（FIFO）
        lines.push({ orderItemId: l.id, qty: l.pending });
      }
    }
    if (!lines.length) continue;
    await createShipment(t, actor, { buyerId: g.buyerId, method: input.method, shippedAt: input.shippedAt, items: lines, autoReserve: false, dedupeKey: key });
    buyers++;
    qty += lines.reduce((a, l) => a + l.qty, 0);
  }
  if (!buyers && !groups.some((g) => g.ok.length)) throw new BizError("勾的訂單都沒辦法出貨（貨不夠、已取消或沒有要出的）");
  return { buyers, qty, skipped, duplicated: false };
}

/** 多張訂單一次收款（看一下）：每張的待收；已付清、已取消的跳過 */
export async function bulkPayPreview(t: Tx, orderIds: string[]) {
  const orders = await t.order.findMany({ where: { id: { in: orderIds } }, orderBy: { orderedAt: "asc" }, select: { id: true, orderNo: true, confirmation: true, balanceCache: true, buyer: { select: { name: true } } } });
  return orders.map((o) => ({ id: o.id, orderNo: o.orderNo, buyer: o.buyer.name, amount: o.confirmation === "CANCELLED" ? 0 : o.balanceCache, reason: o.confirmation === "CANCELLED" ? "已取消" : o.balanceCache <= 0 ? "已付清" : null }));
}

/** 多張訂單一次收款：每張記一筆「待收」的金額 */
export async function bulkPay(t: Tx, actor: Actor, input: { orderIds: string[]; method?: string | null; paidAt?: Date; dedupeKey: string }) {
  let count = 0;
  let total = 0;
  for (const o of await t.order.findMany({ where: { id: { in: input.orderIds } }, select: { id: true } })) {
    const key = `${input.dedupeKey}:${o.id}`;
    if (await t.payment.findUnique({ where: { dedupeKey: key } })) continue;
    const r = await recomputeOrder(t, o.id);
    const ord = await t.order.findUniqueOrThrow({ where: { id: o.id }, select: { confirmation: true } });
    if (ord.confirmation === "CANCELLED" || r.balance <= 0) continue;
    await addPayment(t, actor, { orderId: o.id, amount: r.balance, paidAt: input.paidAt ?? new Date(), method: input.method ?? null, dedupeKey: key });
    count++;
    total += r.balance;
  }
  if (!count) throw new BizError("勾的訂單都不用收款（已付清或已取消）");
  return { count, total };
}

/**
 * 出貨排程（首頁待辦、訂單列表、出貨頁、採購團收貨提醒、一次出貨共用同一套）：
 * - 同一個商品的可賣庫存是一個共用池：不管是哪一團、誰的貨，都可以分給任何客人的訂單
 *   （訂單記的「跟誰訂的」照舊保留，給採購追蹤、成本與賺多少用，只是不再限制出貨用哪裡的貨）
 * - 可以用的貨＝已經保留給這一項的＋可用庫存（自留的不算、已經保留給別張單的不重複分）
 * - 先下單的先分：整張單都夠才算「整張可以出」，並先佔貨；不夠的單不佔，讓後面整張夠的先出
 * - 第二輪：剩下的貨再依下單順序分給不夠的單（出貨頁顯示實際可以先出幾件）
 * 實際出貨時保留照各批次進貨先後扣（FIFO），成本算法不變
 */
// 永遠用全部的訂單一起排（看某個人時只是把結果篩給他看），各頁才會一致
export async function shipPlan(t: Tx) {
  const items = await t.orderItem.findMany({
    where: { order: { confirmation: "CONFIRMED", statusCache: { notIn: ["COMPLETED", "CANCELLED"] } } },
    orderBy: [{ order: { orderedAt: "asc" } }, { order: { createdAt: "asc" } }, { createdAt: "asc" }],
    select: { id: true, orderId: true, productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true, ownerKey: true },
  });
  const open = items.map((i) => ({ ...i, pending: i.qty - i.cancelledQtyCache - i.shippedQtyCache, reserved: Math.min(i.reservedQtyCache, i.qty - i.cancelledQtyCache - i.shippedQtyCache) })).filter((i) => i.pending > 0);
  const byOrder = new Map<string, typeof open>();
  for (const i of open) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  // 每個商品的可用庫存：各批次「現有（自留已扣掉）－已保留」加總，跟實際保留時算的一樣（每批次不小於 0）
  const pool = new Map<string, number>();
  if (open.length) {
    const lots = await t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where: { productId: { in: [...new Set(open.map((i) => i.productId))] } }, _sum: { onHandDelta: true, reservedDelta: true } });
    for (const l of lots) pool.set(l.productId, (pool.get(l.productId) ?? 0) + Math.max(0, (l._sum.onHandDelta ?? 0) - (l._sum.reservedDelta ?? 0)));
  }
  const avail = (pid: string) => pool.get(pid) ?? 0;
  const take = (pid: string, n: number) => pool.set(pid, avail(pid) - n);
  const shippable = new Map<string, number>(); // 每一項現在可以出幾件
  for (const i of open) shippable.set(i.id, i.reserved);
  const ready: string[] = [];
  // 第一輪：整張都夠的單（依下單順序）
  for (const [orderId, lines] of byOrder) {
    const need = new Map<string, number>();
    for (const l of lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.pending - l.reserved);
    if (![...need.entries()].every(([pid, n]) => n <= avail(pid))) continue;
    for (const [pid, n] of need) take(pid, n);
    for (const l of lines) shippable.set(l.id, l.pending);
    ready.push(orderId);
  }
  // 第二輪：剩下的貨依下單順序分給還不夠的單（可以先出一部分）
  const readySet = new Set(ready);
  for (const i of open) {
    if (readySet.has(i.orderId)) continue;
    const extra = Math.min(i.pending - i.reserved, avail(i.productId));
    if (extra > 0) {
      take(i.productId, extra);
      shippable.set(i.id, i.reserved + extra);
    }
  }
  return { items: open.map((i) => ({ id: i.id, orderId: i.orderId, productId: i.productId, ownerKey: i.ownerKey, pending: i.pending, reserved: i.reserved, shippable: shippable.get(i.id) ?? 0 })), readyOrderIds: ready };
}

/** 到貨了整張可以出貨的訂單（shipPlan 第一輪）；productIds：只看跟這些商品有關的訂單 */
export async function readyToShip(t: Tx, opts: { owner?: string | null; productIds?: string[] } = {}) {
  const plan = await shipPlan(t);
  const want = opts.productIds ? new Set(opts.productIds) : null;
  const keys = opts.owner ? [opts.owner, "joint", "none"] : null;
  const ready = new Set(plan.readyOrderIds);
  // 看某個人：跟訂單列表一樣，有一項是跟他訂的（或合資、未指定）就列
  const orderIds = plan.readyOrderIds.filter((id) => plan.items.some((i) => i.orderId === id && (!want || want.has(i.productId)) && (!keys || (!!i.ownerKey && keys.includes(i.ownerKey)))));
  const keep = new Set(orderIds);
  return { orderIds, qty: plan.items.filter((i) => ready.has(i.orderId) && keep.has(i.orderId)).reduce((a, i) => a + i.pending, 0) };
}
