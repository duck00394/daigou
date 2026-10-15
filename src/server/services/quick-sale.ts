// 現貨直接出售：沿用既有的訂單、出貨、收款與庫存流水，一次完成，不另建庫存或帳務系統。
// - 只能賣「可售庫存」：已保留給其他買家、自留的都不會被動到（出貨時由 reserveForItem 從可用庫存保留）。
// - 收入、成本、毛利沿用既有報表口徑：收入依出貨認列；成本取自 SHIP 流水所屬的採購批次。
// - 作廢：以一筆負數出貨（退回）把商品放回原採購批次，日期記在原出售日，讓當月收入與成本一起歸零；
//   取消該明細、作廢自動登記的收款。原始紀錄全部保留。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { createOrder } from "./orders";
import { createShipment } from "./shipping";
import { addPayment, voidPayment } from "./payments";
import { productLots, reserveForItem } from "./inventory";
import { filterLotsByOwner, ownerAttributor, type OwnerMoney } from "./ownership";
import { recomputeOrder } from "./recompute";
import { landedCosts } from "./purchase";
import { costOfMove } from "./reports";
import { createBuyer } from "./buyers";

const WALK_IN_KEY = "walkInBuyerId";
const WALK_IN_NAME = "散客";

export interface QuickSaleInput {
  productId: string;
  qty: number;
  unitPrice: number; // 每件售價（台幣）
  buyerName?: string | null; // 空白＝散客
  soldAt?: Date | null;
  note?: string | null;
  paid?: boolean; // 是否同時登記為已收款（預設是）
  method?: string | null;
  owner?: string | null; // 賣誰的：經營者 id、"joint"（合資）、"none"；空白＝不限（先進先出）
  idemKey: string;
}

/** 未填買家時使用的固定買家「散客」 */
async function walkInBuyer(t: Tx, actor: Actor) {
  const s = await t.appSetting.findUnique({ where: { key: WALK_IN_KEY } });
  if (s) {
    const b = await t.buyer.findUnique({ where: { id: s.value } });
    if (b && !b.mergedIntoId) return b;
  }
  const b = await createBuyer(t, actor, { name: WALK_IN_NAME, notes: "現貨出售未指定買家時使用" });
  await t.appSetting.upsert({ where: { key: WALK_IN_KEY }, update: { value: b.id }, create: { key: WALK_IN_KEY, value: b.id } });
  return b;
}

/** 依名稱或別名找買家；找不到就建立一位（只有名稱，不需要其他資料） */
async function resolveBuyer(t: Tx, actor: Actor, name: string | null | undefined) {
  const n = emptyToNull(name);
  if (!n) return walkInBuyer(t, actor);
  const byName = await t.buyer.findFirst({ where: { name: n, mergedIntoId: null }, orderBy: { createdAt: "asc" } });
  if (byName) return byName;
  const byAlias = await t.buyerAlias.findFirst({ where: { alias: n }, include: { buyer: true } });
  if (byAlias && !byAlias.buyer.mergedIntoId) return byAlias.buyer;
  return createBuyer(t, actor, { name: n });
}

export async function quickSale(t: Tx, actor: Actor, input: QuickSaleInput) {
  if (!input.idemKey || input.idemKey.length < 8) throw new BizError("缺少送出識別碼");
  const key = `quick:${input.idemKey}`;
  const existing = await t.order.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { orderId: existing.id, duplicated: true, ...(await saleSummary(t, existing.id)) };
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BizError("出售數量必須是正整數");
  if (!Number.isInteger(input.unitPrice) || input.unitPrice < 0) throw new BizError("售價必須是不小於 0 的整數");
  const product = await t.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new BizError("找不到商品");
  await lockRows(t, "Product", [product.id]);
  // 鎖定後再確認一次：同一請求同時送出兩次時，第二個會等第一個完成後在這裡判定為重複
  const again = await t.order.findUnique({ where: { idempotencyKey: key } });
  if (again) return { orderId: again.id, duplicated: true, ...(await saleSummary(t, again.id)) };
  const lots = await filterLotsByOwner(t, await productLots(t, product.id), input.owner);
  const free = lots.reduce((s, l) => s + Math.max(0, l.free), 0);
  if (free < input.qty) throw new BizError(`「${product.name}」${input.owner ? "這個人的" : ""}可售庫存只有 ${free} 件（已保留給買家與自留的不能出售）`);
  const buyer = await resolveBuyer(t, actor, input.buyerName);
  const soldAt = input.soldAt ?? new Date();
  const order = await createOrder(t, actor, {
    buyerId: buyer.id,
    source: "QUICK",
    orderedAt: soldAt,
    notes: input.note ?? null,
    idempotencyKey: key,
    items: [{ productId: product.id, qty: input.qty, unitPrice: input.unitPrice }],
  });
  // 指定賣誰的：只從那個人的成本批次依先進先出保留；不指定則由出貨自動保留
  if (input.owner) {
    let left = input.qty;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, lot.free));
      if (take <= 0) continue;
      await reserveForItem(t, actor, { orderItemId: order.items[0].id, qty: take, batchItemId: lot.batchItemId });
      left -= take;
    }
  }
  await createShipment(t, actor, { buyerId: buyer.id, items: [{ orderItemId: order.items[0].id, qty: input.qty }], autoReserve: !input.owner, shippedAt: soldAt, method: "現貨出售", dedupeKey: key });
  const amount = input.qty * input.unitPrice;
  if (input.paid !== false && amount > 0) await addPayment(t, actor, { orderId: order.id, amount, paidAt: soldAt, method: input.method ?? null, note: "現貨出售", dedupeKey: key });
  await audit(t, actor, "quickSale.create", "Order", order.id, { productId: product.id, qty: input.qty, unitPrice: input.unitPrice, buyerId: buyer.id, paid: input.paid !== false });
  return { orderId: order.id, duplicated: false, ...(await saleSummary(t, order.id)) };
}

/** 一筆出售的收入、成本、毛利（成本取自 SHIP 流水；作廢後退回的流水會抵銷） */
export async function saleSummary(t: Tx, orderId: string) {
  const order = await t.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { cancellations: { select: { qty: true } } } } } });
  const moves = await t.inventoryMovement.findMany({
    where: { kind: "SHIP", orderItemId: { in: order.items.map((i) => i.id) } },
    select: { onHandDelta: true, purchaseBatchItemId: true, unitCostTwd: true, orderItem: { select: { estUnitCostTwd: true } } },
  });
  const landed = await landedCosts(t, [...new Set(moves.map((m) => m.purchaseBatchItemId).filter(Boolean) as string[])]);
  let cost = 0;
  let estimatedUnits = 0;
  for (const m of moves) {
    const r = costOfMove(landed, { qty: -m.onHandDelta, purchaseBatchItemId: m.purchaseBatchItemId, unitCostTwd: m.unitCostTwd, estUnitCostTwd: m.orderItem?.estUnitCostTwd ?? null });
    cost += r.cost;
    estimatedUnits += r.estimatedUnits;
  }
  const activeQty = order.items.reduce((s, i) => s + i.qty - i.cancellations.reduce((a, c) => a + c.qty, 0), 0);
  const revenue = order.items.reduce((s, i) => s + (i.qty - i.cancellations.reduce((a, c) => a + c.qty, 0)) * i.unitPrice, 0);
  // 成本是否含暫估：採購批次尚未確認實際單價，或該團還沒登記共同費用
  const batchIds = [...new Set(moves.map((m) => m.purchaseBatchItemId).filter(Boolean) as string[])];
  const bis = batchIds.length ? await t.purchaseBatchItem.findMany({ where: { id: { in: batchIds } }, select: { actualUnitCost: true, batch: { select: { costs: { select: { id: true }, take: 1 } } } } }) : [];
  const tentative = estimatedUnits > 0 || bis.some((b) => b.actualUnitCost === null || b.batch.costs.length === 0);
  return { qty: activeQty, revenue, cost, profit: revenue - cost, tentative, voided: activeQty === 0 };
}

/** 作廢一筆現貨出售：商品退回原採購批次、取消明細、作廢自動登記的收款 */
export async function voidQuickSale(t: Tx, actor: Actor, orderId: string, reason: string) {
  const why = reason?.trim();
  if (!why) throw new BizError("請填寫作廢原因");
  await lockRows(t, "Order", [orderId]);
  const order = await t.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { cancellations: true, shipmentItems: { include: { shipment: true } } } }, payments: true },
  });
  if (!order) throw new BizError("找不到這筆出售");
  if (order.source !== "QUICK") throw new BizError("只有「現貨出售」可以在這裡作廢；一般訂單請在訂單頁處理");
  if (order.items.every((i) => i.qty - i.cancellations.reduce((s, c) => s + c.qty, 0) === 0)) throw new BizError("這筆出售已經作廢");
  await lockRows(t, "Product", order.items.map((i) => i.productId));
  for (const it of order.items) {
    const shipped = it.shipmentItems.reduce((s, x) => s + x.qty, 0);
    if (shipped > 0) {
      const orig = it.shipmentItems.find((x) => x.qty > 0)!;
      const ret = await t.shipment.create({
        data: { shipmentNo: await nextCode(t, "shipment"), buyerId: order.buyerId, method: "作廢退回", shippedAt: orig.shipment.shippedAt, note: `作廢出售：${why}` },
      });
      const si = await t.shipmentItem.create({ data: { shipmentId: ret.id, orderItemId: it.id, qty: -shipped } });
      // 依原出貨的批次逐筆退回，成本來源不變
      const moves = await t.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: it.id } });
      const perLot = new Map<string, { lot: string | null; cost: number | null; qty: number }>();
      for (const m of moves) {
        const k = `${m.purchaseBatchItemId ?? ""}|${m.unitCostTwd ?? ""}`;
        const v = perLot.get(k) ?? { lot: m.purchaseBatchItemId, cost: m.unitCostTwd, qty: 0 };
        v.qty -= m.onHandDelta;
        perLot.set(k, v);
      }
      for (const v of perLot.values()) {
        if (v.qty <= 0) continue;
        await t.inventoryMovement.create({
          data: { productId: it.productId, kind: "SHIP", onHandDelta: v.qty, reservedDelta: 0, orderItemId: it.id, purchaseBatchItemId: v.lot, unitCostTwd: v.cost, shipmentItemId: si.id, reason: `作廢出售退回 ${ret.shipmentNo}`, actorId: actor.userId },
        });
      }
      await t.orderItemEvent.create({ data: { orderItemId: it.id, type: "SHIPPED", qtyDelta: -shipped, note: `作廢退回 ${ret.shipmentNo}`, actorId: actor.userId } });
    }
    const left = it.qty - it.cancellations.reduce((s, c) => s + c.qty, 0);
    if (left > 0) {
      await t.orderCancellation.create({ data: { orderItemId: it.id, qty: left, reason: `作廢出售：${why}`, actorId: actor.userId } });
      await t.orderItemEvent.create({ data: { orderItemId: it.id, type: "CANCELLED", qtyDelta: -left, note: `作廢出售：${why}`, actorId: actor.userId } });
    }
  }
  // 只作廢出售時自動登記的收款；另外手動登記的收款保留，訂單會顯示「應退」，由退款流程處理
  for (const p of order.payments) if (!p.voidedAt && p.dedupeKey?.startsWith("quick:")) await voidPayment(t, actor, { paymentId: p.id, reason: `作廢出售：${why}` });
  await t.order.update({ where: { id: orderId }, data: { confirmation: "CANCELLED", cancelledAt: new Date(), cancelReason: `作廢出售：${why}` } });
  await recomputeOrder(t, orderId);
  await audit(t, actor, "quickSale.void", "Order", orderId, { reason: why });
}

/** 更正：同一交易內作廢舊的一筆，再建立正確的一筆 */
export async function correctQuickSale(t: Tx, actor: Actor, orderId: string, input: QuickSaleInput & { reason?: string | null }) {
  const key = `quick:${input.idemKey}`;
  await lockRows(t, "Order", [orderId]); // 同一筆更正同時送出兩次時，第二個等第一個完成後判定為重複
  const existing = await t.order.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { orderId: existing.id, duplicated: true, ...(await saleSummary(t, existing.id)) };
  await voidQuickSale(t, actor, orderId, input.reason?.trim() || "更正");
  const r = await quickSale(t, actor, input);
  await audit(t, actor, "quickSale.correct", "Order", r.orderId, { from: orderId });
  return r;
}

export async function listQuickSales(t: Tx, opts: { q?: string | null; from?: Date | null; toExclusive?: Date | null; includeVoided?: boolean } = {}) {
  const q = emptyToNull(opts.q);
  const orders = await t.order.findMany({
    where: {
      source: "QUICK",
      ...(opts.includeVoided ? {} : { confirmation: "CONFIRMED" }),
      ...(opts.from || opts.toExclusive ? { orderedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.toExclusive ? { lt: opts.toExclusive } : {}) } } : {}),
      ...(q ? { OR: [{ buyer: { name: { contains: q, mode: "insensitive" } } }, { items: { some: { productNameSnapshot: { contains: q, mode: "insensitive" } } } }, { notes: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: {
      buyer: { select: { id: true, name: true } },
      items: { select: { id: true, productId: true, productNameSnapshot: true, qty: true, unitPrice: true, estUnitCostTwd: true, cancellations: { select: { qty: true } } } },
      payments: { select: { amount: true, voidedAt: true } },
    },
  });
  // 一次取出所有出貨流水與批次成本，避免每筆各查一次
  const itemIds = orders.flatMap((o) => o.items.map((i) => i.id));
  const moves = itemIds.length ? await t.inventoryMovement.findMany({ where: { kind: "SHIP", orderItemId: { in: itemIds } }, select: { orderItemId: true, onHandDelta: true, purchaseBatchItemId: true, unitCostTwd: true } }) : [];
  const lotIds = [...new Set(moves.map((m) => m.purchaseBatchItemId).filter(Boolean) as string[])];
  const landed = await landedCosts(t, lotIds);
  const lotInfo = lotIds.length ? await t.purchaseBatchItem.findMany({ where: { id: { in: lotIds } }, select: { id: true, actualUnitCost: true, batch: { select: { costs: { select: { id: true }, take: 1 } } } } }) : [];
  const tentativeLot = new Set(lotInfo.filter((b) => b.actualUnitCost === null || b.batch.costs.length === 0).map((b) => b.id));
  const movesByItem = new Map<string, typeof moves>();
  for (const m of moves) {
    const arr = movesByItem.get(m.orderItemId!) ?? [];
    arr.push(m);
    movesByItem.set(m.orderItemId!, arr);
  }
  const attribute = await ownerAttributor(t, lotIds);
  const totalByOwner = new Map<string, OwnerMoney>();
  const rows = orders.map((o) => {
    let cost = 0;
    let tentative = false;
    const parts: { purchaseBatchItemId: string | null; qty: number; revenue: number; cost: number }[] = [];
    for (const it of o.items) {
      for (const m of movesByItem.get(it.id) ?? []) {
        const r = costOfMove(landed, { qty: -m.onHandDelta, purchaseBatchItemId: m.purchaseBatchItemId, unitCostTwd: m.unitCostTwd, estUnitCostTwd: it.estUnitCostTwd });
        parts.push({ purchaseBatchItemId: m.purchaseBatchItemId, qty: -m.onHandDelta, revenue: -m.onHandDelta * it.unitPrice, cost: r.cost });
        cost += r.cost;
        if (r.estimatedUnits > 0 || (m.purchaseBatchItemId && tentativeLot.has(m.purchaseBatchItemId))) tentative = true;
      }
    }
    const qty = o.items.reduce((a, i) => a + i.qty - i.cancellations.reduce((x, c) => x + c.qty, 0), 0);
    const owners = attribute(parts);
    if (qty > 0) for (const [k, v] of owners) {
      const x = totalByOwner.get(k) ?? { qty: 0, revenue: 0, cost: 0 };
      x.qty += v.qty;
      x.revenue += v.revenue;
      x.cost += v.cost;
      totalByOwner.set(k, x);
    }
    const revenue = o.items.reduce((a, i) => a + (i.qty - i.cancellations.reduce((x, c) => x + c.qty, 0)) * i.unitPrice, 0);
    return {
      id: o.id,
      orderNo: o.orderNo,
      soldAt: o.orderedAt,
      buyer: o.buyer,
      productId: o.items[0]?.productId ?? null,
      productName: o.items.map((i) => i.productNameSnapshot).join("、"),
      originalQty: o.items.reduce((a, i) => a + i.qty, 0),
      unitPrice: o.items[0]?.unitPrice ?? 0,
      note: o.notes,
      paid: o.payments.filter((p) => !p.voidedAt).reduce((a, p) => a + p.amount, 0),
      cancelReason: o.cancelReason,
      qty,
      revenue,
      cost,
      profit: revenue - cost,
      tentative: qty > 0 && tentative,
      voided: qty === 0,
      owners: [...owners.entries()].filter(([, v]) => v.qty !== 0 || v.revenue !== 0).map(([k, v]) => ({ key: k, ...v })),
    };
  });
  const live = rows.filter((r) => !r.voided);
  return {
    rows,
    byOwner: Object.fromEntries(totalByOwner),
    total: { count: live.length, qty: live.reduce((a, r) => a + r.qty, 0), revenue: live.reduce((a, r) => a + r.revenue, 0), cost: live.reduce((a, r) => a + r.cost, 0), profit: live.reduce((a, r) => a + r.profit, 0), tentative: live.some((r) => r.tentative) },
  };
}
