// 改出貨人（扣誰的庫存）：客人預訂的商品，保留或已經出貨的那幾件換成扣另一個人的貨。
// - 已保留還沒出：取消不是這個人的保留，改從這個人的可用庫存保留同樣件數。
// - 已經出貨：同一張出貨單上，把不是這個人的那幾件退回原本的批次，再從這個人的可用庫存扣同樣件數。
//   出貨單件數、訂單、收款都不變；成本與「誰賺多少」照新扣到的批次重新算。
// 這個人的可用庫存不夠就整筆擋下來，什麼都不改。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import { itemReservations, ownerName, productLots, reserveForItem, unreserveForItem } from "./inventory";
import { filterLotsByOwner, lotOwners, ownerOfLot } from "./ownership";
import { recomputeOrder } from "./recompute";

/** 已保留還沒出貨的部分換成扣 owner 的；回傳換了幾件 */
export async function switchReservedOwner(t: Tx, actor: Actor, orderItemId: string, owner: string) {
  const it = await t.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, select: { productId: true, productNameSnapshot: true } });
  await lockRows(t, "Product", [it.productId]);
  const groups = await itemReservations(t, orderItemId);
  const owners = await lotOwners(t, groups.map((g) => g.batchItemId));
  const qty = groups.filter((g) => ownerOfLot(owners, g.batchItemId) !== owner).reduce((s, g) => s + g.qty, 0);
  if (qty <= 0) return 0;
  const free = (await filterLotsByOwner(t, await productLots(t, it.productId), owner)).reduce((s, l) => s + Math.max(0, l.free), 0);
  if (free < qty) throw new BizError(`「${it.productNameSnapshot}」${await ownerName(t, owner)}的可用庫存只有 ${free} 件，不夠換 ${qty} 件`);
  // 先全部取消再重新保留：保留是後進先出取消，所以把整筆取消、先保留這個人的，原本就是他的部分也會留在他身上
  const total = groups.reduce((s, g) => s + g.qty, 0);
  await unreserveForItem(t, actor, { orderItemId, qty: total, reason: `改成${await ownerName(t, owner)}出貨` });
  await reserveForItem(t, actor, { orderItemId, qty: total, owner });
  return qty;
}

/** 已經出貨的這張出貨單：換成扣 owner 的；回傳換了幾件 */
export async function switchShipmentOwner(t: Tx, actor: Actor, shipmentId: string, owner: string) {
  const sh = await t.shipment.findUnique({ where: { id: shipmentId }, include: { items: { include: { orderItem: { select: { id: true, orderId: true, productId: true, productNameSnapshot: true } } } } } });
  if (!sh) throw new BizError("找不到這張出貨單");
  const items = sh.items.filter((i) => i.qty > 0);
  if (!items.length) throw new BizError("這張出貨單沒有可以換的商品（可能是作廢退回）");
  const returned = await t.shipmentItem.count({ where: { orderItemId: { in: items.map((i) => i.orderItem.id) }, qty: { lt: 0 } } });
  if (returned) throw new BizError("這筆已經作廢或退回過，不能改出貨人");
  await lockRows(t, "Order", [...new Set(items.map((i) => i.orderItem.orderId))]);
  await lockRows(t, "Product", [...new Set(items.map((i) => i.orderItem.productId))]);
  const name = await ownerName(t, owner);
  let moved = 0;
  for (const si of items) {
    const moves = await t.inventoryMovement.findMany({ where: { kind: "SHIP", shipmentItemId: si.id }, orderBy: { createdAt: "asc" } });
    // 這張出貨單每個批次淨出了幾件
    const per = new Map<string, { lot: string | null; cost: number | null; qty: number }>();
    for (const m of moves) {
      const k = `${m.purchaseBatchItemId ?? ""}|${m.purchaseBatchItemId ? "" : (m.unitCostTwd ?? "")}`;
      const v = per.get(k) ?? { lot: m.purchaseBatchItemId, cost: m.purchaseBatchItemId ? null : m.unitCostTwd, qty: 0 };
      v.qty -= m.onHandDelta;
      per.set(k, v);
    }
    const owners = await lotOwners(t, [...per.values()].map((v) => v.lot));
    const wrong = [...per.values()].filter((v) => v.qty > 0 && ownerOfLot(owners, v.lot) !== owner);
    const qty = wrong.reduce((s, v) => s + v.qty, 0);
    if (qty <= 0) continue;
    const lots = await filterLotsByOwner(t, await productLots(t, si.orderItem.productId), owner);
    const free = lots.reduce((s, l) => s + Math.max(0, l.free), 0);
    if (free < qty) throw new BizError(`「${si.orderItem.productNameSnapshot}」${name}的可用庫存只有 ${free} 件，不夠換 ${qty} 件`);
    const base = { productId: si.orderItem.productId, kind: "SHIP" as const, reservedDelta: 0, orderItemId: si.orderItem.id, shipmentItemId: si.id, actorId: actor.userId };
    for (const v of wrong) {
      await t.inventoryMovement.create({ data: { ...base, onHandDelta: v.qty, purchaseBatchItemId: v.lot, unitCostTwd: v.cost, reason: `改成${name}出貨：退回 ${sh.shipmentNo}` } });
    }
    let left = qty;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, lot.free));
      if (take <= 0) continue;
      await t.inventoryMovement.create({ data: { ...base, onHandDelta: -take, purchaseBatchItemId: lot.batchItemId, unitCostTwd: lot.batchItemId ? null : lot.unitCostTwd, reason: `改成${name}出貨 ${sh.shipmentNo}` } });
      left -= take;
    }
    moved += qty;
  }
  for (const id of new Set(items.map((i) => i.orderItem.orderId))) await recomputeOrder(t, id);
  await audit(t, actor, "shipment.changeOwner", "Shipment", shipmentId, { owner, moved });
  return { moved, name };
}

/** 每張出貨單、每個待出貨明細現在扣的是誰的（顯示用） */
export async function shipOwnerLabels(t: Tx, opts: { shipmentItemIds?: string[]; orderItemIds?: string[] }) {
  const where = opts.shipmentItemIds ? { kind: "SHIP" as const, shipmentItemId: { in: opts.shipmentItemIds } } : { orderItemId: { in: opts.orderItemIds ?? [] } };
  const moves = await t.inventoryMovement.findMany({ where, select: { shipmentItemId: true, orderItemId: true, purchaseBatchItemId: true, onHandDelta: true, reservedDelta: true } });
  const owners = await lotOwners(t, moves.map((m) => m.purchaseBatchItemId));
  const out = new Map<string, Map<string, number>>();
  for (const m of moves) {
    const id = opts.shipmentItemIds ? m.shipmentItemId! : m.orderItemId!;
    const q = opts.shipmentItemIds ? -m.onHandDelta : m.reservedDelta; // 出貨單看出了幾件；待出貨看保留了幾件
    const k = ownerOfLot(owners, m.purchaseBatchItemId);
    const per = out.get(id) ?? new Map<string, number>();
    per.set(k, (per.get(k) ?? 0) + q);
    out.set(id, per);
  }
  return out;
}
