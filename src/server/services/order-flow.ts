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
