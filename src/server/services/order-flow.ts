// 訂單頁的三步：備齊（勾）→ 出貨（整張單還沒出的一次出）→ 客人取貨（可一起記收款）
import { BizError, type Tx } from "@/server/db";
import type { Actor } from "./common";
import { updateItem } from "./orders";
import { reserveForItem } from "./inventory";
import { stockByOwner } from "./ownership";
import { createShipment } from "./shipping";
import { addPayment } from "./payments";
import { recomputeOrder } from "./recompute";
import { audit } from "./common";

type Line = { id: string; productId: string; name: string; pending: number; reserved: number; ownerKey: string | null; packed: boolean };

/** 這張單還沒出貨的明細，以及每一項現在能不能備齊（保留＋這個人的可用庫存夠不夠） */
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
  // 同一商品出現在好幾列：可用庫存依序分，不重複算
  const used = new Map<string, number>();
  return lines.map((l) => {
    const m = byOwner.get(l.productId);
    const key = `${l.productId}|${l.ownerKey ?? ""}`;
    const free = l.ownerKey ? (m?.get(l.ownerKey as never)?.free ?? 0) : [...(m?.values() ?? [])].reduce((a, x) => a + x.free, 0);
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

/** 整張單還沒出的一次出貨：先從各自跟誰訂的庫存保留，再建出貨 */
export async function shipOrder(t: Tx, actor: Actor, input: { orderId: string; method?: string | null; trackingNo?: string | null; shippedAt?: Date; dedupeKey: string }) {
  const dup = await t.shipment.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (dup) return { shipmentNo: dup.shipmentNo, duplicated: true, count: 0 };
  const order = await t.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { buyerId: true, confirmation: true } });
  if (order.confirmation !== "CONFIRMED") throw new BizError("這張單不是已確認，不能出貨");
  const st = await packState(t, input.orderId);
  if (!st.length) throw new BizError("這張單沒有要出貨的商品");
  const notPacked = st.filter((l) => !l.packed);
  if (notPacked.length) throw new BizError(`還有 ${notPacked.length} 項沒勾備齊：${notPacked.map((l) => l.name).join("、")}`);
  for (const l of st) {
    const need = l.pending - l.reserved;
    if (need > 0) await reserveForItem(t, actor, { orderItemId: l.id, qty: need, owner: l.ownerKey });
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
  const groups = new Map<string, { buyerId: string; buyer: string; ok: { id: string; orderNo: string; qty: number }[]; skip: { id: string; orderNo: string; reason: string }[] }>();
  for (const o of orders) {
    const g = groups.get(o.buyerId) ?? { buyerId: o.buyerId, buyer: o.buyer.name, ok: [], skip: [] };
    groups.set(o.buyerId, g);
    if (o.confirmation !== "CONFIRMED") {
      g.skip.push({ id: o.id, orderNo: o.orderNo, reason: o.confirmation === "CANCELLED" ? "已取消" : "還沒確認" });
      continue;
    }
    const st = await packState(t, o.id);
    if (!st.length) {
      g.skip.push({ id: o.id, orderNo: o.orderNo, reason: "沒有要出的" });
      continue;
    }
    const short = st.filter((l) => !l.canPack);
    if (short.length) g.skip.push({ id: o.id, orderNo: o.orderNo, reason: short.map((l) => `${l.name}還差 ${l.short} 件`).join("、") });
    else g.ok.push({ id: o.id, orderNo: o.orderNo, qty: st.reduce((a, l) => a + l.pending, 0) });
  }
  return [...groups.values()];
}

/** 多張訂單一次出貨：可以出的照客人併成一包（勾到的算備齊）；貨不夠的跳過 */
export async function bulkShip(t: Tx, actor: Actor, input: { orderIds: string[]; method?: string | null; shippedAt?: Date; dedupeKey: string }) {
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
      // 前面的單已經用掉貨了：再看一次，不夠的這張先不出
      const st = await packState(t, o.id);
      const short = st.filter((l) => !l.canPack);
      if (short.length) {
        skipped.push({ id: o.id, orderNo: o.orderNo, reason: short.map((l) => `${l.name}還差 ${l.short} 件`).join("、") });
        continue;
      }
      for (const l of st) {
        if (!l.packed) await updateItem(t, actor, l.id, { packFlag: "READY" });
        const need = l.pending - l.reserved;
        if (need > 0) await reserveForItem(t, actor, { orderItemId: l.id, qty: need, owner: l.ownerKey });
        lines.push({ orderItemId: l.id, qty: l.pending });
      }
    }
    if (!lines.length) continue;
    await createShipment(t, actor, { buyerId: g.buyerId, method: input.method, shippedAt: input.shippedAt, items: lines, autoReserve: false, dedupeKey: key });
    buyers++;
    qty += lines.reduce((a, l) => a + l.qty, 0);
  }
  if (!buyers && !groups.some((g) => g.ok.length)) throw new BizError("勾的訂單都沒辦法出貨（貨不夠、已取消或沒有要出的）");
  return { buyers, qty, skipped };
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
 * 到貨了可以出貨的訂單：每一項還沒給的都有貨（已保留＋跟誰訂的那個人的可用庫存；先下單的先分）。
 * 首頁待辦、訂單列表「到貨可出貨」、採購團收貨後的提醒都用這一套，跟一次出貨的判斷一致。
 * owner：看某個人時只算跟他訂的（＋合資、未指定）；productIds：只看跟這些商品有關的訂單
 */
export async function readyToShip(t: Tx, opts: { owner?: string | null; productIds?: string[] } = {}) {
  const items = await t.orderItem.findMany({
    where: {
      order: { confirmation: "CONFIRMED", statusCache: { notIn: ["COMPLETED", "CANCELLED"] } },
      ...(opts.owner ? { ownerKey: { in: [opts.owner, "joint", "none"] } } : {}),
    },
    orderBy: [{ order: { orderedAt: "asc" } }, { createdAt: "asc" }],
    select: { id: true, orderId: true, productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true, ownerKey: true },
  });
  const open = items.map((i) => ({ ...i, pending: i.qty - i.cancelledQtyCache - i.shippedQtyCache })).filter((i) => i.pending > 0);
  if (!open.length) return { orderIds: [] as string[], qty: 0 };
  const byOrder = new Map<string, typeof open>();
  for (const i of open) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  const stock = await stockByOwner(t, { productIds: [...new Set(open.map((i) => i.productId))] });
  const used = new Map<string, number>();
  const freeOf = (productId: string, owner: string | null) => {
    const m = stock.get(productId);
    if (!m) return 0;
    return owner ? (m.get(owner)?.free ?? 0) : [...m.values()].reduce((a, x) => a + x.free, 0);
  };
  const want = opts.productIds ? new Set(opts.productIds) : null;
  const orderIds: string[] = [];
  let qty = 0;
  for (const [orderId, lines] of byOrder) {
    // 先看這張單全部都夠不夠；夠才算可以出貨、才佔用庫存（不夠的不佔，讓後面的單先出）
    const need = new Map<string, number>();
    for (const l of lines) {
      const k = `${l.productId}|${l.ownerKey ?? ""}`;
      need.set(k, (need.get(k) ?? 0) + Math.max(0, l.pending - l.reservedQtyCache));
    }
    const ok = [...need.entries()].every(([k, n]) => {
      const [p, o] = k.split("|");
      return n <= freeOf(p, o || null) - (used.get(k) ?? 0);
    });
    if (!ok) continue;
    for (const [k, n] of need) used.set(k, (used.get(k) ?? 0) + n);
    if (want && !lines.some((l) => want.has(l.productId))) continue;
    orderIds.push(orderId);
    qty += lines.reduce((a, l) => a + l.pending, 0);
  }
  return { orderIds, qty };
}
