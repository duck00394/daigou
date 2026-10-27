// 「現在看誰的」：只算這個人的（＋合資、未指定的）。別人的團、貨、預訂都不算。
// owner 空白＝全部（兩個人加起來）。
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/server/db";
import { inventorySummary } from "./inventory";
import { stockByOwner } from "./ownership";

export const mineKeys = (owner: string | null | undefined) => (owner ? [owner, "joint", "none"] : null);

/** 這個人的團（＋合資、未指定的團） */
export function mineBatchWhere(owner: string | null | undefined): Prisma.PurchaseBatchWhereInput {
  return owner ? { OR: [{ ownership: "JOINT" }, { orderedById: null }, { ownership: "PERSONAL", orderedById: owner }] } : {};
}

/** 跟這個人訂的訂單明細 */
export function mineItemWhere(owner: string | null | undefined): Prisma.OrderItemWhereInput {
  const k = mineKeys(owner);
  return k ? { ownerKey: { in: k } } : {};
}

/** 跟 inventorySummary 一樣的數字，但只算這個人的 */
export async function inventoryFor(t: Tx, productIds: string[], owner: string | null | undefined) {
  const inv = await inventorySummary(t, productIds);
  const keys = mineKeys(owner);
  if (!keys || !productIds.length) return inv;
  const [by, batchItems, demand] = await Promise.all([
    stockByOwner(t, { productIds }),
    t.purchaseBatchItem.findMany({
      where: { productId: { in: productIds }, batch: { status: { notIn: ["CANCELLED", "DRAFT"] }, ...mineBatchWhere(owner) } },
      select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    }),
    t.orderItem.findMany({ where: { productId: { in: productIds }, order: { confirmation: "CONFIRMED" }, ...mineItemWhere(owner) }, select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true } }),
  ]);
  const out = new Map<string, ReturnType<typeof inv.get> & object>();
  for (const id of productIds) {
    const all = inv.get(id);
    const v = { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: all?.shipped ?? 0, kept: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };
    for (const k of keys) {
      const x = by.get(id)?.get(k);
      if (!x) continue;
      v.onHand += x.onHand;
      v.reserved += x.reserved;
      v.kept += x.kept;
      v.available += x.free;
    }
    out.set(id, v);
  }
  for (const b of batchItems) {
    const v = out.get(b.productId);
    if (v) v.incoming += Math.max(0, b.qty - b.cancelledQty - b.movements.reduce((a, m) => a + m.onHandDelta, 0));
  }
  for (const d of demand) {
    const v = out.get(d.productId);
    if (!v) continue;
    const active = d.qty - d.cancelledQtyCache;
    const open = Math.max(0, active - d.shippedQtyCache);
    v.activeOrdered += active;
    v.openDemand += open;
    v.unallocated += Math.max(0, open - d.reservedQtyCache);
  }
  for (const v of out.values()) v.shortage = Math.max(0, v.unallocated - Math.max(0, v.available) - v.incoming);
  return out;
}
