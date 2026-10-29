// 庫存頁「庫存」欄的算法（庫存頁和首頁待辦共用同一套，不另外算）：
// 庫存＝現有（不含自留）＋一定到（對單買到、還沒到）－客人預訂還沒給；不一定到的（還在等代購確認）不算
// 看某個人：只算他的團＋合資、未指定的團，客人訂只算跟他訂的（＋合資、未指定）
import type { Tx } from "@/server/db";
import { mineBatchWhere } from "./mine";
import { inventorySummary } from "./inventory";
import { JOINT, NONE, stockByOwner } from "./ownership";
import { openDemandRows } from "./demand-owner";
import { pendingQty } from "./batch-ops";

export type StockS = { onHand: number; reserved: number; available: number; incoming: number; shipped: number; kept: number; activeOrdered: number; openDemand: number; unallocated: number; shortage: number };
const ZERO: StockS = { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, kept: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };

export async function stockLeft(t: Tx, ids: string[], owner: string | null) {
  const [inv, byOwner, demandAll] = await Promise.all([inventorySummary(t, ids), stockByOwner(t, { productIds: ids }), openDemandRows(t, ids)]);
  const ownerKeys = owner ? [owner, JOINT, NONE] : [];
  const ownerIncoming = new Map<string, number>();
  if (owner) {
    const items = await t.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, ...mineBatchWhere(owner) } },
      select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    for (const i of items) ownerIncoming.set(i.productId, (ownerIncoming.get(i.productId) ?? 0) + Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  // 不一定到：對單還在待確認的
  const unsureMap = new Map<string, number>();
  {
    const items = await t.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, ...mineBatchWhere(owner) } },
      select: { qty: true, cancelledQty: true, confirmedQty: true, productId: true, batch: { select: { status: true, supplierRef: { select: { kind: true } } } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    for (const i of items) unsureMap.set(i.productId, (unsureMap.get(i.productId) ?? 0) + pendingQty(i, i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  const out = new Map<string, { s: StockS; unsure: number; left: number }>();
  for (const id of ids) {
    const all = inv.get(id) ?? ZERO;
    let s: StockS = all;
    if (owner) {
      const mine = ownerKeys.map((k) => byOwner.get(id)?.get(k)).reduce<{ onHand: number; free: number; reserved: number; kept: number }>((a, x) => ({ onHand: a.onHand + (x?.onHand ?? 0), free: a.free + (x?.free ?? 0), reserved: a.reserved + (x?.reserved ?? 0), kept: a.kept + (x?.kept ?? 0) }), { onHand: 0, free: 0, reserved: 0, kept: 0 });
      const openDemand = (demandAll.get(id) ?? []).filter((d) => d.ownerKey && ownerKeys.includes(d.ownerKey)).reduce((a, d) => a + d.qty, 0);
      s = { ...all, onHand: mine.onHand, available: mine.free, reserved: mine.reserved, kept: mine.kept, incoming: ownerIncoming.get(id) ?? 0, openDemand };
    }
    const unsure = Math.min(s.incoming, unsureMap.get(id) ?? 0);
    out.set(id, { s, unsure, left: s.onHand + s.incoming - unsure - s.openDemand });
  }
  return { byProduct: out, byOwner, demandAll };
}

/** 首頁待辦：客人預訂超過庫存（庫存欄變負的）的商品；只看有客人預訂還沒給的商品 */
export async function shortProducts(t: Tx, owner: string | null) {
  const items = await t.orderItem.findMany({
    // 已完成（全部出貨、收齊）和已取消的訂單不會有還沒給的，先在資料庫篩掉
    where: { order: { confirmation: "CONFIRMED", statusCache: { notIn: ["COMPLETED", "CANCELLED"] } } },
    select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true },
  });
  const ids = [...new Set(items.filter((i) => i.qty - i.cancelledQtyCache - i.shippedQtyCache > 0).map((i) => i.productId))];
  if (!ids.length) return [];
  const live = await t.product.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
  const { byProduct } = await stockLeft(t, live.map((p) => p.id), owner);
  return [...byProduct.entries()].filter(([, x]) => x.left < 0).map(([id, x]) => ({ productId: id, short: -x.left }));
}

