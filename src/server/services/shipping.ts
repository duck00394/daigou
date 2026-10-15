// 出貨服務：支援部分出貨；出貨數量一律從保留中扣除，並同時扣實際在庫。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { itemReservations, reserveForItem } from "./inventory";
import { recomputeOrder } from "./recompute";

export interface ShipInput {
  buyerId: string;
  method?: string | null;
  trackingNo?: string | null;
  shippedAt?: Date;
  note?: string | null;
  items: { orderItemId: string; qty: number }[];
  autoReserve?: boolean; // 保留不足時，自動從可用庫存保留
  dedupeKey?: string;
}

export async function createShipment(t: Tx, actor: Actor, input: ShipInput) {
  if (input.dedupeKey) {
    const dup = await t.shipment.findUnique({ where: { dedupeKey: input.dedupeKey }, include: { items: true } });
    if (dup) return { shipment: dup, duplicated: true };
  }
  const lines = input.items.filter((i) => i.qty > 0);
  if (lines.length === 0) throw new BizError("請至少選擇一項要出貨的商品");
  if (new Set(lines.map((l) => l.orderItemId)).size !== lines.length) throw new BizError("同一明細不可重複出現");
  for (const l of lines) if (!Number.isInteger(l.qty)) throw new BizError("出貨數量必須是整數");

  const items = await t.orderItem.findMany({
    where: { id: { in: lines.map((l) => l.orderItemId) } },
    include: { order: { select: { id: true, buyerId: true, orderNo: true, confirmation: true } } },
  });
  if (items.length !== lines.length) throw new BizError("找不到部分訂單明細");
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await lockRows(t, "Order", orderIds);
  await lockRows(t, "Product", items.map((i) => i.productId));

  for (const it of items) {
    if (it.order.buyerId !== input.buyerId) throw new BizError(`訂單 ${it.order.orderNo} 不屬於這位買家`);
    if (it.order.confirmation !== "CONFIRMED") throw new BizError(`訂單 ${it.order.orderNo} 不是已確認狀態`);
  }

  const shipment = await t.shipment.create({
    data: {
      shipmentNo: await nextCode(t, "shipment"),
      buyerId: input.buyerId,
      method: emptyToNull(input.method ?? null),
      trackingNo: emptyToNull(input.trackingNo ?? null),
      shippedAt: input.shippedAt ?? new Date(),
      note: emptyToNull(input.note ?? null),
      dedupeKey: input.dedupeKey,
    },
  });

  for (const line of lines) {
    const it = items.find((i) => i.id === line.orderItemId)!;
    const fresh = await t.orderItem.findUniqueOrThrow({
      where: { id: it.id },
      include: { cancellations: { select: { qty: true } }, shipmentItems: { select: { qty: true } } },
    });
    const active = fresh.qty - fresh.cancellations.reduce((s, c) => s + c.qty, 0);
    const shipped = fresh.shipmentItems.reduce((s, x) => s + x.qty, 0);
    if (line.qty > active - shipped) throw new BizError(`「${it.productNameSnapshot}」（${it.order.orderNo}）最多只能再出貨 ${active - shipped} 件`);
    let groups = await itemReservations(t, it.id);
    let reserved = groups.reduce((s, g) => s + g.qty, 0);
    if (reserved < line.qty) {
      if (!input.autoReserve) throw new BizError(`「${it.productNameSnapshot}」只保留了 ${reserved} 件，請先登記到貨或保留庫存`);
      await reserveForItem(t, actor, { orderItemId: it.id, qty: line.qty - reserved });
      groups = await itemReservations(t, it.id);
      reserved = groups.reduce((s, g) => s + g.qty, 0);
    }
    const si = await t.shipmentItem.create({ data: { shipmentId: shipment.id, orderItemId: it.id, qty: line.qty } });
    let left = line.qty;
    for (const g of groups) {
      if (left <= 0) break;
      const take = Math.min(left, g.qty);
      await t.inventoryMovement.create({
        data: {
          productId: it.productId,
          kind: "SHIP",
          onHandDelta: -take,
          reservedDelta: -take,
          orderItemId: it.id,
          purchaseBatchItemId: g.batchItemId,
          unitCostTwd: g.unitCostTwd,
          shipmentItemId: si.id,
          reason: `出貨 ${shipment.shipmentNo}`,
          actorId: actor.userId,
        },
      });
      left -= take;
    }
    await t.orderItemEvent.create({ data: { orderItemId: it.id, type: "SHIPPED", qtyDelta: line.qty, note: shipment.shipmentNo, actorId: actor.userId } });
  }
  for (const id of orderIds) await recomputeOrder(t, id);
  await audit(t, actor, "shipment.create", "Shipment", shipment.id, { lines });
  return { shipment: await t.shipment.findUniqueOrThrow({ where: { id: shipment.id }, include: { items: true } }), duplicated: false };
}

export async function updateShipment(
  t: Tx,
  actor: Actor,
  shipmentId: string,
  input: { method?: string | null; trackingNo?: string | null; note?: string | null; delivered?: boolean },
) {
  const s = await t.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { items: { include: { orderItem: true } } } });
  await t.shipment.update({
    where: { id: shipmentId },
    data: {
      method: input.method !== undefined ? emptyToNull(input.method) : undefined,
      trackingNo: input.trackingNo !== undefined ? emptyToNull(input.trackingNo) : undefined,
      note: input.note !== undefined ? emptyToNull(input.note) : undefined,
      status: input.delivered === undefined ? undefined : input.delivered ? "DELIVERED" : "SHIPPED",
      deliveredAt: input.delivered === undefined ? undefined : input.delivered ? new Date() : null,
    },
  });
  for (const id of new Set(s.items.map((i) => i.orderItem.orderId))) await recomputeOrder(t, id);
  await audit(t, actor, "shipment.update", "Shipment", shipmentId, input);
}
