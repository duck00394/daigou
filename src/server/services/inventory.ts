// 庫存流水服務。
// 規則（詳見 docs/計算口徑.md）：
//   實際在庫 = Σ onHandDelta（到貨 +、盤點 ±、出貨 −）
//   保留     = Σ reservedDelta（保留 +、取消保留 −、出貨 −）
//   可用庫存 = 實際在庫 − 保留
// 「批次」(lot)：每筆到貨都記錄來源採購明細（purchaseBatchItemId）；手動入庫歸入「手動池」（null）。
// 保留與出貨都會沿用同一個 lot，讓銷貨成本可以追溯到實際採購批次。
import { BizError, lockRows, type Tx } from "@/server/db";
import { divRound } from "@/lib/money";
import { audit, type Actor } from "./common";
import { recomputeOrder } from "./recompute";

export interface Lot {
  batchItemId: string | null;
  unitCostTwd: number | null; // 手動池的加權平均成本
  onHand: number;
  reserved: number;
  free: number;
  receivedAt: Date;
}

export async function productStock(t: Tx, productId: string) {
  const agg = await t.inventoryMovement.aggregate({
    where: { productId },
    _sum: { onHandDelta: true, reservedDelta: true },
  });
  const onHand = agg._sum.onHandDelta ?? 0;
  const reserved = agg._sum.reservedDelta ?? 0;
  return { onHand, reserved, available: onHand - reserved };
}

/** 取得商品各 lot 的在庫與保留狀況（先進先出排序） */
export async function productLots(t: Tx, productId: string): Promise<Lot[]> {
  const moves = await t.inventoryMovement.findMany({
    where: { productId },
    select: { purchaseBatchItemId: true, onHandDelta: true, reservedDelta: true, unitCostTwd: true, kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const lots = new Map<string, Lot & { costQty: number; costSum: number }>();
  for (const m of moves) {
    const key = m.purchaseBatchItemId ?? "__manual__";
    let lot = lots.get(key);
    if (!lot) {
      lot = { batchItemId: m.purchaseBatchItemId, unitCostTwd: null, onHand: 0, reserved: 0, free: 0, receivedAt: m.createdAt, costQty: 0, costSum: 0 };
      lots.set(key, lot);
    }
    lot.onHand += m.onHandDelta;
    lot.reserved += m.reservedDelta;
    if (!m.purchaseBatchItemId && m.onHandDelta > 0 && m.unitCostTwd !== null) {
      lot.costQty += m.onHandDelta;
      lot.costSum += m.onHandDelta * m.unitCostTwd;
    }
  }
  return [...lots.values()]
    .map((l) => ({
      batchItemId: l.batchItemId,
      unitCostTwd: l.batchItemId ? null : l.costQty > 0 ? divRound(l.costSum, l.costQty) : null,
      onHand: l.onHand,
      reserved: l.reserved,
      free: l.onHand - l.reserved,
      receivedAt: l.receivedAt,
    }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

/** 明細目前的保留，依 lot 分組 */
export async function itemReservations(t: Tx, orderItemId: string) {
  const moves = await t.inventoryMovement.findMany({
    where: { orderItemId },
    select: { purchaseBatchItemId: true, unitCostTwd: true, reservedDelta: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const groups = new Map<string, { batchItemId: string | null; unitCostTwd: number | null; qty: number; first: Date }>();
  for (const m of moves) {
    const key = `${m.purchaseBatchItemId ?? ""}|${m.purchaseBatchItemId ? "" : (m.unitCostTwd ?? "")}`;
    const g = groups.get(key) ?? { batchItemId: m.purchaseBatchItemId, unitCostTwd: m.purchaseBatchItemId ? null : m.unitCostTwd, qty: 0, first: m.createdAt };
    g.qty += m.reservedDelta;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.qty > 0).sort((a, b) => a.first.getTime() - b.first.getTime());
}

async function itemNeed(t: Tx, orderItemId: string) {
  const it = await t.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    include: {
      order: { select: { confirmation: true, orderNo: true } },
      cancellations: { select: { qty: true } },
      shipmentItems: { select: { qty: true } },
      movements: { select: { reservedDelta: true } },
    },
  });
  const active = it.qty - it.cancellations.reduce((s, c) => s + c.qty, 0);
  const shipped = it.shipmentItems.reduce((s, x) => s + x.qty, 0);
  const reserved = it.movements.reduce((s, m) => s + m.reservedDelta, 0);
  return { item: it, active, shipped, reserved, need: Math.max(0, active - shipped - reserved) };
}

/** 到貨入庫（可指定採購明細） */
export async function receiveStock(
  t: Tx,
  actor: Actor,
  input: { productId: string; qty: number; batchItemId?: string | null; unitCostTwd?: number | null; reason?: string | null; dedupeKey?: string },
) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BizError("到貨數量必須是正整數");
  if (input.dedupeKey) {
    const dup = await t.inventoryMovement.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (dup) return { movement: dup, duplicated: true };
  }
  await lockRows(t, "Product", [input.productId]);
  if (input.batchItemId) {
    const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: input.batchItemId }, include: { batch: true } });
    if (bi.productId !== input.productId) throw new BizError("採購明細與商品不符");
    if (bi.batch.status === "CANCELLED") throw new BizError("採購批次已取消");
    const received = await t.inventoryMovement.aggregate({
      where: { purchaseBatchItemId: bi.id, kind: "RECEIVE" },
      _sum: { onHandDelta: true },
    });
    const remaining = bi.qty - bi.cancelledQty - (received._sum.onHandDelta ?? 0);
    if (input.qty > remaining) throw new BizError(`到貨數量超過採購未到數量（尚未到貨 ${remaining} 件）`);
  }
  const movement = await t.inventoryMovement.create({
    data: {
      productId: input.productId,
      kind: "RECEIVE",
      onHandDelta: input.qty,
      purchaseBatchItemId: input.batchItemId ?? null,
      unitCostTwd: input.batchItemId ? null : (input.unitCostTwd ?? null),
      reason: input.reason ?? (input.batchItemId ? "採購到貨" : "手動入庫"),
      dedupeKey: input.dedupeKey,
      actorId: actor.userId,
    },
  });
  await t.product.updateMany({ where: { id: input.productId, actualArrivalDate: null }, data: { actualArrivalDate: new Date() } });
  if (input.batchItemId) await refreshBatchStatus(t, input.batchItemId);
  await audit(t, actor, "inventory.receive", "Product", input.productId, { qty: input.qty, batchItemId: input.batchItemId });
  return { movement, duplicated: false };
}

async function refreshBatchStatus(t: Tx, batchItemId: string) {
  const bi = await t.purchaseBatchItem.findUniqueOrThrow({ where: { id: batchItemId }, select: { batchId: true } });
  const items = await t.purchaseBatchItem.findMany({
    where: { batchId: bi.batchId },
    include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  let ordered = 0;
  let received = 0;
  for (const it of items) {
    ordered += it.qty - it.cancelledQty;
    received += it.movements.reduce((s, m) => s + m.onHandDelta, 0);
  }
  const batch = await t.purchaseBatch.findUniqueOrThrow({ where: { id: bi.batchId } });
  if (batch.status === "CANCELLED" || batch.status === "DRAFT") return;
  const status = received <= 0 ? "ORDERED" : received >= ordered ? "RECEIVED" : "PARTIAL_RECEIVED";
  if (status !== batch.status) await t.purchaseBatch.update({ where: { id: batch.id }, data: { status } });
}

/** 盤點調整：正數入手動池；負數依先進先出從可用的 lot 扣除 */
export async function adjustStock(t: Tx, actor: Actor, input: { productId: string; delta: number; reason: string; unitCostTwd?: number | null; dedupeKey?: string }) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new BizError("調整數量必須是非 0 整數");
  if (!input.reason?.trim()) throw new BizError("請填寫調整原因");
  if (input.dedupeKey) {
    const dup = await t.inventoryMovement.findFirst({ where: { dedupeKey: { startsWith: input.dedupeKey } } });
    if (dup) return { duplicated: true };
  }
  await lockRows(t, "Product", [input.productId]);
  if (input.delta > 0) {
    await t.inventoryMovement.create({
      data: {
        productId: input.productId,
        kind: "ADJUST",
        onHandDelta: input.delta,
        unitCostTwd: input.unitCostTwd ?? null,
        reason: input.reason,
        dedupeKey: input.dedupeKey,
        actorId: actor.userId,
      },
    });
  } else {
    let left = -input.delta;
    const lots = await productLots(t, input.productId);
    const free = lots.reduce((s, l) => s + Math.max(0, l.free), 0);
    if (free < left) throw new BizError(`可用庫存只有 ${free} 件，不能扣除 ${left} 件（已保留給訂單的數量需先取消保留）`);
    let n = 0;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, lot.free));
      if (take <= 0) continue;
      await t.inventoryMovement.create({
        data: {
          productId: input.productId,
          kind: "ADJUST",
          onHandDelta: -take,
          purchaseBatchItemId: lot.batchItemId,
          unitCostTwd: lot.batchItemId ? null : lot.unitCostTwd,
          reason: input.reason,
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}#${n++}` : undefined,
          actorId: actor.userId,
        },
      });
      left -= take;
    }
  }
  await audit(t, actor, "inventory.adjust", "Product", input.productId, { delta: input.delta, reason: input.reason });
  return { duplicated: false };
}

/**
 * 將可用庫存保留給訂單明細。
 * 不會超過明細尚未保留、尚未出貨的需求量，也不會超過可用庫存。
 * 指定 batchItemId 時只從該 lot 保留。
 */
export async function reserveForItem(t: Tx, actor: Actor, input: { orderItemId: string; qty: number; batchItemId?: string | null }) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BizError("保留數量必須是正整數");
  const { item, need } = await itemNeed(t, input.orderItemId);
  if (item.order.confirmation !== "CONFIRMED") throw new BizError(`訂單 ${item.order.orderNo} 不是已確認狀態，不能保留庫存`);
  await lockRows(t, "Product", [item.productId]);
  if (input.qty > need) throw new BizError(`此明細只需要再保留 ${need} 件`);
  let lots = await productLots(t, item.productId);
  if (input.batchItemId !== undefined) lots = lots.filter((l) => l.batchItemId === (input.batchItemId ?? null));
  const free = lots.reduce((s, l) => s + Math.max(0, l.free), 0);
  if (free < input.qty) throw new BizError(`可用庫存只有 ${free} 件`);
  let left = input.qty;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, lot.free));
    if (take <= 0) continue;
    await t.inventoryMovement.create({
      data: {
        productId: item.productId,
        kind: "RESERVE",
        reservedDelta: take,
        orderItemId: item.id,
        purchaseBatchItemId: lot.batchItemId,
        unitCostTwd: lot.batchItemId ? null : lot.unitCostTwd,
        reason: "保留給訂單",
        actorId: actor.userId,
      },
    });
    left -= take;
  }
  await t.orderItemEvent.create({ data: { orderItemId: item.id, type: "RESERVED", qtyDelta: input.qty, actorId: actor.userId } });
  await recomputeOrder(t, item.orderId);
  return { reserved: input.qty };
}

/** 釋放明細的保留（後進先出），用於取消或手動取消保留 */
export async function unreserveForItem(t: Tx, actor: Actor, input: { orderItemId: string; qty: number; reason: string }) {
  if (input.qty <= 0) return;
  const it = await t.orderItem.findUniqueOrThrow({ where: { id: input.orderItemId }, select: { productId: true, orderId: true } });
  await lockRows(t, "Product", [it.productId]);
  const groups = (await itemReservations(t, input.orderItemId)).reverse();
  const total = groups.reduce((s, g) => s + g.qty, 0);
  if (input.qty > total) throw new BizError(`此明細目前只保留 ${total} 件`);
  let left = input.qty;
  for (const g of groups) {
    if (left <= 0) break;
    const take = Math.min(left, g.qty);
    await t.inventoryMovement.create({
      data: {
        productId: it.productId,
        kind: "UNRESERVE",
        reservedDelta: -take,
        orderItemId: input.orderItemId,
        purchaseBatchItemId: g.batchItemId,
        unitCostTwd: g.unitCostTwd,
        reason: input.reason,
        actorId: actor.userId,
      },
    });
    left -= take;
  }
  await t.orderItemEvent.create({ data: { orderItemId: input.orderItemId, type: "UNRESERVED", qtyDelta: -input.qty, note: input.reason, actorId: actor.userId } });
  await recomputeOrder(t, it.orderId);
}

/** 取消後若保留量超過剩餘需求，自動釋放多出的部分 */
export async function releaseExcessReservation(t: Tx, actor: Actor, orderItemId: string, reason: string) {
  const { active, shipped, reserved } = await itemNeed(t, orderItemId);
  const excess = reserved - Math.max(0, active - shipped);
  if (excess > 0) await unreserveForItem(t, actor, { orderItemId, qty: excess, reason });
  return Math.max(0, excess);
}

/** 預覽到貨後的分配（先下單的訂單優先），不寫入資料 */
export async function previewAllocation(t: Tx, productId: string, qty: number) {
  const items = await t.orderItem.findMany({
    where: { productId, order: { confirmation: "CONFIRMED" } },
    include: {
      order: { select: { id: true, orderNo: true, orderedAt: true, buyer: { select: { id: true, name: true } } } },
      cancellations: { select: { qty: true } },
      shipmentItems: { select: { qty: true } },
      movements: { select: { reservedDelta: true } },
    },
    orderBy: [{ order: { orderedAt: "asc" } }, { createdAt: "asc" }],
  });
  let left = qty;
  const plan: { orderItemId: string; orderNo: string; buyerName: string; need: number; allocate: number }[] = [];
  for (const it of items) {
    const active = it.qty - it.cancellations.reduce((s, c) => s + c.qty, 0);
    const shipped = it.shipmentItems.reduce((s, x) => s + x.qty, 0);
    const reserved = it.movements.reduce((s, m) => s + m.reservedDelta, 0);
    const need = Math.max(0, active - shipped - reserved);
    if (need <= 0) continue;
    const allocate = Math.min(need, Math.max(0, left));
    left -= allocate;
    plan.push({ orderItemId: it.id, orderNo: it.order.orderNo, buyerName: it.order.buyer.name, need, allocate });
  }
  return { plan, unallocated: Math.max(0, left) };
}

/** 商品庫存總覽（單一商品或全部） */
export async function inventorySummary(t: Tx, productIds?: string[]) {
  const where = productIds ? { productId: { in: productIds } } : {};
  const mv = await t.inventoryMovement.groupBy({
    by: ["productId"],
    where,
    _sum: { onHandDelta: true, reservedDelta: true },
  });
  const shippedAgg = await t.inventoryMovement.groupBy({
    by: ["productId"],
    where: { ...where, kind: "SHIP" },
    _sum: { onHandDelta: true },
  });
  const batchItems = await t.purchaseBatchItem.findMany({
    where: { ...(productIds ? { productId: { in: productIds } } : {}), batch: { status: { notIn: ["CANCELLED", "DRAFT"] } } },
    select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
  });
  const demand = await t.orderItem.findMany({
    where: { ...(productIds ? { productId: { in: productIds } } : {}), order: { confirmation: "CONFIRMED" } },
    select: { productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, reservedQtyCache: true },
  });
  const map = new Map<
    string,
    { onHand: number; reserved: number; available: number; incoming: number; shipped: number; activeOrdered: number; openDemand: number; unallocated: number; shortage: number }
  >();
  const get = (id: string) => {
    let v = map.get(id);
    if (!v) {
      v = { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };
      map.set(id, v);
    }
    return v;
  };
  for (const r of mv) {
    const v = get(r.productId);
    v.onHand = r._sum.onHandDelta ?? 0;
    v.reserved = r._sum.reservedDelta ?? 0;
  }
  for (const r of shippedAgg) get(r.productId).shipped = -(r._sum.onHandDelta ?? 0);
  for (const b of batchItems) {
    const rec = b.movements.reduce((s, m) => s + m.onHandDelta, 0);
    get(b.productId).incoming += Math.max(0, b.qty - b.cancelledQty - rec);
  }
  for (const d of demand) {
    const v = get(d.productId);
    const active = d.qty - d.cancelledQtyCache;
    const open = Math.max(0, active - d.shippedQtyCache);
    v.activeOrdered += active;
    v.openDemand += open;
    v.unallocated += Math.max(0, open - d.reservedQtyCache);
  }
  for (const v of map.values()) {
    v.available = v.onHand - v.reserved;
    v.shortage = Math.max(0, v.unallocated - Math.max(0, v.available) - v.incoming);
  }
  return map;
}
